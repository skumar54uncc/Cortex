import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * Phase 5.6: YouTube capture. www.youtube.com is served by context.route from
 * self-authored fixtures (player responses and json3 captions); no real
 * YouTube request is made.
 *
 * The cases here are the ones a user hits every day: a video with captions, a
 * video with none, and several videos watched one after another in the same
 * tab, which YouTube does with history.pushState and no page load at all.
 */
const fx = (n: string) => readFileSync(join(__dirname, "..", "tests", "fixtures", "youtube", n), "utf8");
const CAPTIONS_A = fx("captions.json3.json");
const CAPTIONS_B = JSON.stringify({
  events: [
    {
      tStartMs: 0,
      dDurationMs: 9000,
      segs: [
        { utf8: "Second video now. The harbour cranes here run on the same island battery bank all night long." },
      ],
    },
    {
      tStartMs: 62000,
      dDurationMs: 9000,
      segs: [
        { utf8: "The crane operators schedule the heavy lifts around the tide so the bank never dips below half." },
      ],
    },
  ],
});

const VIDEO_A = "tIdAl4Mgr01";
const VIDEO_B = "hArBoUrCrA2";
const VIDEO_NO_CAPS = "nOcApTiOnS3";
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

interface VideoFixture {
  id: string;
  title: string;
  channel: string;
  description: string;
  captions: string | null;
}

const VIDEOS: Record<string, VideoFixture> = {
  [VIDEO_A]: {
    id: VIDEO_A,
    title: "Tidal microgrids explained",
    channel: "Tidegrid Weekly",
    description: "How island microgrids use tidal turbines.\n0:00 Intro\n1:05 Slack tide storage",
    captions: CAPTIONS_A,
  },
  [VIDEO_B]: {
    id: VIDEO_B,
    title: "Harbour cranes on battery power",
    channel: "Tidegrid Weekly",
    description: "What happens to the harbour cranes when the tide goes slack and the bank takes over.",
    captions: CAPTIONS_B,
  },
  [VIDEO_NO_CAPS]: {
    id: VIDEO_NO_CAPS,
    title: "Islanding drill, no captions",
    channel: "Tidegrid Weekly",
    description:
      "A walkthrough of the spring islanding drill on the north pier, filmed without any captions or subtitles at all.",
    captions: null,
  },
};

function playerResponse(v: VideoFixture): string {
  return JSON.stringify({
    videoDetails: {
      videoId: v.id,
      title: v.title,
      author: v.channel,
      lengthSeconds: "185",
      shortDescription: v.description,
    },
    captions: v.captions
      ? {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: `https://www.youtube.com/api/timedtext?v=${v.id}&lang=en`,
                languageCode: "en",
                name: { simpleText: "English" },
              },
            ],
          },
        }
      : {},
  });
}

/**
 * A cut-down watch page. `__cortexGoTo` reproduces a YouTube SPA navigation:
 * pushState, then the DOM and the player response are swapped under the same
 * document, and yt-navigate-finish fires. No page load happens.
 */
function watchHtml(v: VideoFixture): string {
  return `<!doctype html><html lang="en"><head><title>${v.title} - YouTube</title>
<script>
  var __cortexVideos = ${JSON.stringify(VIDEOS)};
  var __cortexPlayers = ${JSON.stringify(
    Object.fromEntries(Object.values(VIDEOS).map((x) => [x.id, JSON.parse(playerResponse(x))]))
  )};
  var ytInitialPlayerResponse = __cortexPlayers[${JSON.stringify(v.id)}];
  window.__cortexGoTo = function (id) {
    var next = __cortexVideos[id];
    history.pushState({}, "", "/watch?v=" + id);
    document.title = next.title + " - YouTube";
    document.querySelector("#cortex-title").textContent = next.title;
    document.querySelector("#cortex-channel").textContent = next.channel;
    document.querySelector("#cortex-desc").textContent = next.description;
    ytInitialPlayerResponse = __cortexPlayers[id];
    document.dispatchEvent(new CustomEvent("yt-navigate-finish", { bubbles: true }));
  };
</script></head>
<body><ytd-watch-metadata>
<div id="title"><h1><yt-formatted-string id="cortex-title">${v.title}</yt-formatted-string></h1></div>
<div id="owner"><ytd-channel-name><a id="cortex-channel" href="/c">${v.channel}</a></ytd-channel-name></div>
<div id="description-inline-expander"><yt-attributed-string id="cortex-desc">${v.description}</yt-attributed-string></div>
</ytd-watch-metadata>
<video width="640" height="360"></video>
</body></html>`;
}

