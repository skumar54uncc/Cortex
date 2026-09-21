// @vitest-environment jsdom
/**
 * The in-page YouTube capture controller: what gets indexed, and when.
 *
 * Every case here was a silent failure before Phase 5.6's fix:
 *  - a watch shorter than 30 s indexed nothing at all;
 *  - an SPA navigation (the normal way of watching several videos) left the
 *    controller with no player response, so the chunk was the tab title;
 *  - a video with no captions was only ever indexed after 30 s;
 *  - a video that was already playing when YouTube swapped the page under it
 *    never accumulated watch time again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createYouTubeCaptureController,
  METADATA_DWELL_MS,
  METADATA_MAX_WAIT_MS,
  SEND_RETRY_MS,
  type TranscriptPayload,
  type TranscriptWindow,
} from "../src/lib/capture/youtube";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", "youtube", n), "utf8");
const WATCH_HTML = fx("watch-page.html");
const VIDEO_A = "aaaaaaaaaaa";
const VIDEO_B = "bbbbbbbbbbb";
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function playerResponse(videoId: string, opts: { captions?: boolean; title?: string } = {}): unknown {
  return {
    videoDetails: {
      videoId,
      title: opts.title ?? `Video ${videoId}`,
      author: "Tidegrid Weekly",
      lengthSeconds: "600",
      shortDescription: `A long enough description of ${videoId} to be worth indexing.`,
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks:
          opts.captions === false
            ? []
            : [
                {
                  baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
                  languageCode: "en",
                  name: { simpleText: "English" },
                },
              ],
      },
    },
  };
}

const CAPTION_WINDOWS: TranscriptWindow[] = [
  {
    startSec: 0,
    endSec: 60,
    text: "Welcome back to Tidegrid Weekly. Today we are looking at tidal microgrids and why slack tide is the hard part of the day.",
  },
  {
    startSec: 60,
    endSec: 120,
    text: "Batteries carry the island through slack tide, and the drills happen every spring so the crew stays sharp.",
  },
];

interface Harness {
  controller: ReturnType<typeof createYouTubeCaptureController>;
  sent: TranscriptPayload[];
  requests: number;
  setUrl: (u: string) => void;
  setPlaying: (p: boolean) => void;
  setWindows: (w: TranscriptWindow[]) => void;
  advance: (ms: number) => Promise<void>;
  /** Simulate the page-world bridge answering the last request. */
  answerBridge: (raw: unknown) => void;
  refuseSends: (n: number) => void;
}

function harness(opts: { url?: string; windows?: TranscriptWindow[] } = {}): Harness {
  document.documentElement.innerHTML = WATCH_HTML;
  let t = 1_000_000;
  let url = opts.url ?? watchUrl(VIDEO_A);
  let playing = false;
  let windows = opts.windows ?? [];
  let refusals = 0;
  const sent: TranscriptPayload[] = [];
  const h = {
    sent,
    requests: 0,
    setUrl: (u: string) => {
      url = u;
    },
    setPlaying: (p: boolean) => {
      playing = p;
    },
    setWindows: (w: TranscriptWindow[]) => {
      windows = w;
    },
    refuseSends: (n: number) => {
      refusals = n;
    },
    answerBridge: (raw: unknown) => h.controller.offerPlayerInfo(raw),
    advance: async (ms: number) => {
      // One tick per simulated second, the way the content script polls.
      for (let i = 0; i < Math.ceil(ms / 1000); i++) {
        t += 1000;
        await h.controller.tick();
      }
    },
  } as Harness;
  h.controller = createYouTubeCaptureController({
    now: () => t,
    currentUrl: () => url,
    getDocument: () => document,
    isPlaying: () => playing,
    requestPlayerInfo: () => {
      h.requests += 1;
    },
    fetchWindows: async () => windows,
    send: async (p: TranscriptPayload) => {
      if (refusals > 0) {
        refusals -= 1;
        return false;
      }
      sent.push(p);
      return true;
    },
  });
  return h;
}

