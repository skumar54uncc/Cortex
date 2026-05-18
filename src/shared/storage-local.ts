/** Safe chrome.storage.local access — never throws if `chrome.storage` is missing. */

function chromeApi(): typeof chrome | undefined {
  try {
    return (globalThis as { chrome?: typeof chrome }).chrome;
  } catch {
    return undefined;
  }
}

export function storageLocalArea(): chrome.storage.LocalStorageArea | null {
  try {
    return chromeApi()?.storage?.local ?? null;
  } catch {
    return null;
  }
}

export function storageLocalGet<T extends Record<string, unknown>>(
  keys: string | string[] | Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  const local = storageLocalArea();
  if (!local) return Promise.resolve({});
  return new Promise((resolve) => {
    local.get(keys as string | string[] | Record<string, unknown> | null, (r) => {
      if (chromeApi()?.runtime?.lastError) {
        resolve({});
        return;
      }
      resolve((r ?? {}) as Record<string, unknown>);
    });
  });
}

export function storageLocalSet(items: Record<string, unknown>): Promise<void> {
  const local = storageLocalArea();
  if (!local) {
    return Promise.reject(new Error("Storage unavailable"));
  }
  return new Promise((resolve, reject) => {
    local.set(items, () => {
      const err = chromeApi()?.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}