async function routeYouTube(context: BrowserContext): Promise<void> {
  await context.route("https://www.youtube.com/api/timedtext**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("v") ?? "";
    const body = VIDEOS[id]?.captions;
    if (!body) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await context.route("https://www.youtube.com/watch**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("v") ?? VIDEO_A;
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: watchHtml(VIDEOS[id] ?? VIDEOS[VIDEO_A]!),
    });
  });
}

interface Chunk {
  text: string;
  locator: { startSec: number; endSec: number; videoId: string };
}

/**
 * Chunk rows carry a 384 float embedding each; only the fields under test are
 * brought back across the bridge, so polling stays cheap.
 */
function transcriptChunks(sw: Worker, videoId?: string): Promise<Chunk[]> {
  return sw.evaluate(
    (wanted) =>
      new Promise((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("chunks")) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
          all.onsuccess = () => {
            const rows = all.result as { kind?: string; text: string; locator?: { videoId?: string } }[];
            resolve(
              rows
                .filter((c) => c.kind === "transcript" && (!wanted || c.locator?.videoId === wanted))
                .map((c) => ({ text: c.text, locator: c.locator })) as never
            );
            db.close();
          };
        };
      }),
    videoId ?? ""
  );
}

function documents(sw: Worker): Promise<{ url: string; title: string }[]> {
  return sw.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("documents")) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction("documents", "readonly").objectStore("documents").getAll();
          all.onsuccess = () => {
            resolve(
              (all.result as { url: string; title: string }[]).map((d) => ({
                url: d.url,
                title: d.title,
              })) as never
            );
            db.close();
          };
        };
      })
  );
}

/** The fixture video has no media, so playback is signalled the way Chrome does. */
async function startPlayback(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("video")!.dispatchEvent(new Event("playing")));
}

test("a video with captions: identity first, then merged transcript windows", async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(150_000);
  await routeYouTube(context);
  const page = await context.newPage();
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  await page.goto(watch(VIDEO_A));
  await expect
    .poll(
      () => page.evaluate(() => Boolean((window as unknown as { __cortexYtBridge?: boolean }).__cortexYtBridge)),
      { timeout: 30_000 }
    )
    .toBe(true);
  await startPlayback(page);

  // Phase 1: the video is in the library long before the 30 s gate.
  await expect.poll(() => transcriptChunks(serviceWorker, VIDEO_A), { timeout: 30_000 }).toHaveLength(1);
  const identity = (await transcriptChunks(serviceWorker, VIDEO_A))[0]!;
  expect(identity.text).toContain("Tidal microgrids explained");
  expect(identity.text).toContain("Channel: Tidegrid Weekly");
  expect(identity.text.length).toBeGreaterThan(80);

  // Phase 2: after 30 s of playback the captions replace it.
  await expect.poll(() => transcriptChunks(serviceWorker, VIDEO_A), { timeout: 60_000 }).toHaveLength(2);
  const chunks = await transcriptChunks(serviceWorker, VIDEO_A);
  expect(chunks.map((c) => c.locator)).toEqual([
    { videoId: VIDEO_A, startSec: 0, endSec: 60 },
    { videoId: VIDEO_A, startSec: 60, endSec: 180 },
  ]);
  expect(chunks[0]!.text).toBe(
    "[0:00] Welcome back to Tidegrid Weekly. Today: tidal microgrids. Slack tide is when the turbines rest."
  );
  // The 45 character window was merged instead of stored on its own.
  expect(chunks[1]!.text).toBe(
    "[1:00] Batteries carry the island through slack tide. Islanding drills happen every spring."
  );
  for (const c of chunks) expect(c.text.length).toBeGreaterThan(80);

  // On device: the only thing fetched is youtube.com, the page the user is on.
  for (const url of requested) expect(new URL(url).hostname).toBe("www.youtube.com");
});

test("a video with no captions is still indexed, from title, channel and description", async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(120_000);
  await routeYouTube(context);
  const page = await context.newPage();
  await page.goto(watch(VIDEO_NO_CAPS));
  await startPlayback(page);

  await expect
    .poll(() => transcriptChunks(serviceWorker, VIDEO_NO_CAPS), { timeout: 45_000 })
    .toHaveLength(1);
  const [chunk] = await transcriptChunks(serviceWorker, VIDEO_NO_CAPS);
  expect(chunk!.text).toContain("Islanding drill, no captions");
  expect(chunk!.text).toContain("Channel: Tidegrid Weekly");
  expect(chunk!.text).toContain("spring islanding drill on the north pier");
  expect(chunk!.text.length).toBeGreaterThan(120);

  const doc = (await documents(serviceWorker)).find((d) => d.url === watch(VIDEO_NO_CAPS));
  expect(doc?.title).toBe("Islanding drill, no captions");

  // Passing the 30 s gate with no captions does not replace it with anything thinner.
  await page.waitForTimeout(40_000);
  const after = await transcriptChunks(serviceWorker, VIDEO_NO_CAPS);
  expect(after).toHaveLength(1);
  expect(after[0]!.text).toContain("spring islanding drill on the north pier");
});

