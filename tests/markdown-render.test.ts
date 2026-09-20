// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderMarkdown, renderMarkdownInto } from "../src/content/markdown-render";

/** Render into a detached host so we can query it. */
function host(src: string, opts?: Parameters<typeof renderMarkdown>[1]): HTMLDivElement {
  const el = document.createElement("div");
  el.appendChild(renderMarkdown(src, opts));
  return el;
}

/** A citation chip like the overlay passes in. */
const chip = (n: number): Node => {
  const a = document.createElement("a");
  a.className = "cortex-cite";
  a.dataset.n = String(n);
  a.textContent = String(n);
  return a;
};

const chipNums = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll<HTMLElement>(".cortex-cite")).map((c) => c.dataset.n ?? "");

describe("renderMarkdown: paragraphs and line breaks", () => {
  it("returns a DocumentFragment", () => {
    expect(renderMarkdown("hi").nodeType).toBe(11);
  });

  it("renders plain text as a paragraph", () => {
    const el = host("Hello world");
    const ps = el.querySelectorAll("p");
    expect(ps.length).toBe(1);
    expect(ps[0].textContent).toBe("Hello world");
    expect(ps[0].className).toContain("cortex-md-p");
  });

  it("splits paragraphs on a blank line", () => {
    const el = host("First para.\n\nSecond para.");
    const ps = el.querySelectorAll("p");
    expect(ps.length).toBe(2);
    expect(ps[0].textContent).toBe("First para.");
    expect(ps[1].textContent).toBe("Second para.");
  });

  it("keeps a single newline inside a paragraph as a <br>", () => {
    const el = host("line one\nline two");
    expect(el.querySelectorAll("p").length).toBe(1);
    expect(el.querySelectorAll("br").length).toBe(1);
    expect(el.textContent).toContain("line one");
    expect(el.textContent).toContain("line two");
  });

  it("renders empty and whitespace-only input as nothing", () => {
    expect(host("").childNodes.length).toBe(0);
    expect(host("   \n\n  \n").childNodes.length).toBe(0);
  });

  it("normalizes CRLF", () => {
    const el = host("a\r\n\r\nb");
    expect(el.querySelectorAll("p").length).toBe(2);
  });
});

describe("renderMarkdown: inline emphasis", () => {
  it("renders **bold**", () => {
    const el = host("some **bold** text");
    const strong = el.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("bold");
    expect(strong!.className).toContain("cortex-md-strong");
    expect(el.textContent).toBe("some bold text");
  });

  it("renders __bold__", () => {
    const el = host("some __bold__ text");
    expect(el.querySelector("strong")!.textContent).toBe("bold");
    expect(el.textContent).toBe("some bold text");
  });

  it("renders *italic* and _italic_", () => {
    const a = host("an *italic* word");
    expect(a.querySelector("em")!.textContent).toBe("italic");
    expect(a.querySelector("em")!.className).toContain("cortex-md-em");
    const b = host("an _italic_ word");
    expect(b.querySelector("em")!.textContent).toBe("italic");
    expect(b.textContent).toBe("an italic word");
  });

  it("renders ***bold italic***", () => {
    const el = host("***wow***");
    const strong = el.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.querySelector("em")).not.toBeNull();
    expect(el.textContent).toBe("wow");
  });

  it("renders ~~strikethrough~~", () => {
    const el = host("~~gone~~ now");
    expect(el.querySelector("del")!.textContent).toBe("gone");
    expect(el.querySelector("del")!.className).toContain("cortex-md-del");
    expect(el.textContent).toBe("gone now");
  });

  it("renders `inline code` and does not parse markdown inside it", () => {
    const el = host("use `**not bold**` here");
    const code = el.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("**not bold**");
    expect(code!.className).toContain("cortex-md-code");
    expect(el.querySelector("strong")).toBeNull();
  });

  it("nests emphasis inside bold", () => {
    const el = host("**bold with *italic* inside**");
    const strong = el.querySelector("strong")!;
    expect(strong.querySelector("em")!.textContent).toBe("italic");
    expect(el.textContent).toBe("bold with italic inside");
  });

  it("leaves intraword underscores alone", () => {
    const el = host("the snake_case_name stays");
    expect(el.querySelector("em")).toBeNull();
    expect(el.textContent).toBe("the snake_case_name stays");
  });

  it("does not treat multiplication asterisks as emphasis", () => {
    const el = host("2 * 3 * 4 = 24");
    expect(el.querySelector("em")).toBeNull();
    expect(el.textContent).toBe("2 * 3 * 4 = 24");
  });

  it("honours backslash escapes", () => {
    const el = host("literal \\*stars\\* and \\_bars\\_");
    expect(el.querySelector("em")).toBeNull();
    expect(el.textContent).toBe("literal *stars* and _bars_");
  });
});

