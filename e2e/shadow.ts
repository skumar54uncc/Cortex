import type { Page } from "@playwright/test";

/**
 * Helpers to reach the overlay inside its CLOSED shadow root through CDP.
 * Playwright locators only pierce open shadow roots; production builds use
 * `attachShadow({ mode: "closed" })` (Security Review 1, finding 001).
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type CdpNode = {
  nodeId: number;
  nodeName: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  nodeValue?: string;
};

function attrsOf(n: CdpNode): Record<string, string> {
  const out: Record<string, string> = {};
  const a = n.attributes ?? [];
  for (let i = 0; i + 1 < a.length; i += 2) out[a[i]] = a[i + 1];
  return out;
}

function textOf(n: CdpNode): string {
  if (n.nodeName === "#text") return n.nodeValue ?? "";
  return (n.children ?? []).map(textOf).join("");
}

export interface ShadowMatch {
  nodeId: number;
  attrs: Record<string, string>;
  text: string;
}

export async function findInShadow(
  page: Page,
  predicate: (nodeName: string, attrs: Record<string, string>, text: string) => boolean
): Promise<ShadowMatch[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
      root: CdpNode;
    };
    const found: ShadowMatch[] = [];
    const walk = (n: CdpNode): void => {
      const attrs = attrsOf(n);
      if (n.nodeName !== "#text" && predicate(n.nodeName, attrs, textOf(n))) {
        found.push({ nodeId: n.nodeId, attrs, text: textOf(n) });
      }
      for (const c of n.children ?? []) walk(c);
      for (const s of n.shadowRoots ?? []) walk(s);
    };
    walk(root);
    return found;
  } finally {
    await cdp.detach();
  }
}

export async function boxOf(page: Page, nodeId: number): Promise<Box> {
  const cdp = await page.context().newCDPSession(page);
  try {
    // getBoxModel needs a fresh document handle in this session.
    await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const { model } = (await cdp.send("DOM.getBoxModel", { nodeId })) as {
      model: { border: number[] };
    };
    const [x1, y1, x2, , , y3] = model.border;
    return { x: x1, y: y1, width: x2 - x1, height: y3 - y1 };
  } finally {
    await cdp.detach();
  }
}

function hasClass(attrs: Record<string, string>, cls: string): boolean {
  return (attrs.class ?? "").split(/\s+/).includes(cls);
}

/** Bounding box of the overlay panel. */
export async function panelBox(page: Page): Promise<Box> {
  const [panel] = await findInShadow(page, (_n, a) => hasClass(a, "cortex-panel"));
  if (!panel) throw new Error("cortex-panel not found in shadow DOM");
  return boxOf(page, panel.nodeId);
}

/** Click an element inside the shadow root by class and optional text. */
export async function clickInShadow(page: Page, cls: string, text?: string): Promise<void> {
  const matches = await findInShadow(
    page,
    (_n, a, t) => hasClass(a, cls) && (text == null || t.trim() === text)
  );
  if (!matches.length) throw new Error(`no .${cls} ${text ?? ""} in shadow DOM`);
  const b = await boxOf(page, matches[0].nodeId);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** All matches with a given class (attrs + text) for assertions. */
export async function queryInShadow(page: Page, cls: string): Promise<ShadowMatch[]> {
  return findInShadow(page, (_n, a) => hasClass(a, cls));
}
