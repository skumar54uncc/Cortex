/** In-memory chrome.storage.local (+ optional session) shim for Vitest. */

export type StorageRecord = Record<string, unknown>;

function makeArea(initial: StorageRecord = {}): {
  area: chrome.storage.LocalStorageArea;
  getAll: () => StorageRecord;
  setData: (next: StorageRecord) => void;
} {
  let data: StorageRecord = { ...initial };

  const area = {
    get: (
      keys?: string | string[] | { [key: string]: unknown } | null,
      callback?: (items: { [key: string]: unknown }) => void
    ): Promise<{ [key: string]: unknown }> => {
      const result: StorageRecord = {};
      const keyList =
        keys == null
          ? Object.keys(data)
          : Array.isArray(keys)
            ? keys
            : typeof keys === "string"
              ? [keys]
              : Object.keys(keys as Record<string, unknown>);

      for (const k of keyList) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          result[k] = data[k];
        }
      }
      callback?.(result);
      return Promise.resolve(result);
    },
    set: (
      items: { [key: string]: unknown },
      callback?: () => void
    ): Promise<void> => {
      data = { ...data, ...items };
      callback?.();
      return Promise.resolve();
    },
    remove: (
      keys: string | string[],
      callback?: () => void
    ): Promise<void> => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        delete data[k];
      }
      callback?.();
      return Promise.resolve();
    },
    clear: (callback?: () => void): Promise<void> => {
      data = {};
      callback?.();
      return Promise.resolve();
    },
    getBytesInUse: (
      _keys?: string | string[] | null,
      callback?: (bytesInUse: number) => void
    ): Promise<number> => {
      callback?.(0);
      return Promise.resolve(0);
    },
    setAccessLevel: (): Promise<void> => Promise.resolve(),
    removeAccessLevel: (): Promise<void> => Promise.resolve(),
    getKeys: (callback?: (keys: string[]) => void): Promise<string[]> => {
      const keys = Object.keys(data);
      callback?.(keys);
      return Promise.resolve(keys);
    },
    onChanged: {
      addListener: () => undefined,
      removeListener: () => undefined,
      hasListener: () => false,
      hasListeners: () => false,
    },
  } as unknown as chrome.storage.LocalStorageArea;

  return {
    area,
    getAll: () => ({ ...data }),
    setData: (next) => {
      data = { ...next };
    },
  };
}

export function createChromeStorageLocalMock(
  initial: StorageRecord = {}
): {
  storage: { local: chrome.storage.LocalStorageArea; session: chrome.storage.SessionStorageArea };
  getAll: () => StorageRecord;
  getSessionAll: () => StorageRecord;
} {
  const local = makeArea(initial);
  const session = makeArea();
  return {
    storage: {
      local: local.area,
      session: session.area as unknown as chrome.storage.SessionStorageArea,
    },
    getAll: local.getAll,
    getSessionAll: session.getAll,
  };
}

export function installChromeStorageMock(initial: StorageRecord = {}): () => void {
  const { storage } = createChromeStorageLocalMock(initial);
  const prev = globalThis.chrome;
  globalThis.chrome = {
    ...(prev ?? {}),
    storage,
    runtime: {
      ...(prev?.runtime ?? {}),
      id: prev?.runtime?.id ?? "test-extension-id",
      lastError: undefined,
    },
  } as typeof chrome;
  return () => {
    globalThis.chrome = prev as typeof chrome;
  };
}