describe("renderMarkdown: lists", () => {
  it("renders a -, * or + unordered list", () => {
    for (const marker of ["-", "*", "+"]) {
      const el = host(`${marker} alpha\n${marker} beta`);
      const ul = el.querySelector("ul");
      expect(ul, marker).not.toBeNull();
      expect(ul!.className).toContain("cortex-md-list");
      const items = ul!.querySelectorAll("li");
      expect(items.length).toBe(2);
      expect(items[0].textContent).toBe("alpha");
      expect(items[1].textContent).toBe("beta");
      expect(items[0].className).toContain("cortex-md-item");
      expect(el.textContent).not.toContain(marker);
    }
  });

  it("renders an ordered list", () => {
    const el = host("1. first\n2. second\n3. third");
    const ol = el.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll("li").length).toBe(3);
    expect(ol!.querySelectorAll("li")[2].textContent).toBe("third");
    expect(el.querySelector("ul")).toBeNull();
  });

  it("keeps an ordered list's starting number", () => {
    const el = host("3. three\n4. four");
    expect(el.querySelector("ol")!.getAttribute("start")).toBe("3");
  });

  it("renders inline markup inside list items", () => {
    const el = host("- a **bold** item\n- a `code` item");
    expect(el.querySelector("li strong")!.textContent).toBe("bold");
    expect(el.querySelector("li code")!.textContent).toBe("code");
  });

  it("nests a list two levels deep", () => {
    const el = host("- outer one\n  - inner a\n  - inner b\n- outer two");
    const top = el.querySelector("ul")!;
    const topItems = Array.from(top.children).filter((c) => c.tagName === "LI");
    expect(topItems.length).toBe(2);
    const nested = topItems[0].querySelector("ul");
    expect(nested).not.toBeNull();
    expect(nested!.querySelectorAll("li").length).toBe(2);
    expect(nested!.querySelectorAll("li")[1].textContent).toBe("inner b");
    expect(topItems[1].textContent).toBe("outer two");
  });

  it("nests an ordered list inside an unordered one", () => {
    const el = host("- outer\n  1. one\n  2. two");
    expect(el.querySelector("ul > li > ol")).not.toBeNull();
    expect(el.querySelectorAll("ol li").length).toBe(2);
  });

  it("does not nest deeper than two levels", () => {
    const el = host("- l1\n  - l2\n    - l3\n      - l4");
    // one top list + exactly one nested list
    expect(el.querySelectorAll("ul").length).toBe(2);
    expect(el.textContent).toContain("l3");
    expect(el.textContent).toContain("l4");
  });

  it("separates a list from the paragraph that follows it", () => {
    const el = host("- a\n- b\n\nAfter the list.");
    expect(el.querySelectorAll("li").length).toBe(2);
    const ps = el.querySelectorAll("p");
    expect(ps.length).toBe(1);
    expect(ps[0].textContent).toBe("After the list.");
  });

  it("starts a list right after a paragraph without a blank line", () => {
    const el = host("Here you go:\n- a\n- b");
    expect(el.querySelectorAll("p").length).toBe(1);
    expect(el.querySelectorAll("li").length).toBe(2);
  });

  it("keeps blank-line separated items in the same list", () => {
    const el = host("- a\n\n- b");
    expect(el.querySelectorAll("ul").length).toBe(1);
    expect(el.querySelectorAll("li").length).toBe(2);
  });

  it("renders the reported raw-markdown answer as real bullets", () => {
    const src =
      "*   You watched videos explaining how microchips are made [1, 6, 16]\n" +
      "*   You read about **EUV lithography** [2]";
    const el = host(src, { citation: chip });
    const items = el.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(el.textContent).not.toContain("*");
    expect(items[0].textContent).toContain("You watched videos explaining how microchips are made");
    expect(chipNums(el)).toEqual(["1", "6", "16", "2"]);
    expect(el.querySelector("li strong")!.textContent).toBe("EUV lithography");
  });
});

