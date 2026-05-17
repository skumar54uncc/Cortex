/**
 * Optional chrome.* stubs for Node eval. Retrieval path does not require this today;
 * import only if a future production import pulls chrome at module load time.
 */
export function installChromeShim(): void {
  if (typeof globalThis.chrome !== "undefined") return;
  globalThis.chrome = {
    runtime: { id: "cortex-eval", lastError: undefined },
  } as typeof chrome;
}