describe("YouTube capture: every watched video is indexed", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("indexes the video's identity after a few seconds, long before the 30 s gate", async () => {
    const h = harness();
    h.setPlaying(true);
    await h.advance(METADATA_DWELL_MS + 1000);
    expect(h.sent).toHaveLength(1);
    const p = h.sent[0]!;
    expect(p.videoId).toBe(VIDEO_A);
    expect(p.url).toBe(watchUrl(VIDEO_A));
    expect(p.windows).toEqual([]);
    expect(p.title).toBe("Tidal microgrids explained");
    expect(p.channel).toBe("Tidegrid Weekly");
    expect(p.metadata).toContain("Channel: Tidegrid Weekly");
    expect(p.metadata).toContain("tidal turbines");
    expect(p.metadata).toContain("Chapters:");
  });

  it("a ten second watch still leaves a document behind", async () => {
    const h = harness();
    h.setPlaying(true);
    await h.advance(10_000);
    h.setPlaying(false);
    h.setUrl("https://www.youtube.com/feed/subscriptions");
    await h.advance(2000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.videoId).toBe(VIDEO_A);
    expect(h.sent[0]!.metadata.length).toBeGreaterThan(40);
  });

  it("replaces the identity chunk with real transcript windows after 30 s of playback", async () => {
    const h = harness({ windows: CAPTION_WINDOWS });
    h.answerBridge(playerResponse(VIDEO_A));
    h.setPlaying(true);
    await h.advance(METADATA_DWELL_MS + 1000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.windows).toEqual([]);

    await h.advance(30_000);
    expect(h.sent).toHaveLength(2);
    const full = h.sent[1]!;
    expect(full.windows).toHaveLength(2);
    expect(full.windows[0]!.startSec).toBe(0);
    expect(full.lengthSeconds).toBe(600);
    // Sent once: the controller does not spam the same video.
    await h.advance(60_000);
    expect(h.sent).toHaveLength(2);
  });

  it("a video with no captions is still indexed, from its title, channel and description", async () => {
    const h = harness({ windows: [] });
    h.answerBridge(playerResponse(VIDEO_A, { captions: false }));
    h.setPlaying(true);
    await h.advance(40_000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.windows).toEqual([]);
    expect(h.sent[0]!.metadata).toContain("Tidegrid Weekly");
    // No second, empty send once the 30 s gate passes with nothing to add.
    await h.advance(60_000);
    expect(h.sent).toHaveLength(1);
  });

  it("never stores a chunk that is a timestamp and two words", async () => {
    const h = harness({ windows: [{ startSec: 0, endSec: 60, text: "okay so" }] });
    h.answerBridge(playerResponse(VIDEO_A));
    h.setPlaying(true);
    await h.advance(40_000);
    const last = h.sent[h.sent.length - 1]!;
    expect(last.windows).toEqual([]);
    expect(last.metadata).toContain("Transcript: okay so");
  });

  it("does nothing on a non-watch page", async () => {
    const h = harness({ url: "https://www.youtube.com/feed/history", windows: CAPTION_WINDOWS });
    h.setPlaying(true);
    await h.advance(60_000);
    expect(h.sent).toEqual([]);
    expect(h.controller.videoId()).toBeNull();
  });
});

