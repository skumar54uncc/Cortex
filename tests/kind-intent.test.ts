import { describe, it, expect } from "vitest";
import {
  detectKindIntent,
  EMPLOYMENT_HEADCOUNT_DEMOTE,
  isPersonProfileUrl,
  kindBoost,
  KIND_INTENT_BOOST,
  PERSON_PROFILE_BOOST,
  personScoreMultiplier,
  textHasEmploymentHeadcount,
} from "../src/lib/kind-intent";
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
    // Saved highlights always carry a small boost, intent or not.
    expect(kindBoost("highlight", i)).toBeGreaterThan(1);
  });

  it("boosts LinkedIn profiles and demotes employment headcount pages only under person intent", () => {
    const profile = "https://www.linkedin.com/in/ada-lovelace/";
    const news = "https://news.example/acme-round";
    expect(isPersonProfileUrl(profile)).toBe(true);
    expect(isPersonProfileUrl("https://www.linkedin.com/company/acme/")).toBe(false);
    expect(textHasEmploymentHeadcount("Acme now employs 40 people in the city.")).toBe(true);
    expect(textHasEmploymentHeadcount("I care about people and sensors.")).toBe(false);
    expect(personScoreMultiplier(true, profile, true)).toBe(PERSON_PROFILE_BOOST);
    expect(personScoreMultiplier(true, news, true)).toBe(EMPLOYMENT_HEADCOUNT_DEMOTE);
    expect(personScoreMultiplier(true, news, false)).toBe(1);
    expect(personScoreMultiplier(false, profile, true)).toBe(1);
    expect(PERSON_PROFILE_BOOST).toBeGreaterThan(1);
    expect(EMPLOYMENT_HEADCOUNT_DEMOTE).toBeLessThan(1);
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
