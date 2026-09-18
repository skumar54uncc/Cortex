// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  videoIdFromUrl,
  parsePlayerResponse,
  pickCaptionTrack,
  captionJson3Url,
  json3ToWindows,
  transcriptPanelWindows,
  metadataText,
  transcriptChunks,
  createPlaybackTracker,
  youtubeCitationHref,
  MAX_TRANSCRIPT_WINDOWS,
} from "../src/lib/capture/youtube";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", "youtube", n), "utf8");
const PR = JSON.parse(fx("player-response.json"));

describe("videoIdFromUrl", () => {
  it("reads watch, short, shorts and embed URLs; rejects others", () => {
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=tIdAl4Mgr01&t=5s")).toBe("tIdAl4Mgr01");
    expect(videoIdFromUrl("https://m.youtube.com/watch?v=tIdAl4Mgr01")).toBe("tIdAl4Mgr01");
    expect(videoIdFromUrl("https://youtu.be/tIdAl4Mgr01?si=x")).toBe("tIdAl4Mgr01");
    expect(videoIdFromUrl("https://www.youtube.com/shorts/tIdAl4Mgr01")).toBe("tIdAl4Mgr01");
    expect(videoIdFromUrl("https://www.youtube.com/embed/tIdAl4Mgr01")).toBe("tIdAl4Mgr01");
    expect(videoIdFromUrl("https://www.youtube.com/feed/history")).toBeNull();
    expect(videoIdFromUrl("https://evil.test/watch?v=tIdAl4Mgr01")).toBeNull();
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=short")).toBeNull();
  });
});

describe("parsePlayerResponse", () => {
  it("keeps only the fields Cortex needs", () => {
    const p = parsePlayerResponse(PR)!;
    expect(p.videoId).toBe("tIdAl4Mgr01");
    expect(p.title).toBe("Tidal microgrids explained");
    expect(p.channel).toBe("Tidegrid Weekly");
    expect(p.tracks).toHaveLength(3);
    expect(JSON.stringify(p)).not.toContain("huge");
  });

  it("rejects junk", () => {
    expect(parsePlayerResponse(null)).toBeNull();
    expect(parsePlayerResponse({ videoDetails: { videoId: 5 } })).toBeNull();
  });
});

describe("pickCaptionTrack", () => {
  const { tracks } = parsePlayerResponse(PR)!;
  it("prefers manual captions in the page language, then manual English, then auto", () => {
    expect(pickCaptionTrack(tracks, "de")?.languageCode).toBe("de");
    const en = pickCaptionTrack(tracks, "fr")!;
    expect(en.languageCode).toBe("en");
    expect(en.kind).toBeUndefined();
    expect(pickCaptionTrack(tracks.filter((t) => t.kind === "asr"), "en")?.kind).toBe("asr");
    expect(pickCaptionTrack([], "en")).toBeNull();
  });
});

describe("captionJson3Url", () => {
  it("adds fmt=json3 only to youtube.com timedtext URLs", () => {
    expect(captionJson3Url("https://www.youtube.com/api/timedtext?v=x&lang=en")).toBe(
      "https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=json3"
    );
    expect(captionJson3Url("https://www.youtube.com/api/timedtext?v=x&fmt=srv3")).toBe(
      "https://www.youtube.com/api/timedtext?v=x&fmt=json3"
    );
    expect(captionJson3Url("https://evil.test/api/timedtext?v=x")).toBeNull();
    expect(captionJson3Url("https://www.youtube.com/redirect?q=x")).toBeNull();
    expect(captionJson3Url("javascript:alert(1)")).toBeNull();
  });
});

describe("json3ToWindows", () => {
  it("groups caption events into ~60 s windows with start and end times", () => {
    const w = json3ToWindows(JSON.parse(fx("captions.json3.json")), 60);
    expect(w).toEqual([
      { startSec: 0, endSec: 60, text: "Welcome back to Tidegrid Weekly. Today: tidal microgrids. Slack tide is when the turbines rest." },
      { startSec: 60, endSec: 120, text: "Batteries carry the island through slack tide." },
      { startSec: 120, endSec: 180, text: "Islanding drills happen every spring." },
    ]);
  });

  it("returns [] for malformed input", () => {
    expect(json3ToWindows({ events: "nope" }, 60)).toEqual([]);
    expect(json3ToWindows(null, 60)).toEqual([]);
  });
});

describe("transcriptPanelWindows (DOM fallback)", () => {
  it("reads timestamps and text from the transcript panel", () => {
    const doc = new DOMParser().parseFromString(fx("transcript-panel.html"), "text/html");
    expect(transcriptPanelWindows(doc, 60)).toEqual([
      { startSec: 0, endSec: 60, text: "Welcome to the panel transcript." },
      { startSec: 60, endSec: 120, text: "Second minute of the talk." },
      { startSec: 3900, endSec: 3960, text: "An hour in." },
    ]);
  });
});

