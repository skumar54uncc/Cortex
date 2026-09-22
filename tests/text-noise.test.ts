import { describe, it, expect } from "vitest";
import { stripIndexedTextNoise, cleanProfileSummary } from "../src/lib/capture/text-noise";

/**
 * People cards showed "Skip to sidebar Skip to primary content Skip to aside"
 * ahead of the person, because LinkedIn's accessibility skip links sit first
 * in the page text and the summary is the opening of that text.
 */
describe("stripIndexedTextNoise", () => {
  it("drops every skip link, not only 'skip to main content'", () => {
    const out = stripIndexedTextNoise(
      "Skip to sidebar Skip to primary content Skip to aside Rajesh Ranjan Founder at DataVero",
      "www.linkedin.com"
    );
    expect(out).toBe("Rajesh Ranjan Founder at DataVero");
  });

  it("drops the skip links other sites use", () => {
    expect(stripIndexedTextNoise("Skip to footer Skip to navigation Real text", "example.com")).toBe("Real text");
    expect(stripIndexedTextNoise("Skip to the content Real text", "example.com")).toBe("Real text");
    expect(stripIndexedTextNoise("Skip to results Real text", "example.com")).toBe("Real text");
  });

  it("leaves ordinary prose that happens to start with skip alone", () => {
    const sentence = "Skip to the end of the album if you only want the finale.";
    expect(stripIndexedTextNoise(sentence, "example.com")).toBe(sentence);
  });
});

describe("cleanProfileSummary", () => {
  it("removes the skip links and the profile action buttons", () => {
    const out = cleanProfileSummary(
      "Skip to sidebar Skip to primary content Skip to aside Linda Thurman Director for Student Prof. Dev. and Employer Relations More Message Linda Thurman She/Her",
      "Linda Thurman"
    );
    expect(out).not.toMatch(/skip to/i);
    expect(out).not.toMatch(/More Message/);
    expect(out.startsWith("Director for Student")).toBe(true);
  });

  it("does not repeat the name the card already shows", () => {
    expect(cleanProfileSummary("Rajesh Ranjan Founder at DataVero.io", "Rajesh Ranjan")).toBe(
      "Founder at DataVero.io"
    );
    expect(cleanProfileSummary("Rajesh Ranjan - Founder at DataVero.io", "Rajesh Ranjan")).toBe(
      "Founder at DataVero.io"
    );
  });

  it("ends on a whole word, never mid word", () => {
    const long = `${"Software engineer ".repeat(40)}end`;
    const out = cleanProfileSummary(long, "Ada Field");
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toMatch(/(engineer|…)$/);
  });

  it("drops a dangling separator or stray counter at the end", () => {
    expect(cleanProfileSummary("Software Engineer II at Cisco · 1", "Shreya Pothuganti")).toBe(
      "Software Engineer II at Cisco"
    );
    expect(cleanProfileSummary("Founder at DataVero |", "Rajesh Ranjan")).toBe("Founder at DataVero");
  });

  it("returns nothing when the text was only chrome", () => {
    expect(cleanProfileSummary("Skip to primary content More Message Connect", "Ada Field")).toBe("");
    expect(cleanProfileSummary("", "Ada Field")).toBe("");
  });
});
