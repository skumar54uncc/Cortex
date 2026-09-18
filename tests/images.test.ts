// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractImages,
  IMAGE_LIMITS,
  planImageDescriptions,
  runImageDescriptions,
  appendDescriptions,
  stripOnDeviceDescriptions,
  DESCRIPTION_PREFIX,
  reuseDescribedText,
} from "../src/lib/capture/images";

const html = readFileSync(join(__dirname, "fixtures", "images", "photo-essay.html"), "utf8");
const BASE = "https://cryodrone.example/essay";
const load = () => new DOMParser().parseFromString(html, "text/html");

describe("extractImages", () => {
  it("indexes main-content images 100px+ with alt, figcaption, title, aria-label and nearest heading", () => {
    const res = extractImages(load(), BASE)!;
    expect(res.kind).toBe("image");
    expect(res.locator).toEqual({
      images: [
        { src: "https://cryodrone.example/img/crevasse.jpg", alt: "Fixed-wing drone over a crevasse field" },
        { src: "https://cdn.example/melt.jpg", alt: "Gauge at 3 cm" },
      ],
    });
    expect(res.text).toContain("Fixed-wing drone over a crevasse field");
    expect(res.text).toContain("Caption: The drone flies a photogrammetry pass at dawn.");
    expect(res.text).toContain("Section: Crevasse mapping");
    expect(res.text).toContain("Melt gauge reading");
    expect(res.text).toContain("Section: Melt gauges");
  });

  it("skips header, nav and footer images, small images, decorative alt='', data: URIs and images with no text", () => {
    const text = extractImages(load(), BASE)!.text;
    for (const skipped of ["Cryodrone logo", "Menu", "Footer badge", "Tiny icon", "Inline pixel"]) {
      expect(text).not.toContain(skipped);
    }
    expect(text).not.toContain("spacer");
    expect(text).not.toContain("nothing.jpg");
  });

  it("uses the smaller of rendered and natural size: big files shown as icons and scaled-up pixels are skipped", () => {
    const doc = new DOMParser().parseFromString(
      `<main><img id="icon" src="/icon.png" alt="Share icon" width="40" height="40">
       <img id="pixel" src="/px.gif" alt="Tracking pixel" width="300" height="300">
       <img id="photo" src="/photo.jpg" alt="Harbour at night" width="400" height="300"></main>`,
      "text/html"
    );
    const natural = (id: string, w: number, h: number) => {
      const el = doc.getElementById(id)!;
      Object.defineProperty(el, "naturalWidth", { value: w });
      Object.defineProperty(el, "naturalHeight", { value: h });
    };
    natural("icon", 800, 800);
    natural("pixel", 1, 1);
    natural("photo", 1600, 1200);
    const res = extractImages(doc, BASE)!;
    expect((res.locator as { images: { alt: string }[] }).images.map((i) => i.alt)).toEqual(["Harbour at night"]);
  });

  it("returns null when a page has no usable images and caps the count", () => {
    expect(extractImages(new DOMParser().parseFromString("<main><p>no images</p></main>", "text/html"), BASE)).toBeNull();
    const many = Array.from({ length: 40 }, (_, i) => `<img src="/i${i}.jpg" alt="Photo ${i}" width="300" height="300">`).join("");
    const res = extractImages(new DOMParser().parseFromString(`<main>${many}</main>`, "text/html"), BASE)!;
    expect((res.locator as { images: unknown[] }).images).toHaveLength(IMAGE_LIMITS.maxImages);
  });
});

