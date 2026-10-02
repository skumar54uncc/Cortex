import { buildSeed, SEED_DAYS, SEED_VISITS_PER_WEEKDAY } from "./seed";

const { workbook, needles } = buildSeed();
console.info(`title ${workbook.title}`);
console.info(`days ${SEED_DAYS} weekday visits ${SEED_VISITS_PER_WEEKDAY}`);
for (const tab of workbook.tabs) {
  console.info(`${tab.title} rows ${tab.rows.length} header ${tab.rows[0]?.join(" | ") ?? ""}`);
}
console.info(`needles ${needles.join(", ")}`);
console.info("This file is Cortex Memory Seed, not the live Cortex Memory sheet.");
