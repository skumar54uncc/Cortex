/**
 * Safe, dependency-free Markdown renderer for Ask answers.
 *
 * The model's answer is untrusted text. Every node here is built with
 * `document.createElement` / `document.createTextNode`; this module must never
 * contain `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
 * `eval`, `new Function` or `DOMParser` (see docs/INNERHTML_AUDIT.md, and the
 * source-level guard in tests/markdown-render.test.ts). Raw HTML inside the
 * markdown is therefore rendered as literal text, never parsed: a model that
 * emits `<img src=x onerror=alert(1)>` shows that string on screen.
 *
 * Links are the only place a model string reaches an attribute, and they go
 * through `safeHttpHttpsHref`, so only http(s) URLs become anchors; everything
 * else (javascript:, data:, chrome-extension:, relative paths) stays text.
 *
 * Partial input is expected: the renderer is re-run on every streaming flush,
 * so an unterminated `**`, an open code fence or a half-written `[1,` renders
 * as sensible text so far and never throws.
 *
 * Supported: paragraphs and line breaks, `-`/`*`/`+` and `1.`/`1)` lists
 * (nested up to 2 levels), bold, italic, bold+italic, inline code,
 * strikethrough, fenced code blocks, `#`..`###` headings, blockquotes,
 * horizontal rules, markdown links, bare http(s) URLs, and citation markers
 * (`[1]`, `[1, 6, 16]`, `[ 1 , 6 ]`, `[1][2]`).
 *
 * CLASS NAMES EMITTED (no stylesheet ships with this module; the overlay
 * stylesheet owns the looks):
 *   cortex-md-p           <p>
 *   cortex-md-heading     <h1>/<h2>/<h3>, plus cortex-md-h1 / -h2 / -h3
 *   cortex-md-list        <ul>/<ol>, plus cortex-md-list-unordered / -ordered
 *   cortex-md-item        <li>
 *   cortex-md-quote       <blockquote>
 *   cortex-md-rule        <hr>
 *   cortex-md-pre         <pre>
 *   cortex-md-code-block  <code> inside <pre>, plus cortex-md-lang-<lang>
 *   cortex-md-code        inline <code>
 *   cortex-md-strong      <strong>
 *   cortex-md-em          <em>
 *   cortex-md-del         <del>
 *   cortex-md-link        <a> (always target="_blank" rel="noopener noreferrer")
 */

import { safeHttpHttpsHref } from "../lib/url-security";

export interface MarkdownRenderOptions {
  /**
   * Called once per number in a citation marker. Return the node to insert
   * (the overlay passes a chip element), or `null` to keep `[n]` as text.
   * When the option itself is missing the whole marker stays plain text.
   */
  citation?: (n: number) => Node | null;
  /**
   * Called for every link whose href passed the http(s) check. Return `null`
   * to fall back to this module's plain anchor.
   */
  link?: (href: string, text: string) => Node | null;
}

const CLASS = {
  p: "cortex-md-p",
  heading: "cortex-md-heading",
  list: "cortex-md-list",
  listUnordered: "cortex-md-list-unordered",
  listOrdered: "cortex-md-list-ordered",
  item: "cortex-md-item",
  quote: "cortex-md-quote",
  rule: "cortex-md-rule",
  pre: "cortex-md-pre",
  codeBlock: "cortex-md-code-block",
  code: "cortex-md-code",
  strong: "cortex-md-strong",
  em: "cortex-md-em",
  del: "cortex-md-del",
  link: "cortex-md-link",
} as const;