describe("renderMarkdown: headings, quotes, rules", () => {
  it("renders # to ###", () => {
    const el = host("# One\n\n## Two\n\n### Three");
    expect(el.querySelector("h1")!.textContent).toBe("One");
    expect(el.querySelector("h2")!.textContent).toBe("Two");
    expect(el.querySelector("h3")!.textContent).toBe("Three");
    expect(el.querySelector("h1")!.className).toContain("cortex-md-heading");
    expect(el.querySelector("h1")!.className).toContain("cortex-md-h1");
  });

  it("clamps deeper headings to h3 and strips closing hashes", () => {
    const el = host("#### Deep ####");
    expect(el.querySelector("h3")!.textContent).toBe("Deep");
  });

  it("renders inline markup in headings", () => {
    const el = host("## A **bold** title");
    expect(el.querySelector("h2 strong")!.textContent).toBe("bold");
  });

  it("does not treat a bare # as a heading", () => {
    const el = host("#hashtag");
    expect(el.querySelector("h1")).toBeNull();
    expect(el.textContent).toBe("#hashtag");
  });

  it("renders blockquotes", () => {
    const el = host("> quoted line\n> second line");
    const q = el.querySelector("blockquote");
    expect(q).not.toBeNull();
    expect(q!.className).toContain("cortex-md-quote");
    expect(q!.textContent).toContain("quoted line");
    expect(q!.textContent).toContain("second line");
    expect(el.textContent).not.toContain(">");
  });

  it("renders a list inside a blockquote", () => {
    const el = host("> - a\n> - b");
    expect(el.querySelectorAll("blockquote li").length).toBe(2);
  });

  it("renders horizontal rules", () => {
    for (const src of ["---", "***", "___", "- - -"]) {
      const el = host(`above\n\n${src}\n\nbelow`);
      expect(el.querySelectorAll("hr").length, src).toBe(1);
      expect(el.querySelector("hr")!.className).toContain("cortex-md-rule");
    }
  });
});

describe("renderMarkdown: code blocks", () => {
  it("renders a fenced code block as pre > code", () => {
    const el = host("```\nconst a = 1;\nconst b = 2;\n```");
    const pre = el.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.className).toContain("cortex-md-pre");
    const code = pre!.querySelector("code")!;
    expect(code.className).toContain("cortex-md-code-block");
    expect(code.textContent).toBe("const a = 1;\nconst b = 2;");
  });

  it("puts the language in a class", () => {
    const el = host("```ts\nlet x: number = 1;\n```");
    const code = el.querySelector("pre code")!;
    expect(code.className).toContain("cortex-md-lang-ts");
    expect(code.textContent).toBe("let x: number = 1;");
  });

  it("does not parse markdown or html inside a code block", () => {
    const el = host("```\n**not bold** <b>not bold</b>\n- not a list\n```");
    expect(el.querySelector("strong")).toBeNull();
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector("li")).toBeNull();
    expect(el.querySelector("pre code")!.textContent).toContain("<b>not bold</b>");
  });

  it("renders an unterminated fence as the code so far", () => {
    const el = host("here:\n```js\nconst half = ");
    const code = el.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("const half = ");
  });

  it("renders ~~~ fences too", () => {
    const el = host("~~~\nplain\n~~~");
    expect(el.querySelector("pre code")!.textContent).toBe("plain");
    expect(el.querySelector("del")).toBeNull();
  });

  it("keeps paragraphs after a closed code block", () => {
    const el = host("```\ncode\n```\n\nafter");
    expect(el.querySelector("pre code")!.textContent).toBe("code");
    expect(el.querySelector("p")!.textContent).toBe("after");
  });
});

