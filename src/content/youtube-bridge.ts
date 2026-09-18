/**
 * youtube-bridge.js (Phase 5.6): runs in the PAGE's main world on YouTube
 * watch pages, injected by the service worker only after the privacy gate and
 * only when YouTube transcripts are on. The player response lives in the page
 * world, so this reads it and posts a reduced copy to the extension's
 * isolated world. The receiver treats it as untrusted (video id must match the
 * URL, caption URLs must be youtube.com/api/timedtext).
 */
type AnyRec = Record<string, unknown>;

(() => {
  const w = window as unknown as AnyRec;
  if (w.__cortexYtBridge) return;
  w.__cortexYtBridge = true;

  const reduce = (pr: AnyRec): AnyRec => {
    const vd = (pr.videoDetails ?? {}) as AnyRec;
    const renderer = ((pr.captions ?? {}) as AnyRec).playerCaptionsTracklistRenderer as AnyRec | undefined;
    const tracks = Array.isArray(renderer?.captionTracks) ? (renderer!.captionTracks as AnyRec[]) : [];
    return {
      videoDetails: {
        videoId: vd.videoId,
        title: vd.title,
        author: vd.author,
        shortDescription: vd.shortDescription,
        lengthSeconds: vd.lengthSeconds,
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: tracks.slice(0, 50).map((t) => {
            const name = (t.name ?? {}) as AnyRec;
            const runs = Array.isArray(name.runs) ? (name.runs as AnyRec[]) : [];
            return {
              baseUrl: t.baseUrl,
              languageCode: t.languageCode,
              kind: t.kind,
              name: { simpleText: name.simpleText ?? runs[0]?.text },
            };
          }),
        },
      },
    };
  };

  const post = (): void => {
    let pr: AnyRec | null = null;
    try {
      const player = document.getElementById("movie_player") as unknown as {
        getPlayerResponse?: () => AnyRec;
      } | null;
      pr = player?.getPlayerResponse?.() ?? (w.ytInitialPlayerResponse as AnyRec | undefined) ?? null;
    } catch {
      pr = null;
    }
    if (!pr) return;
    window.postMessage({ source: "cortex-yt-bridge", playerResponse: reduce(pr) }, location.origin);
  };

  post();
  document.addEventListener("yt-navigate-finish", () => setTimeout(post, 400));
  window.addEventListener("message", (e) => {
    if (e.source === window && (e.data as AnyRec | null)?.source === "cortex-yt-request") post();
  });
})();