/** `- x`, `* x`, `+ x`, `1. x`, `1) x`. Groups: indent, bullet, number, text. */
const LIST_RE = /^(\s*)(?:([-*+])|(\d{1,9})[.)])[ \t]+(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const LANG_RE = /^[A-Za-z0-9_+#.-]{1,24}$/;
const LINK_RE = /^\[([^\]\n]*)\]\(([^()\s]*)(?:[ \t]+"[^"\n]*")?\)/;
const CITE_RE = /^\[([0-9,\s]+)\]/;
const CITE_BODY_RE = /^\s*\d{1,4}(?:\s*,\s*\d{1,4})*\s*$/;
const URL_RE = /^https?:\/\/[^\s<>"'`)\]]+/;
const ESCAPABLE_RE = /[\\`*_{}[\]()#+\-.!~>|]/;

/** Deepest list nesting we build; deeper markers stay in the level-2 list. */
const MAX_LIST_LEVEL = 2;
/** Guard against pathological nesting in hostile input. */
const MAX_BLOCK_DEPTH = 6;
const MAX_INLINE_DEPTH = 8;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Render markdown into a detached fragment. Never touches the document and
 * never throws on partial input.
 */
export function renderMarkdown(text: string, opts: MarkdownRenderOptions = {}): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (typeof text !== "string" || text.length === 0) return frag;
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  renderBlocks(lines, frag, opts, 0);
  return frag;
}

/** Clear `el`, then append the rendered markdown. */
export function renderMarkdownInto(
  el: HTMLElement,
  text: string,
  opts: MarkdownRenderOptions = {}
): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(renderMarkdown(text, opts));
}

/* ------------------------------- blocks -------------------------------- */

function isBlockStart(line: string): boolean {
  return (
    FENCE_OPEN_RE.test(line) ||
    HR_RE.test(line) ||
    HEADING_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line)
  );
}

function indentOf(line: string): number {
  const m = /^ */.exec(line);
  return m ? m[0].length : 0;
}

function renderBlocks(
  lines: string[],
  parent: Node,
  opts: MarkdownRenderOptions,
  depth: number
): void {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE_OPEN_RE.exec(line);
    if (fence) {
      i = renderFence(lines, i, fence[1], fence[2], parent);
      continue;
    }

    if (HR_RE.test(line)) {
      parent.appendChild(make("hr", CLASS.rule));
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      const tag = (level === 1 ? "h1" : level === 2 ? "h2" : "h3") as "h1" | "h2" | "h3";
      const h = make(tag, `${CLASS.heading} cortex-md-h${level}`);
      renderInlineInto(h, heading[2].replace(/[ \t]+#+[ \t]*$/, "").trim(), opts, 0);
      parent.appendChild(h);
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].trim() && QUOTE_RE.test(lines[i])) {
        inner.push(QUOTE_RE.exec(lines[i])![1]);
        i++;
      }
      const quote = make("blockquote", CLASS.quote);
      if (depth < MAX_BLOCK_DEPTH) renderBlocks(inner, quote, opts, depth + 1);
      else quote.appendChild(document.createTextNode(inner.join("\n")));
      parent.appendChild(quote);
      continue;
    }

    if (LIST_RE.test(line)) {
      const built = buildList(lines, i, indentOf(line), 1, opts);
      parent.appendChild(built.node);
      i = Math.min(built.next, lines.length);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length === 0) {
      // Unreachable in practice; keeps the loop strictly progressing.
      i++;
      continue;
    }
    const p = make("p", CLASS.p);
    renderLinesInto(p, para, opts);
    parent.appendChild(p);
  }
}

/** Inline-render several lines with a <br> between them. */
function renderLinesInto(parent: Node, lines: string[], opts: MarkdownRenderOptions): void {
  lines.forEach((line, idx) => {
    if (idx > 0) parent.appendChild(make("br"));
    renderInlineInto(parent, line, opts, 0);
  });
}

/** Renders a fenced code block; an unterminated fence renders what exists. */
function renderFence(
  lines: string[],
  start: number,
  fence: string,
  info: string,
  parent: Node
): number {
  const marker = fence[0];
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length) {
    const close = FENCE_CLOSE_RE.exec(lines[i]);
    if (close && close[1][0] === marker && close[1].length >= fence.length) {
      i++;
      break;
    }
    body.push(lines[i]);
    i++;
  }
  const pre = make("pre", CLASS.pre);
  const lang = info.trim();
  const code = make(
    "code",
    LANG_RE.test(lang)
      ? `${CLASS.codeBlock} cortex-md-lang-${lang.toLowerCase()}`
      : CLASS.codeBlock
  );
  code.textContent = body.join("\n");
  pre.appendChild(code);
  parent.appendChild(pre);
  return i;
}

interface BuiltList {
  node: HTMLUListElement | HTMLOListElement;
  next: number;
}

/**
 * Builds one list starting at `lines[start]`. Items indented two or more
 * spaces past `baseIndent` become a nested list inside the previous item,
 * up to MAX_LIST_LEVEL; deeper markers join the level-2 list.
 */
function buildList(
  lines: string[],
  start: number,
  baseIndent: number,
  level: number,
  opts: MarkdownRenderOptions
): BuiltList {
  const first = LIST_RE.exec(lines[start])!;
  const ordered = first[3] !== undefined;
  const list = ordered
    ? make("ol", `${CLASS.list} ${CLASS.listOrdered}`)
    : make("ul", `${CLASS.list} ${CLASS.listUnordered}`);
  if (ordered) {
    const from = parseInt(first[3], 10);
    if (Number.isFinite(from) && from !== 1) list.setAttribute("start", String(from));
  }

  let item: { li: HTMLLIElement; lines: string[] } | null = null;
  const flush = (): void => {
    if (!item || item.lines.length === 0) return;
    renderLinesInto(item.li, item.lines, opts);
    item.lines = [];
  };

  let i = start;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && LIST_RE.test(lines[j]) && indentOf(lines[j]) >= baseIndent) {
        i = j;
        continue;
      }
      i = j;
      break;
    }

    const m = LIST_RE.exec(line);
    if (!m) {
      // Indented continuation of the current item; anything else ends the list.
      if (item && indentOf(line) >= baseIndent + 2 && !isBlockStart(line)) {
        item.lines.push(line.trim());
        i++;
        continue;
      }
      break;
    }

    const indent = m[1].length;
    if (indent < baseIndent) break;

    if (indent >= baseIndent + 2 && item && level < MAX_LIST_LEVEL) {
      flush();
      const nested = buildList(lines, i, indent, level + 1, opts);
      item.li.appendChild(nested.node);
      i = nested.next;
      continue;
    }

    if (item && (m[3] !== undefined) !== ordered) break;

    flush();
    const li = make("li", CLASS.item);
    list.appendChild(li);
    item = { li, lines: [m[4]] };
    i++;
  }

  flush();
  return { node: list, next: Math.max(i, start + 1) };
}

/* ------------------------------- inline -------------------------------- */

/** Index of a backtick run of exactly `n`, at or after `from`; -1 if none. */
function closingBacktickRun(text: string, from: number, n: number): number {
  let idx = from;
  while (idx < text.length) {
    const c = text.indexOf("`", idx);
    if (c < 0) return -1;
    let len = 1;
    while (text[c + len] === "`") len++;
    if (len === n) return c;
    idx = c + len;
  }
  return -1;
}

/**
 * Index of the closing emphasis delimiter: the first `marker` after `from`
 * that is not preceded by whitespace or a backslash (so `2 * 3 * 4` and a
 * dangling `**` stay literal), and, for `_`, not glued to a word character.
 */
function closingDelimiter(text: string, from: number, marker: string): number {
  let idx = from;
  while (idx <= text.length) {
    const c = text.indexOf(marker, idx);
    if (c < 0) return -1;
    const before = text[c - 1];
    const after = text[c + marker.length];
    const ok =
      c > from &&
      before !== undefined &&
      !/\s/.test(before) &&
      before !== "\\" &&
      !(marker[0] === "_" && after !== undefined && /\w/.test(after));
    if (ok) return c;
    idx = c + marker.length;
  }
  return -1;
}

function anchor(href: string, label: string, opts: MarkdownRenderOptions, depth: number): Node {
  if (opts.link) {
    const custom = opts.link(href, label);
    if (custom) return custom;
  }
  const a = make("a", CLASS.link);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  if (label) renderInlineInto(a, label, { ...opts, link: undefined }, depth + 1);
  else a.textContent = href;
  return a;
}

function renderInlineInto(
  parent: Node,
  text: string,
  opts: MarkdownRenderOptions,
  depth: number
): void {
  if (!text) return;
  if (depth > MAX_INLINE_DEPTH) {
    parent.appendChild(document.createTextNode(text));
    return;
  }

  let buf = "";
  const flush = (): void => {
    if (buf) {
      parent.appendChild(document.createTextNode(buf));
      buf = "";
    }
  };
  const push = (node: Node): void => {
    flush();
    parent.appendChild(node);
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // Backslash escape: \* \_ \[ ...
    if (ch === "\\" && i + 1 < text.length && ESCAPABLE_RE.test(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Inline code. Wins over every other inline rule.
    if (ch === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      const close = closingBacktickRun(text, i + n, n);
      if (close > 0) {
        let content = text.slice(i + n, close);
        if (content.length > 2 && content.startsWith(" ") && content.endsWith(" ")) {
          content = content.slice(1, -1);
        }
        const code = make("code", CLASS.code);
        code.textContent = content;
        push(code);
        i = close + n;
        continue;
      }
      buf += text.slice(i, i + n);
      i += n;
      continue;
    }

    // Emphasis: ***x*** ** x ** *x* ___x___ __x__ _x_ ~~x~~
    if (ch === "*" || ch === "_" || ch === "~") {
      let n = 1;
      while (text[i + n] === ch) n++;
      const intraword = ch === "_" && i > 0 && /\w/.test(text[i - 1]);
      if (!intraword) {
        const maxK = ch === "~" ? 2 : 3;
        let matched = false;
        for (let k = Math.min(n, maxK); k >= (ch === "~" ? 2 : 1); k--) {
          const marker = ch.repeat(k);
          const close = closingDelimiter(text, i + n, marker);
          if (close < 0) continue;
          const content = text.slice(i + n, close);
          if (!content || /^\s/.test(content)) continue;
          if (n > k) buf += text.slice(i, i + n - k);
          let holder: Node;
          if (ch === "~") {
            holder = make("del", CLASS.del);
          } else if (k === 3) {
            const strong = make("strong", CLASS.strong);
            const em = make("em", CLASS.em);
            strong.appendChild(em);
            holder = strong;
          } else if (k === 2) {
            holder = make("strong", CLASS.strong);
          } else {
            holder = make("em", CLASS.em);
          }
          const target = ch !== "~" && k === 3 ? (holder.firstChild as Node) : holder;
          renderInlineInto(target, content, opts, depth + 1);
          push(holder);
          i = close + marker.length;
          matched = true;
          break;
        }
        if (matched) continue;
      }
      buf += text.slice(i, i + n);
      i += n;
      continue;
    }

    // [text](url) link, then [1] / [1, 6, 16] citation marker.
    if (ch === "[") {
      const rest = text.slice(i);
      const link = LINK_RE.exec(rest);
      if (link) {
        const href = safeHttpHttpsHref(link[2]);
        if (href) {
          push(anchor(href, link[1], opts, depth));
        } else {
          // Not http(s): show the markdown source as text, never an anchor.
          buf += link[0];
        }
        i += link[0].length;
        continue;
      }
      const cite = CITE_RE.exec(rest);
      if (cite && CITE_BODY_RE.test(cite[1])) {
        if (opts.citation) {
          for (const part of cite[1].split(",")) {
            const n = parseInt(part.trim(), 10);
            if (!Number.isFinite(n)) continue;
            const node = opts.citation(n);
            if (node) push(node);
            else buf += `[${n}]`;
          }
        } else {
          buf += cite[0];
        }
        i += cite[0].length;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    // Bare http(s) URL.
    if (
      (ch === "h" || ch === "H") &&
      !(i > 0 && /\w/.test(text[i - 1])) &&
      /^https?:\/\//i.test(text.slice(i, i + 8))
    ) {
      const m = URL_RE.exec(text.slice(i));
      if (m) {
        let raw = m[0];
        while (raw.length > 0 && /[.,;:!?'"]$/.test(raw)) raw = raw.slice(0, -1);
        const href = raw ? safeHttpHttpsHref(raw) : null;
        if (href) {
          if (opts.link) {
            const custom = opts.link(href, raw);
            if (custom) push(custom);
            else push(plainAnchor(href, raw));
          } else {
            push(plainAnchor(href, raw));
          }
          i += raw.length;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();
}

function plainAnchor(href: string, label: string): HTMLAnchorElement {
  const a = make("a", CLASS.link);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label;
  return a;
}