describe("renderMarkdown: links", () => {
  it("turns a bare http(s) url into an anchor", () => {
    const el = host("see https://example.com/page for more");
    const a = el.querySelector("a") as HTMLAnchorElement;
    expect(a).not.toBeNull();
    expect(a.href).toBe("https://example.com/page");
    expect(a.textContent).toBe("https://example.com/page");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.className).toContain("cortex-md-link");
  });

  it("does not swallow trailing punctuation into a bare url", () => {
    const el = host("go to https://example.com/a.");
    const a = el.querySelector("a") as HTMLAnchorElement;
    expect(a.textContent).toBe("https://example.com/a");
    expect(el.textContent!.endsWith(".")).toBe(true);
  });

  it("renders a markdown link", () => {
    const el = host("read [the docs](https://example.com/docs) now");
    const a = el.querySelector("a") as HTMLAnchorElement;
    expect(a.textContent).toBe("the docs");
    expect(a.href).toBe("https://example.com/docs");
    expect(a.rel).toBe("noopener noreferrer");
  });

  it("uses the link callback when given", () => {
    const seen: Array<[string, string]> = [];
    const el = host("[docs](https://example.com/docs)", {
      link: (href, text) => {
        seen.push([href, text]);
        const span = document.createElement("span");
        span.className = "custom-link";
        span.textContent = text;
        return span;
      },
    });
    expect(seen).toEqual([["https://example.com/docs", "docs"]]);
    expect(el.querySelector(".custom-link")!.textContent).toBe("docs");
    expect(el.querySelector("a")).toBeNull();
  });

  it("falls back to a plain anchor when the link callback returns null", () => {
    const el = host("[docs](https://example.com/docs)", { link: () => null });
    expect((el.querySelector("a") as HTMLAnchorElement).href).toBe("https://example.com/docs");
  });

  it("renders a non-http(s) link target as literal text", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "chrome-extension://abc/page.html",
      "file:///etc/passwd",
      "/relative/path",
    ]) {
      const el = host(`[click me](${bad})`);
      expect(el.querySelector("a"), bad).toBeNull();
      expect(el.textContent, bad).toContain("click me");
    }
  });

  it("does not linkify a javascript: url written bare", () => {
    const el = host("javascript:alert(1)");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("javascript:alert(1)");
  });
});

describe("renderMarkdown: citations", () => {
  it("calls the citation callback for [1]", () => {
    const nums: number[] = [];
    const el = host("A claim [1].", {
      citation: (n) => {
        nums.push(n);
        return chip(n);
      },
    });
    expect(nums).toEqual([1]);
    expect(chipNums(el)).toEqual(["1"]);
    expect(el.textContent).toContain("A claim ");
    expect(el.textContent).not.toContain("[1]");
  });

  it("calls the callback for each number in [1, 6, 16]", () => {
    const nums: number[] = [];
    const el = host("Claim [1, 6, 16] end", {
      citation: (n) => {
        nums.push(n);
        return chip(n);
      },
    });
    expect(nums).toEqual([1, 6, 16]);
    expect(chipNums(el)).toEqual(["1", "6", "16"]);
  });

  it("handles spaces inside the marker, like [ 1 , 6 ]", () => {
    const nums: number[] = [];
    host("Claim [ 1 , 6 ] end", {
      citation: (n) => {
        nums.push(n);
        return chip(n);
      },
    });
    expect(nums).toEqual([1, 6]);
  });

  it("handles adjacent markers [1][2]", () => {
    const el = host("Claim [1][2] end", { citation: chip });
    expect(chipNums(el)).toEqual(["1", "2"]);
  });

  it("handles a marker inside a list item", () => {
    const el = host("- one [3]\n- two [4, 5]", { citation: chip });
    const items = el.querySelectorAll("li");
    expect(chipNums(items[0] as HTMLElement)).toEqual(["3"]);
    expect(chipNums(items[1] as HTMLElement)).toEqual(["4", "5"]);
  });

  it("leaves the marker as plain text when no callback is given", () => {
    const el = host("A claim [1, 6, 16].");
    expect(el.textContent).toBe("A claim [1, 6, 16].");
    expect(el.querySelector(".cortex-cite")).toBeNull();
  });

  it("leaves the number as text when the callback returns null", () => {
    const el = host("A claim [7].", { citation: () => null });
    expect(el.textContent).toBe("A claim [7].");
  });

  it("does not treat non-numeric brackets as citations", () => {
    const calls: number[] = [];
    const el = host("an [array] and [a, b] and [1a]", {
      citation: (n) => {
        calls.push(n);
        return chip(n);
      },
    });
    expect(calls).toEqual([]);
    expect(el.textContent).toBe("an [array] and [a, b] and [1a]");
  });

  it("does not run citations inside code", () => {
    const el = host("`arr[1]`", { citation: chip });
    expect(el.querySelector(".cortex-cite")).toBeNull();
    expect(el.querySelector("code")!.textContent).toBe("arr[1]");
  });
});