test("SPA navigation from one video to the next arms capture again for the new video", async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(180_000);
  await routeYouTube(context);
  const page = await context.newPage();
  await page.goto(watch(VIDEO_A));
  await expect
    .poll(
      () => page.evaluate(() => Boolean((window as unknown as { __cortexYtBridge?: boolean }).__cortexYtBridge)),
      { timeout: 30_000 }
    )
    .toBe(true);
  await startPlayback(page);
  await expect.poll(() => transcriptChunks(serviceWorker, VIDEO_A), { timeout: 60_000 }).toHaveLength(2);

  // history.pushState, no page load: exactly what YouTube does on the next video.
  await page.evaluate((id) => (window as unknown as { __cortexGoTo: (v: string) => void }).__cortexGoTo(id), VIDEO_B);
  expect(page.url()).toBe(watch(VIDEO_B));
  // No new media event: the element is already rolling, as on real YouTube.

  await expect.poll(() => transcriptChunks(serviceWorker, VIDEO_B), { timeout: 45_000 }).toHaveLength(1);
  const identity = (await transcriptChunks(serviceWorker, VIDEO_B))[0]!;
  expect(identity.text).toContain("Harbour cranes on battery power");

  await expect.poll(() => transcriptChunks(serviceWorker, VIDEO_B), { timeout: 60_000 }).toHaveLength(2);
  const chunks = await transcriptChunks(serviceWorker, VIDEO_B);
  expect(chunks.map((c) => c.locator.startSec)).toEqual([0, 60]);
  expect(chunks[0]!.text).toContain("harbour cranes here run on the same island battery bank");
  expect(chunks[1]!.text).toContain("schedule the heavy lifts around the tide");
  // The first video's chunks are untouched and still say what it was about.
  expect((await transcriptChunks(serviceWorker, VIDEO_A))[0]!.text).toContain("Tidegrid Weekly");

  const urls = (await documents(serviceWorker)).map((d) => d.url);
  expect(urls).toContain(watch(VIDEO_A));
  expect(urls).toContain(watch(VIDEO_B));
});

test("a short watch still leaves the video in the library", async ({ context, serviceWorker }) => {
  test.setTimeout(120_000);
  await routeYouTube(context);
  const page = await context.newPage();
  await page.goto(watch(VIDEO_B));
  await startPlayback(page);
  // Well under the 30 s transcript gate.
  await expect.poll(() => transcriptChunks(serviceWorker, VIDEO_B), { timeout: 45_000 }).toHaveLength(1);
  const [chunk] = await transcriptChunks(serviceWorker, VIDEO_B);
  expect(chunk!.text).toContain("Harbour cranes on battery power");
  expect(chunk!.text).toContain("harbour cranes when the tide goes slack");
});

test("transcripts off: the page-world bridge is never injected", async ({ context, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, youtubeTranscriptsEnabled: false } });
  });
  await routeYouTube(context);
  const page = await context.newPage();
  await page.goto(watch(VIDEO_A));
  await startPlayback(page);
  // The page itself is still indexed as a normal page, and nothing else is.
  await expect
    .poll(() => documents(serviceWorker).then((d) => d.length), { timeout: 30_000 })
    .toBe(1);
  await page.waitForTimeout(12_000);
  expect(await transcriptChunks(serviceWorker)).toEqual([]);
  expect(
    await page.evaluate(() => Boolean((window as unknown as { __cortexYtBridge?: boolean }).__cortexYtBridge))
  ).toBe(false);
});

test("capture does not fire on a YouTube page that is not a video", async ({ context, serviceWorker }) => {
  test.setTimeout(90_000);
  await routeYouTube(context);
  await context.route("https://www.youtube.com/feed/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="en"><head><title>Subscriptions - YouTube</title></head>
<body><main><h1>Subscriptions</h1><p>${"A feed of videos from the channels you follow. ".repeat(6)}</p>
<video width="640" height="360"></video></main></body></html>`,
    })
  );
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/feed/subscriptions");
  await startPlayback(page);
  await page.waitForTimeout(20_000);
  expect(await transcriptChunks(serviceWorker)).toEqual([]);
});
