import { describe, it, expect } from "vitest";
import { sanitizePersonDetail } from "../src/lib/capture/linkedin";

/**
 * The service worker rebuilds the person record field by field before it is
 * stored, so the captured detail has to survive that boundary, validated and
 * capped (the payload comes from a page and is untrusted).
 */
describe("sanitizePersonDetail", () => {
  it("keeps the detail a profile page carried, trimmed and capped", () => {
    const out = sanitizePersonDetail({
      location: "  Indian Trail,   North Carolina  ",
      about: "x".repeat(2_000),
      roleTitle: "Co-founder",
      pastRoles: Array.from({ length: 9 }, (_, i) => ({ title: `Role ${i}`, company: `Co ${i}` })),
      education: ["Appalachian State University, BSBA", "UNC Charlotte", "Extra school", "Fourth school"],
      connectionDegree: "1st",
      connectionCount: 317,
      industry: "Software",
      companySize: "11 to 50 employees",
      tagline: "Voice notes that write themselves",
    });

    expect(out.location).toBe("Indian Trail, North Carolina");
    expect(out.about!.length).toBeLessThanOrEqual(600);
    expect(out.roleTitle).toBe("Co-founder");
    expect(out.pastRoles).toHaveLength(5);
    expect(out.education).toHaveLength(3);
    expect(out.connectionDegree).toBe("1st");
    expect(out.connectionCount).toBe(317);
    expect(out.industry).toBe("Software");
    expect(out.companySize).toBe("11 to 50 employees");
    expect(out.tagline).toBe("Voice notes that write themselves");
  });

  it("drops anything missing, malformed or hostile instead of storing it", () => {
    const out = sanitizePersonDetail({
      location: 42,
      about: { toString: () => "nope" },
      roleTitle: "",
      pastRoles: [{ title: "ok", company: "Co" }, "junk", { title: 5 }, null],
      education: ["fine", 7, ""],
      connectionDegree: "first",
      connectionCount: -3,
      unknownField: "ignored",
    } as unknown as Record<string, unknown>);

    expect(out.location).toBeUndefined();
    expect(out.about).toBeUndefined();
    expect(out.roleTitle).toBeUndefined();
    expect(out.pastRoles).toEqual([{ title: "ok", company: "Co" }]);
    expect(out.education).toEqual(["fine"]);
    expect(out.connectionDegree).toBeUndefined();
    expect(out.connectionCount).toBeUndefined();
    expect(Object.keys(out)).not.toContain("unknownField");
  });

  it("returns nothing at all for an empty page, so old rows are not overwritten", () => {
    expect(sanitizePersonDetail({})).toEqual({});
    expect(sanitizePersonDetail(null)).toEqual({});
  });
});
