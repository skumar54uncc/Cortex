import { describe, it, expect } from "vitest";
import { detectKindIntent, kindBoost, KIND_INTENT_BOOST } from "../src/lib/kind-intent";
import { DEFAULT_USER_SETTINGS, type CortexUserSettings } from "../src/shared/extension-settings";

describe("detectKindIntent", () => {
  it("maps intent words to chunk kinds", () => {
    expect(detectKindIntent("that video about tidal turbines").kinds).toEqual(["transcript"]);
    expect(detectKindIntent("what did I watch on youtube yesterday").kinds).toEqual(["transcript"]);
    expect(detectKindIntent("the pricing table for synths").kinds).toEqual(["table"]);
    expect(detectKindIntent("chart of launch cadence").kinds).toEqual(["table"]);
    expect(detectKindIntent("photo of the glacier drone").kinds).toEqual(["image"]);
    expect(detectKindIntent("the pdf about cold chain").kinds).toEqual(["pdf"]);
    expect(detectKindIntent("my highlights on kombucha").kinds).toEqual(["highlight"]);
    expect(detectKindIntent("video and table of hive scales").kinds.sort()).toEqual(["table", "transcript"]);
  });

  it("detects person intent separately", () => {
    expect(detectKindIntent("which person from Acme did I look at").person).toBe(true);
    expect(detectKindIntent("people working on tidal energy").person).toBe(true);
    expect(detectKindIntent("tidal energy").person).toBe(false);
  });

  it("plain queries have no intent, so ranking is unchanged", () => {
    const i = detectKindIntent("coherence margin below 0.12 unstable sieve");
    expect(i).toEqual({ kinds: [], person: false });
    expect(kindBoost("text", i)).toBe(1);
    expect(kindBoost("transcript", i)).toBe(1);
  });

  it("boosts only chunks of an intended kind", () => {
    const i = detectKindIntent("that video");
    expect(kindBoost("transcript", i)).toBe(KIND_INTENT_BOOST);
    expect(kindBoost("text", i)).toBe(1);
    expect(KIND_INTENT_BOOST).toBeGreaterThan(1);
  });
});

describe("feature toggles (settings)", () => {
  it("have the planned defaults: resurfacing and image descriptions off, the rest on", () => {
    const s: CortexUserSettings = DEFAULT_USER_SETTINGS;
    expect(s.peopleMemoryEnabled).toBe(true);
    expect(s.omniboxEnabled).toBe(true);
    expect(s.highlightsEnabled).toBe(true);
    expect(s.resurfacingEnabled).toBe(false);
    expect(s.youtubeTranscriptsEnabled).toBe(true);
    expect(s.tablesEnabled).toBe(true);
    expect(s.imagesEnabled).toBe(true);
    expect(s.imageDescriptionsEnabled).toBe(false);
    expect(s.pdfEnabled).toBe(true);
  });
});