describe("YouTube capture: SPA navigation from one video to the next", () => {
  it("arms the new video id and indexes it, without the previous video's data", async () => {
    const h = harness({ windows: CAPTION_WINDOWS });
    h.answerBridge(playerResponse(VIDEO_A));
    h.setPlaying(true);
    await h.advance(35_000);
    expect(h.sent.map((p) => p.videoId)).toEqual([VIDEO_A, VIDEO_A]);

    // history.pushState, the way YouTube navigates.
    h.setUrl(watchUrl(VIDEO_B));
    expect(h.controller.videoId()).toBe(VIDEO_A);
    await h.advance(1000);
    expect(h.controller.videoId()).toBe(VIDEO_B);
    // Watch time starts over for the new video.
    expect(h.controller.watchedMs()).toBeLessThan(2000);

    await h.advance(METADATA_DWELL_MS + 1000);
    const meta = h.sent[h.sent.length - 1]!;
    expect(meta.videoId).toBe(VIDEO_B);
    expect(meta.url).toBe(watchUrl(VIDEO_B));

    await h.advance(30_000);
    const full = h.sent[h.sent.length - 1]!;
    expect(full.videoId).toBe(VIDEO_B);
    expect(full.windows).toHaveLength(2);
  });

  it("keeps asking for the player response until the page stops answering with the old video", async () => {
    const h = harness();
    h.setUrl(watchUrl(VIDEO_B));
    await h.advance(1000);
    const before = h.requests;
    // The page still holds video A for a while: every answer is rejected.
    for (let i = 0; i < 4; i++) {
      h.answerBridge(playerResponse(VIDEO_A));
      await h.advance(1000);
    }
    expect(h.requests).toBeGreaterThan(before + 1);
    h.answerBridge(playerResponse(VIDEO_B));
    await h.advance(1000);
    const asked = h.requests;
    await h.advance(20_000);
    // Once the right video arrives the controller stops asking.
    expect(h.requests).toBe(asked);
    expect(h.sent[0]!.channel).toBe("Tidegrid Weekly");
  });

  it("counts watch time for a video that was already playing when the page swapped", async () => {
    const h = harness({ windows: CAPTION_WINDOWS });
    h.setPlaying(true);
    await h.advance(35_000);
    h.sent.length = 0;
    // No further media events: YouTube reuses the element that is already
    // rolling. Before the fix, the navigation reset stranded the tracker.
    h.setUrl(watchUrl(VIDEO_B));
    await h.advance(35_000);
    expect(h.sent.map((p) => p.videoId)).toEqual([VIDEO_B, VIDEO_B]);
    expect(h.sent[1]!.windows).toHaveLength(2);
  });

  it("does not file the new video under the previous video's title", async () => {
    const h = harness();
    h.answerBridge(playerResponse(VIDEO_A, { title: "Tidal microgrids explained" }));
    h.setPlaying(true);
    await h.advance(METADATA_DWELL_MS + 1000);
    expect(h.sent).toHaveLength(1);

    // New URL, but YouTube has not repainted the title or description yet.
    h.setUrl(watchUrl(VIDEO_B));
    await h.advance(METADATA_DWELL_MS + 2000);
    expect(h.sent).toHaveLength(1);

    // The page catches up (here via the player response).
    h.answerBridge(playerResponse(VIDEO_B, { title: "Harbour cranes" }));
    await h.advance(1000);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.title).toBe("Harbour cranes");
    expect(h.sent[1]!.videoId).toBe(VIDEO_B);
  });

  it("gives up waiting for the repaint rather than losing the video", async () => {
    const h = harness();
    h.answerBridge(playerResponse(VIDEO_A, { title: "Tidal microgrids explained" }));
    h.setPlaying(true);
    await h.advance(METADATA_DWELL_MS + 1000);
    h.setUrl(watchUrl(VIDEO_B));
    await h.advance(METADATA_MAX_WAIT_MS + 2000);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.videoId).toBe(VIDEO_B);
  });

  it("never attributes a payload to a URL the tab has already left", async () => {
    const h = harness({ windows: CAPTION_WINDOWS });
    h.setPlaying(true);
    await h.advance(29_000);
    h.setUrl(watchUrl(VIDEO_B));
    await h.advance(1000);
    for (const p of h.sent) expect(p.url).toBe(watchUrl(p.videoId));
  });
});

describe("YouTube capture: the service worker refusing a send", () => {
  it("retries after a backoff instead of losing the video", async () => {
    const h = harness();
    h.refuseSends(1);
    h.setPlaying(true);
    await h.advance(METADATA_DWELL_MS + 2000);
    expect(h.sent).toEqual([]);
    await h.advance(SEND_RETRY_MS + 2000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.videoId).toBe(VIDEO_A);
  });
});