describe("metadataText", () => {
  it("indexes title, channel, description and chapters when there is no transcript", () => {
    const t = metadataText(parsePlayerResponse(PR)!);
    expect(t).toContain("Tidal microgrids explained");
    expect(t).toContain("Channel: Tidegrid Weekly");
    expect(t).toContain("Chapters: Intro (0:00); Slack tide storage (1:05); Islanding drills (2:30)");
    expect(t).toContain("How island microgrids use tidal turbines.");
  });
});

describe("transcriptChunks", () => {
  it("builds transcript chunks with video locators and a timestamp prefix", () => {
    const chunks = transcriptChunks("tIdAl4Mgr01", [{ startSec: 60, endSec: 120, text: "Slack tide." }]);
    expect(chunks).toEqual([
      { ord: 1000, text: "[1:00] Slack tide.", kind: "transcript", locator: { videoId: "tIdAl4Mgr01", startSec: 60, endSec: 120 } },
    ]);
  });

  it("caps the number of windows", () => {
    const many = Array.from({ length: MAX_TRANSCRIPT_WINDOWS + 50 }, (_, i) => ({ startSec: i * 60, endSec: i * 60 + 60, text: "x" }));
    expect(transcriptChunks("tIdAl4Mgr01", many)).toHaveLength(MAX_TRANSCRIPT_WINDOWS);
  });
});

describe("youtubeCitationHref", () => {
  it("links to the moment in the video", () => {
    expect(youtubeCitationHref({ videoId: "tIdAl4Mgr01", startSec: 125, endSec: 185 })).toBe(
      "https://www.youtube.com/watch?v=tIdAl4Mgr01&t=125s"
    );
  });
});

describe("createPlaybackTracker (index only after 30 s of playback)", () => {
  it("fires once after 30 s of accumulated playing time, ignoring paused time", () => {
    let now = 0;
    const onReady = vi.fn();
    const t = createPlaybackTracker(30, onReady, () => now);
    t.playing();
    now = 20_000;
    t.paused();
    now = 500_000; // paused for a long time: does not count
    t.playing();
    now = 509_000;
    t.tick();
    expect(onReady).not.toHaveBeenCalled();
    now = 510_000;
    t.tick();
    expect(onReady).toHaveBeenCalledTimes(1);
    now = 600_000;
    t.tick();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("reset() starts over for a new video", () => {
    let now = 0;
    const onReady = vi.fn();
    const t = createPlaybackTracker(30, onReady, () => now);
    t.playing();
    now = 25_000;
    t.reset();
    t.playing();
    now = 50_000;
    t.tick();
    expect(onReady).not.toHaveBeenCalled();
    now = 55_000;
    t.tick();
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

import { sanitizeTranscriptPayload } from "../src/lib/capture/youtube";

describe("sanitizeTranscriptPayload (service worker side)", () => {
  const tabUrl = "https://www.youtube.com/watch?v=tIdAl4Mgr01&list=PL1";
  const good = {
    url: "https://www.youtube.com/watch?v=tIdAl4Mgr01&list=PL1",
    videoId: "tIdAl4Mgr01",
    title: "Tidal microgrids explained",
    channel: "Tidegrid Weekly",
    lengthSeconds: 185,
    windows: [{ startSec: 0, endSec: 60, text: "Welcome." }],
    metadata: "Tidal microgrids explained",
  };

  it("accepts a payload for the video in the sender tab", () => {
    const s = sanitizeTranscriptPayload(good, tabUrl)!;
    expect(s.videoId).toBe("tIdAl4Mgr01");
    expect(s.windows).toEqual([{ startSec: 0, endSec: 60, text: "Welcome." }]);
  });

  it("rejects a video id or URL that does not match the tab", () => {
    expect(sanitizeTranscriptPayload({ ...good, videoId: "zzzzzzzzzzz" }, tabUrl)).toBeNull();
    expect(sanitizeTranscriptPayload({ ...good, url: "https://www.youtube.com/watch?v=zzzzzzzzzzz" }, tabUrl)).toBeNull();
    expect(sanitizeTranscriptPayload(good, "https://evil.test/watch?v=tIdAl4Mgr01")).toBeNull();
  });

  it("drops malformed windows and caps sizes", () => {
    const s = sanitizeTranscriptPayload(
      {
        ...good,
        title: "T".repeat(1000),
        windows: [
          { startSec: "0", endSec: 60, text: "bad start" },
          { startSec: 0, endSec: 60, text: 7 },
          { startSec: 60, endSec: 120, text: "x".repeat(10_000) },
        ],
      },
      tabUrl
    )!;
    expect(s.title.length).toBeLessThanOrEqual(300);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0].text.length).toBeLessThanOrEqual(4000);
  });
});
