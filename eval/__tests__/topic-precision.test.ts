import { describe, expect, it } from "vitest";
import fixtureFile from "../queries/topic-fixture-embeddings.json";
import { TOPIC_FIXTURES } from "../queries/topic-fixtures";
import { TOPIC_SIMILARITY_THRESHOLD, tagTopics } from "../../src/assistant-sync/topics";

describe("topic tagging precision", () => {
  it("holds precision and recall at the locked threshold", () => {
    expect(TOPIC_SIMILARITY_THRESHOLD).toBe(0.42);
    expect(fixtureFile.cases).toHaveLength(TOPIC_FIXTURES.length);
    let hit = 0;
    let predicted = 0;
    let relevant = 0;
    for (const row of fixtureFile.cases) {
      const labels = tagTopics(row.vector);
      const expected = new Set(row.expected);
      predicted += labels.length;
      relevant += row.expected.length;
      for (const label of labels) if (expected.has(label)) hit += 1;
    }
    expect(predicted).toBeGreaterThan(0);
    expect(hit / predicted).toBe(1);
    expect(hit / relevant).toBe(1);
  });
});