describe("on-device image descriptions", () => {
  const images = Array.from({ length: 8 }, (_, i) => ({ src: `https://e.test/${i}.jpg`, dataUrl: `data:image/jpeg;base64,${i}` }));

  it("plans nothing unless the user turned it on AND the policy allows it", () => {
    expect(planImageDescriptions({ enabled: false, policyAllows: true }, images)).toEqual([]);
    expect(planImageDescriptions({ enabled: true, policyAllows: false }, images)).toEqual([]);
    expect(planImageDescriptions({ enabled: true, policyAllows: true }, images)).toHaveLength(IMAGE_LIMITS.maxDescriptions);
    expect(IMAGE_LIMITS.maxDescriptions).toBe(5);
  });

  it("never calls the model when off, when the policy forbids it, or when image input is unavailable", async () => {
    const lm = { available: vi.fn(async () => true), describe: vi.fn(async () => "x") };
    await runImageDescriptions(planImageDescriptions({ enabled: false, policyAllows: true }, images), lm);
    await runImageDescriptions(planImageDescriptions({ enabled: true, policyAllows: false }, images), lm);
    expect(lm.available).not.toHaveBeenCalled();
    expect(lm.describe).not.toHaveBeenCalled();
    const unavailable = { available: vi.fn(async () => false), describe: vi.fn(async () => "x") };
    expect(await runImageDescriptions(planImageDescriptions({ enabled: true, policyAllows: true }, images), unavailable)).toEqual([]);
    expect(unavailable.describe).not.toHaveBeenCalled();
  });

  it("describes at most 5 images and survives failures", async () => {
    let n = 0;
    const lm = {
      available: async () => true,
      describe: vi.fn(async () => {
        n += 1;
        if (n === 2) throw new Error("model busy");
        return `  A drone photo number ${n}.  `;
      }),
    };
    const out = await runImageDescriptions(planImageDescriptions({ enabled: true, policyAllows: true }, images), lm);
    expect(lm.describe).toHaveBeenCalledTimes(5);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ src: "https://e.test/0.jpg", description: "A drone photo number 1." });
  });

  it("descriptions are appended to the local chunk text and stripped before any cloud prompt", () => {
    const text = appendDescriptions("Images on this page:\n- Drone over ice", [
      { src: "https://e.test/0.jpg", description: "A small aircraft above white ice." },
    ]);
    expect(text).toContain(`${DESCRIPTION_PREFIX}A small aircraft above white ice.`);
    const cloud = stripOnDeviceDescriptions(text);
    expect(cloud).not.toContain("small aircraft");
    expect(cloud).toContain("Drone over ice");
  });
});

describe("sanitizeImageInputs (service worker side)", () => {
  const locatorSrcs = ["https://e.test/a.jpg", "https://e.test/b.jpg"];
  const jpeg = "data:image/jpeg;base64,/9j/4AAQ";

  it("keeps only JPEG or PNG data URLs for images listed in the page's image chunk, capped at 5 and in size", async () => {
    const { sanitizeImageInputs, EXTRA_CHUNK_LIMITS } = await import("../src/lib/capture/extra-chunks");
    const out = sanitizeImageInputs(
      [
        { src: "https://e.test/a.jpg", dataUrl: jpeg },
        { src: "https://evil.test/x.jpg", dataUrl: jpeg },
        { src: "https://e.test/b.jpg", dataUrl: "data:text/html;base64,PHNjcmlwdD4=" },
        { src: "https://e.test/b.jpg", dataUrl: `data:image/png;base64,${"A".repeat(EXTRA_CHUNK_LIMITS.imageInputChars)}` },
        { src: "https://e.test/b.jpg", dataUrl: "data:image/png;base64,iVBOR" },
        "junk",
      ],
      locatorSrcs
    );
    expect(out).toEqual([
      { src: "https://e.test/a.jpg", dataUrl: jpeg },
      { src: "https://e.test/b.jpg", dataUrl: "data:image/png;base64,iVBOR" },
    ]);
    const srcs = Array.from({ length: 9 }, (_, i) => `https://e.test/${i}.jpg`);
    const many = [...srcs, srcs[0]!].map((src) => ({ src, dataUrl: jpeg }));
    expect(sanitizeImageInputs(many, srcs)).toHaveLength(IMAGE_LIMITS.maxDescriptions);
    expect(sanitizeImageInputs([{ src: srcs[0], dataUrl: jpeg }, { src: srcs[0], dataUrl: jpeg }], srcs)).toHaveLength(1);
    expect(sanitizeImageInputs("nope", locatorSrcs)).toEqual([]);
  });
});

describe("reuseDescribedText (re-index passes do not describe again)", () => {
  const base = "Images on this page:\n- Drone over ice";
  const described = appendDescriptions(base, [{ src: "https://e.test/0.jpg", description: "A small aircraft." }]);

  it("returns the stored described text when the image text is unchanged", () => {
    expect(reuseDescribedText(described, base)).toBe(described);
  });

  it("returns null when the images changed, nothing was described, or there is no stored chunk", () => {
    expect(reuseDescribedText(described, `${base}\n- New photo`)).toBeNull();
    expect(reuseDescribedText(base, base)).toBeNull();
    expect(reuseDescribedText(undefined, base)).toBeNull();
  });
});