describe("renderMarkdown: security", () => {
  it("renders raw html as literal text, not elements", () => {
    const el = host('<img src=x onerror=alert(1)>');
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("does not create script, iframe, svg or style elements", () => {
    const src =
      '<script>alert(1)</script>\n\n' +
      '<iframe src="javascript:alert(1)"></iframe>\n\n' +
      '<svg onload="alert(1)"></svg>\n\n' +
      '<style>body{display:none}</style>';
    const el = host(src);
    for (const tag of ["script", "iframe", "svg", "style"]) {
      expect(el.querySelector(tag), tag).toBeNull();
    }
    expect(el.textContent).toContain("<script>alert(1)</script>");
    expect(el.textContent).toContain("<iframe");
  });

  it("keeps html literal inside emphasis, lists, headings and quotes", () => {
    const el = host(
      "# <b>head</b>\n\n- <img src=x onerror=alert(1)>\n\n> <img src=y onerror=alert(2)>\n\n**<img src=z>**"
    );
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("<b>head</b>");
    expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(el.textContent).toContain("<img src=y onerror=alert(2)>");
    expect(el.textContent).toContain("<img src=z>");
  });

  it("does not decode html entities", () => {
    const el = host("&lt;img src=x onerror=alert(1)&gt;");
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("never produces an element with an on* handler attribute", () => {
    const el = host(
      '<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n<a href="javascript:alert(1)">x</a>'
    );
    for (const node of Array.from(el.querySelectorAll("*"))) {
      for (const attr of Array.from(node.attributes)) {
        expect(attr.name.startsWith("on"), `${node.tagName}[${attr.name}]`).toBe(false);
        expect(attr.value.toLowerCase().includes("javascript:"), attr.name).toBe(false);
      }
    }
  });

  it("only ever emits a safe set of tags", () => {
    const src =
      "# h\n\n## h2\n\n### h3\n\n> quote\n\n- a\n  - b\n\n1. one\n\n```js\ncode\n```\n\n" +
      "**b** *i* ~~s~~ `c` https://example.com [1] [x](https://example.com)\n\n---\n\n<img src=x>";
    const el = host(src, { citation: chip });
    const allowed = new Set([
      "P", "BR", "STRONG", "EM", "DEL", "CODE", "PRE", "UL", "OL", "LI",
      "BLOCKQUOTE", "H1", "H2", "H3", "HR", "A", "SPAN",
    ]);
    for (const node of Array.from(el.querySelectorAll("*"))) {
      expect(allowed.has(node.tagName), node.tagName).toBe(true);
    }
  });

  it("the module source contains no html-string sinks", () => {
    // jsdom gives import.meta.url an http origin, so resolve from the repo root.
    const raw = readFileSync(resolve(process.cwd(), "src/content/markdown-render.ts"), "utf8");
    expect(raw).toContain("export function renderMarkdown");
    // The header comment names the banned sinks on purpose; scan code only.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const sink of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "eval(",
      "new Function",
      "createContextualFragment",
      "DOMParser",
    ]) {
      expect(source.includes(sink), sink).toBe(false);
    }
  });
});

describe("renderMarkdown: partial and hostile input never throws", () => {
  const partials = [
    "**unterminated bold",
    "*unterminated italic",
    "__half",
    "~~half",
    "`unterminated code",
    "```js\nconst a =",
    "```",
    "half written citation [1,",
    "[1, 6",
    "[",
    "[]",
    "[](",
    "[x](",
    "[x](https://example.com",
    "- ",
    "-",
    "> ",
    "#",
    "# ",
    "1.",
    "1. ",
    "***",
    "****",
    "_____",
    "~",
    "\\",
    "https://",
    "http://",
    "<",
    "a".repeat(5000),
    "*".repeat(200),
    "[".repeat(200),
    "`".repeat(200),
    "- a\n".repeat(200),
  ];

  for (const src of partials) {
    it(`survives ${JSON.stringify(src.slice(0, 32))}`, () => {
      expect(() => host(src, { citation: chip })).not.toThrow();
    });
  }

  it("renders an unterminated bold marker as text", () => {
    const el = host("this is **still coming");
    expect(el.querySelector("strong")).toBeNull();
    expect(el.textContent).toBe("this is **still coming");
  });

  it("renders a half written citation as text", () => {
    const el = host("a claim [1, 6", { citation: chip });
    expect(el.querySelector(".cortex-cite")).toBeNull();
    expect(el.textContent).toBe("a claim [1, 6");
  });

  it("renders an unterminated inline code marker as text", () => {
    const el = host("run `npm ins");
    expect(el.querySelector("code")).toBeNull();
    expect(el.textContent).toBe("run `npm ins");
  });

  it("handles every prefix of a full answer", () => {
    const doc =
      "## Chips\n\n" +
      "You watched videos about **EUV lithography** [1, 6, 16] and read more [2][3].\n\n" +
      "- `ASML` makes the machines\n" +
      "  - based in https://www.asml.com/\n" +
      "- TSMC uses them\n\n" +
      "> A quote with *emphasis*\n\n" +
      "```ts\nconst n: number = 1;\n```\n\n---\n\nDone. <img src=x onerror=alert(1)>";
    for (let i = 0; i <= doc.length; i++) {
      const slice = doc.slice(0, i);
      expect(() => {
        const el = host(slice, { citation: chip });
        expect(el.querySelector("img")).toBeNull();
      }, `prefix ${i}`).not.toThrow();
    }
  });
});

describe("renderMarkdown: realistic answers", () => {
  it("renders a bold-led bullet without leaking markers", () => {
    const el = host("- **ASML**: the only EUV supplier [1]\n- **TSMC**: the biggest customer [2]", {
      citation: chip,
    });
    const items = el.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].querySelector("strong")!.textContent).toBe("ASML");
    expect(el.textContent).not.toContain("*");
    expect(chipNums(el)).toEqual(["1", "2"]);
  });

  it("renders a mixed answer into the expected block sequence", () => {
    const el = host(
      "## What you read\n\n" +
        "You looked at **three** things [1, 2].\n\n" +
        "1. A primer on lithography\n" +
        "2. A teardown\n\n" +
        "> Worth revisiting\n\n" +
        "```py\nprint('hi')\n```",
      { citation: chip }
    );
    const tags = Array.from(el.children).map((c) => c.tagName);
    expect(tags).toEqual(["H2", "P", "OL", "BLOCKQUOTE", "PRE"]);
    expect(chipNums(el)).toEqual(["1", "2"]);
    expect(el.querySelector("pre code")!.textContent).toBe("print('hi')");
  });

  it("is usable as the stream renderer's (text) => Node final renderer", () => {
    const renderFinal: (text: string) => Node = (text) => renderMarkdown(text, { citation: chip });
    const container = document.createElement("div");
    container.appendChild(renderFinal("- done [9]"));
    expect(container.querySelectorAll("li").length).toBe(1);
    expect(chipNums(container)).toEqual(["9"]);
  });
});

