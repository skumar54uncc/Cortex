/**
 * @vitest-environment jsdom
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CORTEX_DB_SCHEMA_VERSION } from "../shared/cortex-constants";
import { installChromeStorageMock } from "../../tests/helpers/chrome-storage-mock";
import type { StatsSnapshot } from "../lib/stats-snapshot-types";
import { STATS_SNAPSHOT_STORAGE_KEY } from "../lib/stats-snapshot-storage";

vi.mock("../shared/extension-runtime", () => ({
  sendRuntimeMessage: vi.fn(),
}));

vi.mock("../styles/cortex-theme.css", () => ({}));
vi.mock("../styles/brand-fonts", () => ({
  injectBrandFontFacesInto: vi.fn(),
}));

const sampleSnap: StatsSnapshot = {
  schemaVersion: CORTEX_DB_SCHEMA_VERSION,
  updatedAt: Date.now(),
  pageCount: 10,
  chunkCount: 40,
  visitCount: 25,
  indexingPaused: false,
  recent: [],
};

function mountPopupDom(): void {
  const root = document.createElement("main");
  root.innerHTML = [
    '<strong id="cx-indexing-state"></strong>',
    '<span id="cx-indexing-detail"></span>',
    '<p id="cx-current-tab" hidden></p>',
    '<section id="cx-empty-state" hidden></section>',
    '<section id="cx-popup-library">',
    '<div id="cx-stats-error" hidden><span id="cx-stats-error-msg"></span></div>',
    '<dl id="cx-stats-dl">',
    '<dd id="cx-pages"></dd>',
    '<dd id="cx-chunks"></dd>',
    '<dd id="cx-visits"></dd>',
    "</dl>",
    '<div id="cx-storage-wrap" hidden>',
    '<motion id="cx-storage-bar" class="cx-storage-bar"></motion>',
    '<span id="cx-storage-text"></span>',
    "</div>",
    "</section>",
  ].join("");
  const bar = root.querySelector("#cx-storage-bar");
  if (bar) {
    const div = document.createElement("div");
    div.id = "cx-storage-bar";
    div.className = "cx-storage-bar";
    bar.replaceWith(div);
  }
  document.body.replaceChildren(root);
}

describe("loadPopup snapshot path", () => {
  let restoreChrome: () => void;

  beforeEach(() => {
    restoreChrome = installChromeStorageMock({
      [STATS_SNAPSHOT_STORAGE_KEY]: sampleSnap,
    });
    mountPopupDom();
    vi.stubGlobal("chrome", {
      ...globalThis.chrome,
      tabs: {
        query: vi
          .fn()
          .mockResolvedValue([{ url: "https://example.com", incognito: false }]),
      },
    });
  });

  afterEach(() => {
    restoreChrome();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("does not call the service worker when a snapshot exists", async () => {
    const { sendRuntimeMessage } = await import("../shared/extension-runtime");
    const { loadPopup } = await import("./popup");

    await loadPopup();

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
    expect(document.querySelector("#cx-pages")?.textContent).toBe("10");
  });
});
