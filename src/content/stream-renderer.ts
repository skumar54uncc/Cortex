/**
 * Streaming text renderer for Ask answers.
 *
 * Tokens are buffered and flushed at most once per animation frame, and the
 * flush appends to one text node that sits before the cursor. Rewriting
 * `textContent` on every token (the 1.0.x behaviour) forced a full re-layout
 * per token and made the thread jump.
 *
 * `finish(renderFinal)` swaps the plain text for the final rich node
 * (citations) synchronously so there is no empty frame between the two.
 */
export interface StreamRenderer {
  push: (token: string) => void;
  /** Render final content. `null` keeps the plain text. Removes the cursor. */
  finish: (renderFinal: ((text: string) => Node) | null) => void;
  /** Drop pending tokens and the cursor, keep what was already painted. */
  cancel: () => void;
  text: () => string;
}

export interface StreamRendererOptions {
  raf?: (cb: FrameRequestCallback) => number;
  /** Called after each flush, for scroll following. */
  onFlush?: () => void;
}

export function createStreamRenderer(
  container: HTMLElement,
  cursor: HTMLElement,
  opts: StreamRendererOptions = {}
): StreamRenderer {
  const raf =
    opts.raf ??
    ((cb: FrameRequestCallback): number =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(cb)
        : (setTimeout(() => cb(Date.now()), 16) as unknown as number));

  let textNode: Text | null = null;
  let painted = "";
  let pending = "";
  let frameQueued = false;
  let finished = false;

  /** One mutation per flush: first flush inserts a filled node, later ones appendData. */
  const flush = (): void => {
    frameQueued = false;
    if (finished || !pending) return;
    if (textNode && textNode.parentNode === container) {
      textNode.appendData(pending);
    } else {
      textNode = document.createTextNode(pending);
      if (cursor.parentNode === container) {
        container.insertBefore(textNode, cursor);
      } else {
        container.appendChild(textNode);
      }
    }
    painted += pending;
    pending = "";
    opts.onFlush?.();
  };

  return {
    push: (token: string) => {
      if (finished || !token) return;
      pending += token;
      if (!frameQueued) {
        frameQueued = true;
        raf(flush);
      }
    },
    finish: (renderFinal) => {
      if (finished) return;
      // Drain synchronously so the final render sees every token.
      if (pending) {
        painted += pending;
        pending = "";
      }
      finished = true;
      cursor.remove();
      if (renderFinal) {
        const finalNode = renderFinal(painted);
        container.textContent = "";
        container.appendChild(finalNode);
      } else if (textNode && textNode.parentNode === container) {
        textNode.data = painted;
      } else if (painted) {
        container.appendChild(document.createTextNode(painted));
      }
      opts.onFlush?.();
    },
    cancel: () => {
      finished = true;
      pending = "";
      cursor.remove();
    },
    text: () => painted + pending,
  };
}