describe("renderMarkdownInto", () => {
  it("clears the element and appends the rendered nodes", () => {
    const el = document.createElement("div");
    const stale = document.createElement("span");
    stale.textContent = "old";
    el.appendChild(stale);
    el.appendChild(document.createTextNode("stale text"));

    renderMarkdownInto(el, "- fresh **one**\n- fresh two");

    expect(el.textContent).not.toContain("old");
    expect(el.textContent).not.toContain("stale text");
    expect(el.querySelectorAll("li").length).toBe(2);
    expect(stale.parentNode).toBeNull();
  });

  it("is idempotent when called repeatedly, as streaming does", () => {
    const el = document.createElement("div");
    for (const text of ["He", "Hello **wo", "Hello **world**", "Hello **world**!"]) {
      renderMarkdownInto(el, text, { citation: chip });
    }
    expect(el.querySelectorAll("p").length).toBe(1);
    expect(el.textContent).toBe("Hello world!");
  });

  it("clears the element for empty input", () => {
    const el = document.createElement("div");
    renderMarkdownInto(el, "hello");
    renderMarkdownInto(el, "");
    expect(el.childNodes.length).toBe(0);
  });

  it("passes options through", () => {
    const el = document.createElement("div");
    renderMarkdownInto(el, "claim [4, 5]", { citation: chip });
    expect(chipNums(el)).toEqual(["4", "5"]);
  });
});
