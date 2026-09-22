import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal browser-level CDP client for targets Playwright does not expose,
 * such as the extension's offscreen document (where embeddings and chat run).
 * Chromium writes DevToolsActivePort into the user data dir when launched
 * with --remote-debugging-port=0.
 */
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Listener = (params: Record<string, unknown>, sessionId?: string) => void;

export class BrowserCdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<Listener>>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: Record<string, unknown>;
        sessionId?: string;
      };
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method) {
        for (const l of this.listeners.get(msg.method) ?? []) l(msg.params ?? {}, msg.sessionId);
      }
    });
  }

  static async connect(userDataDir: string, timeoutMs = 10_000): Promise<BrowserCdp> {
    const file = join(userDataDir, "DevToolsActivePort");
    const deadline = Date.now() + timeoutMs;
    while (!existsSync(file)) {
      if (Date.now() > deadline) throw new Error("DevToolsActivePort not found");
      await new Promise((r) => setTimeout(r, 100));
    }
    const [port, path] = readFileSync(file, "utf8").trim().split(/\r?\n/);
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP websocket failed")), { once: true });
    });
    return new BrowserCdp(ws);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method: string, l: Listener): void {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method)!.add(l);
  }

  close(): void {
    this.ws.close();
  }

  /** Attaches to the extension offscreen document (waits until it exists). */
  async attachOffscreen(timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { targetInfos } = await this.send<{ targetInfos: { targetId: string; url: string }[] }>(
        "Target.getTargets"
      );
      const off = targetInfos.find((t) => t.url.includes("/offscreen.html"));
      if (off) {
        const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", {
          targetId: off.targetId,
          flatten: true,
        });
        return sessionId;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("offscreen document not found");
  }

  async evaluate<T = unknown>(sessionId: string, expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value as T;
  }
}

/** Installs a fake Chrome Prompt API (Gemini Nano) in the offscreen document. */
export const FAKE_NANO_SCRIPT = (tokens: string[]): string => `(() => {
  window.__cortexE2EPrompts = [];
  window.LanguageModel = {
    availability: async () => "available",
    params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }),
    create: async (opts) => ({
      inputUsage: 0,
      inputQuota: 100000,
      destroy() {},
      prompt: async () => "",
      promptStreaming: (input) => {
        window.__cortexE2EPrompts.push({
          system: JSON.stringify(opts?.initialPrompts ?? []),
          options: JSON.stringify(opts ?? {}),
          input,
        });
        const toks = ${JSON.stringify(tokens)};
        return new ReadableStream({
          start(c) { for (const t of toks) c.enqueue(t); c.close(); },
        });
      },
    }),
  };
  return true;
})()`;

export interface ConsoleProblem {
  /** Which extension page said it: offscreen.html, the service worker, ... */
  source: string;
  level: string;
  text: string;
}

/**
 * Every warning and error Chrome logs against the extension's own targets,
 * including the ones no page listener sees (the offscreen document and the
 * service worker). Browser level messages, such as the Prompt API complaining
 * that a request named no output language, arrive as Log.entryAdded.
 */
export async function recordExtensionConsole(cdp: BrowserCdp): Promise<ConsoleProblem[]> {
  const problems: ConsoleProblem[] = [];
  const urlBySession = new Map<string, string>();
  const label = (sessionId?: string): string => {
    const url = urlBySession.get(String(sessionId)) ?? "";
    return url.split("/").pop() || url || "unknown";
  };

  cdp.on("Log.entryAdded", (p, sessionId) => {
    const entry = p.entry as { level?: string; text?: string; url?: string };
    if (entry.level !== "error" && entry.level !== "warning") return;
    // "Failed to load resource" on its own never says what failed.
    const where = entry.url ? ` [${entry.url}]` : "";
    problems.push({ source: label(sessionId), level: String(entry.level), text: `${entry.text ?? ""}${where}` });
  });
  cdp.on("Runtime.exceptionThrown", (p, sessionId) => {
    const d = p.exceptionDetails as { text?: string; exception?: { description?: string } };
    problems.push({
      source: label(sessionId),
      level: "error",
      text: String(d.exception?.description ?? d.text ?? ""),
    });
  });
  cdp.on("Runtime.consoleAPICalled", (p, sessionId) => {
    const type = String(p.type ?? "");
    if (type !== "error" && type !== "warning") return;
    const args = (p.args as { value?: unknown; description?: string }[]) ?? [];
    problems.push({
      source: label(sessionId),
      level: type,
      text: args.map((a) => String(a.value ?? a.description ?? "")).join(" "),
    });
  });

  cdp.on("Target.attachedToTarget", (p) => {
    const sid = String(p.sessionId);
    const info = p.targetInfo as { type?: string; url?: string };
    urlBySession.set(sid, String(info.url ?? ""));
    void (async () => {
      if (info.type !== "browser_ui") {
        await cdp.send("Log.enable", {}, sid).catch(() => undefined);
        await cdp.send("Runtime.enable", {}, sid).catch(() => undefined);
      }
      await cdp.send("Runtime.runIfWaitingForDebugger", {}, sid).catch(() => undefined);
    })();
  });
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  return problems;
}

/**
 * Records every network request made by the offscreen document from the
 * moment it is created. Auto-attach pauses each new target before it runs;
 * Network is enabled on every one (a paused target has no URL yet), then it
 * is resumed. Requests are attributed by their documentURL.
 */
export async function recordOffscreenRequests(
  cdp: BrowserCdp
): Promise<{ urls: string[]; attached: () => boolean }> {
  const urls: string[] = [];
  let seen = false;
  cdp.on("Network.requestWillBeSent", (p) => {
    const doc = String(p.documentURL ?? "");
    if (!doc.includes("/offscreen.html")) return;
    seen = true;
    urls.push(String((p.request as { url?: string })?.url ?? ""));
  });
  cdp.on("Target.attachedToTarget", (p) => {
    const sid = String(p.sessionId);
    const info = p.targetInfo as { type?: string };
    void (async () => {
      if (info.type !== "browser_ui") {
        await cdp.send("Network.enable", {}, sid).catch(() => undefined);
      }
      await cdp.send("Runtime.runIfWaitingForDebugger", {}, sid).catch(() => undefined);
    })();
  });
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  return { urls, attached: () => seen };
}
