/**
 * Deterministic synthetic corpus generator (Phase 3.1).
 *
 * 150+ pages across ten fictional topic clusters: articles, LinkedIn style
 * profiles, API docs, transcripts, table pages, image caption pages and news.
 * Every page carries unique "anchor" facts (invented proper nouns, numbers,
 * people) so factual queries have exactly one right answer, navigational
 * queries target titles, exploratory queries target a cluster, and negative
 * queries ask about real-world topics the corpus never mentions.
 *
 * Nothing here is copyrighted text; all entities are invented.
 */
import type { CorpusPage, RetrievalQuery, PageCategory } from "../src/types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260916);
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function int(lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const FIRST = ["Ilse", "Tomasz", "Priya", "Marcus", "Aiko", "Dmitri", "Sofia", "Kwame", "Helga", "Rafael", "Nadia", "Bjorn", "Amara", "Luca", "Yuki", "Ezra", "Ingrid", "Tariq", "Mireille", "Oskar", "Zanele", "Piotr", "Leila", "Hamish", "Chiara", "Ravi", "Astrid", "Kenji", "Farah", "Emil"];
const LAST = ["Marrow", "Veldt", "Okonkwo", "Lindqvist", "Sato", "Brannigan", "Castellano", "Moreau", "Haldane", "Petrova", "Adeyemi", "Kowalczyk", "Fennimore", "Oyelaran", "Vasquez", "Thorne", "Nakagawa", "Quist", "Rahimi", "Sundstrom", "Blackwood", "Mbeki", "Ferreira", "Halvorsen", "Ishikawa", "Dubois", "Kaplan", "Ngata", "Larkin", "Voss"];
const CITIES = ["Tromsø", "Valparaíso", "Tallinn", "Kigali", "Halifax", "Porto", "Adelaide", "Reykjavik", "Kyoto", "Ljubljana", "Cork", "Montevideo", "Bergen", "Windhoek", "Hobart", "Ghent", "Tartu", "Salvador", "Gdańsk", "Sapporo"];

interface Cluster {
  key: string;
  theme: string;
  domain: string;
  nouns: string[];
  verbs: string[];
  adjectives: string[];
  subtopics: string[];
  productSyllables: string[];
}

const CLUSTERS: Cluster[] = [
  {
    key: "orbital",
    theme: "orbital cargo logistics",
    domain: "orbital-freight.example",
    nouns: ["payload manifest", "transfer stage", "docking window", "cargo pod", "reentry corridor", "propellant margin", "ground station", "launch cadence"],
    verbs: ["schedules", "reroutes", "inspects", "certifies", "reconciles", "throttles"],
    adjectives: ["pressurized", "redundant", "low-thrust", "cislunar", "autonomous", "thermal"],
    subtopics: ["docking window planning", "propellant margin audits", "cargo pod thermal limits", "reentry corridor licensing", "ground station handovers", "launch cadence forecasting"],
    productSyllables: ["Vel", "drix", "Or", "bis", "Kel", "vane", "Tor", "quel"],
  },
  {
    key: "kombucha",
    theme: "fermented tea brewing",
    domain: "brewlog.example",
    nouns: ["scoby culture", "second fermentation", "sugar ratio", "brew vessel", "pH curve", "flavor batch", "bottling line", "starter liquid"],
    verbs: ["ferments", "bottles", "measures", "blends", "ages", "carbonates"],
    adjectives: ["tart", "unpasteurized", "small-batch", "cold-brewed", "sparkling", "amber"],
    subtopics: ["sugar ratio experiments", "pH curve logging", "bottling line sanitation", "starter liquid storage", "flavor batch naming", "second fermentation timing"],
    productSyllables: ["Fizz", "wort", "Bru", "mora", "Tea", "gard", "Sco", "byne"],
  },
  {
    key: "bees",
    theme: "urban beekeeping sensors",
    domain: "hivewatch.example",
    nouns: ["hive scale", "brood temperature", "forager count", "swarm alert", "nectar flow", "varroa reading", "entrance camera", "apiary map"],
    verbs: ["monitors", "logs", "predicts", "calibrates", "alerts", "graphs"],
    adjectives: ["solar-powered", "rooftop", "wireless", "weatherproof", "low-power", "seasonal"],
    subtopics: ["hive scale calibration", "swarm alert thresholds", "forager count cameras", "brood temperature bands", "varroa reading schedules", "apiary map sharing"],
    productSyllables: ["Api", "trak", "Bee", "vane", "Nec", "tara", "Hum", "brix"],
  },
  {
    key: "type",
    theme: "typeface design tooling",
    domain: "glyphforge.example",
    nouns: ["kerning table", "variable axis", "hinting pass", "glyph outline", "optical size", "ligature set", "metrics file", "interpolation master"],
    verbs: ["interpolates", "hints", "exports", "kerns", "validates", "subsets"],
    adjectives: ["monospaced", "humanist", "variable", "grotesque", "condensed", "display"],
    subtopics: ["variable axis naming", "kerning table audits", "hinting pass automation", "optical size masters", "ligature set testing", "metrics file diffs"],
    productSyllables: ["Gly", "phon", "Ker", "nix", "Ax", "ella", "Ser", "ifa"],
  },
  {
    key: "tidal",
    theme: "tidal energy microgrids",
    domain: "tidegrid.example",
    nouns: ["turbine array", "slack tide", "battery buffer", "cable landing", "spring tide peak", "inverter bank", "islanding mode", "capacity factor"],
    verbs: ["balances", "forecasts", "islands", "dispatches", "curtails", "meters"],
    adjectives: ["subsea", "bidirectional", "grid-tied", "seasonal", "estuarine", "resilient"],
    subtopics: ["slack tide storage sizing", "cable landing permits", "islanding mode drills", "capacity factor reporting", "inverter bank cooling", "spring tide peak curtailment"],
    productSyllables: ["Ti", "dora", "Ebb", "line", "Flux", "mere", "Ner", "eid"],
  },
  {
    key: "boardgames",
    theme: "board game publishing",
    domain: "meeplepress.example",
    nouns: ["print run", "rulebook draft", "playtest group", "component sheet", "retail margin", "crowdfunding tier", "box insert", "expansion deck"],
    verbs: ["playtests", "prints", "ships", "balances", "localizes", "reprints"],
    adjectives: ["cooperative", "deck-building", "asymmetric", "solo-friendly", "legacy", "tile-laying"],
    subtopics: ["rulebook draft reviews", "print run sizing", "playtest group feedback", "component sheet costs", "crowdfunding tier design", "expansion deck balance"],
    productSyllables: ["Mee", "plar", "Car", "dessa", "Tab", "lore", "Hex", "ward"],
  },
  {
    key: "coldchain",
    theme: "cold chain pharmacy delivery",
    domain: "frostroute.example",
    nouns: ["temperature log", "insulated tote", "courier route", "excursion event", "dry ice charge", "chain of custody", "delivery window", "vial tray"],
    verbs: ["tracks", "seals", "dispatches", "flags", "audits", "recharges"],
    adjectives: ["refrigerated", "last-mile", "tamper-evident", "time-critical", "validated", "insulated"],
    subtopics: ["excursion event handling", "dry ice charge planning", "chain of custody scans", "delivery window promises", "insulated tote validation", "courier route density"],
    productSyllables: ["Fro", "stel", "Cry", "ova", "Ther", "mane", "Gla", "cier"],
  },
  {
    key: "signlang",
    theme: "sign language learning apps",
    domain: "handspeak.example",
    nouns: ["handshape lesson", "fingerspelling drill", "video prompt", "regional variant", "practice streak", "mirror mode", "grammar module", "community deck"],
    verbs: ["teaches", "records", "scores", "reviews", "adapts", "unlocks"],
    adjectives: ["bilingual", "camera-based", "offline", "beginner", "regional", "adaptive"],
    subtopics: ["fingerspelling drill pacing", "regional variant tagging", "mirror mode feedback", "grammar module ordering", "practice streak rules", "community deck moderation"],
    productSyllables: ["Sig", "nora", "Hand", "wave", "Ges", "tura", "Pal", "mia"],
  },
  {
    key: "synth",
    theme: "vintage synthesizer restoration",
    domain: "oscillate.example",
    nouns: ["voice card", "filter cutoff", "keybed contact", "power rail", "envelope generator", "calibration trim", "MIDI retrofit", "panel legend"],
    verbs: ["recaps", "calibrates", "retrofits", "traces", "re-flows", "tunes"],
    adjectives: ["polyphonic", "analog", "monophonic", "modular", "rackmount", "hybrid"],
    subtopics: ["voice card recapping", "filter cutoff calibration", "keybed contact cleaning", "power rail replacement", "MIDI retrofit wiring", "panel legend reprinting"],
    productSyllables: ["Os", "cilla", "Vol", "tara", "Pat", "chwerk", "Res", "onix"],
  },
  {
    key: "glacier",
    theme: "glacier monitoring drones",
    domain: "cryodrone.example",
    nouns: ["flight corridor", "crevasse map", "melt gauge", "battery swap", "photogrammetry pass", "ice thickness model", "base camp uplink", "weather hold"],
    verbs: ["surveys", "maps", "measures", "uploads", "holds", "re-flies"],
    adjectives: ["fixed-wing", "cold-rated", "autonomous", "high-altitude", "tethered", "lightweight"],
    subtopics: ["crevasse map updates", "melt gauge placement", "battery swap logistics", "photogrammetry pass overlap", "base camp uplink bandwidth", "weather hold policies"],
    productSyllables: ["Cry", "on", "Fir", "nis", "Ne", "vada", "Ser", "ac"],
  },
];

function productName(c: Cluster): string {
  const s = shuffle(c.productSyllables);
  return `${s[0]}${s[1]!.toLowerCase()}${pick(["", "", "ix", "o", "a"])}`;
}
function personName(): string {
  return `${pick(FIRST)} ${pick(LAST)}`;
}
function sentence(c: Cluster, extra?: string): string {
  const forms = [
    () => `The ${pick(c.adjectives)} ${pick(c.nouns)} ${pick(c.verbs)} each ${pick(c.nouns)} before the next ${pick(c.nouns)} is approved.`,
    () => `Teams working on ${pick(c.subtopics)} usually start with the ${pick(c.nouns)} and only later touch the ${pick(c.nouns)}.`,
    () => `A ${pick(c.adjectives)} setup ${pick(c.verbs)} the ${pick(c.nouns)} roughly ${int(2, 14)} times per week.`,
    () => `In practice the ${pick(c.nouns)} matters more than the ${pick(c.nouns)}, especially for ${pick(c.adjectives)} deployments.`,
    () => `Most guides on ${pick(c.subtopics)} recommend checking the ${pick(c.nouns)} every ${int(3, 45)} minutes.`,
    () => `When the ${pick(c.nouns)} drifts, operators ${pick(c.verbs).replace(/s$/, "")} the ${pick(c.nouns)} and record the ${pick(c.nouns)}.`,
  ];
  const s = pick(forms)();
  return extra ? `${s} ${extra}` : s;
}
function paragraph(c: Cluster, n: number, extra?: string): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(sentence(c));
  if (extra) out.splice(int(0, out.length), 0, extra);
  return out.join(" ");
}

export interface GeneratedPageMeta {
  page: CorpusPage;
  cluster: string;
  anchorNoun: string;
  anchorNumber: string;
  anchorPerson: string;
  kind: "article" | "profile" | "docs" | "transcript" | "table" | "image" | "news";
}

const CAPTURED_BASE = Date.parse("2026-09-01T09:00:00Z");
let pageCounter = 0;
function capturedAt(): string {
  pageCounter += 1;
  return new Date(CAPTURED_BASE + pageCounter * 3_600_000 * 5).toISOString();
}

function mkPage(
  id: string,
  url: string,
  title: string,
  text: string,
  category: PageCategory,
  html?: string
): CorpusPage {
  return {
    id,
    url,
    title,
    html: html ?? `<article>${text.split("\n").map((l) => `<p>${l}</p>`).join("")}</article>`,
    extracted_text: text,
    captured_at: capturedAt(),
    category,
  };
}

function buildArticle(c: Cluster, i: number): GeneratedPageMeta {
  const product = productName(c);
  const person = personName();
  const number = `${int(11, 97)} percent`;
  const city = pick(CITIES);
  const year = int(2014, 2025);
  const sub = pick(c.subtopics);
  const title = `${product}: how ${sub} changed ${c.theme}`;
  const paras = [
    `${product} is a ${pick(c.adjectives)} platform for ${c.theme}, founded in ${year} in ${city} by ${person}. ${sentence(c)}`,
    paragraph(c, 5, `Independent reviewers reported that ${product} cut ${pick(c.nouns)} errors by ${number} in its first season.`),
    `## Why ${sub} matters\n${paragraph(c, 6)}`,
    `## What ${person} learned\n${paragraph(c, 5, `${person} keeps a public changelog for ${product} and answers questions about ${sub} every Friday.`)}`,
    `## Practical checklist\n${paragraph(c, 5)}`,
  ];
  const text = paras.join("\n\n");
  return {
    page: mkPage(`gen-${c.key}-article-${i}`, `https://${c.domain}/articles/${product.toLowerCase()}-${i}`, title, text, "blog"),
    cluster: c.key,
    anchorNoun: product,
    anchorNumber: number,
    anchorPerson: person,
    kind: "article",
  };
}

function buildNews(c: Cluster, i: number): GeneratedPageMeta {
  const product = productName(c);
  const person = personName();
  const number = `${int(3, 60)} million`;
  const city = pick(CITIES);
  const title = `${product} raises ${number} to expand ${c.theme} in ${city}`;
  const text = [
    `${city}, ${pick(["March", "June", "August", "October"])} ${int(1, 28)}, 2026. ${product}, a ${pick(c.adjectives)} startup focused on ${c.theme}, announced a ${number} round led by fictional investors.`,
    `Chief executive ${person} said the money will go toward ${pick(c.subtopics)} and a second ${pick(c.nouns)} facility.`,
    paragraph(c, 4),
    `Analysts at the imaginary Sector Desk called the round "large for ${c.theme}" and noted that ${product} now employs ${int(12, 240)} people.`,
    paragraph(c, 3),
    `This announcement is synthetic test data and describes no real company.`,
  ].join("\n\n");
  return {
    page: mkPage(`gen-${c.key}-news-${i}`, `https://news.${c.domain}/${product.toLowerCase()}-round-${i}`, title, text, "news"),
    cluster: c.key,
    anchorNoun: product,
    anchorNumber: number,
    anchorPerson: person,
    kind: "news",
  };
}

function buildProfile(c: Cluster, i: number): GeneratedPageMeta {
  const person = personName();
  const company = productName(c);
  const prev = productName(c);
  const city = pick(CITIES);
  const years = int(3, 14);
  const headline = `${pick(["Head of", "Senior", "Lead", "Principal", "Director of"])} ${pick(["Operations", "Engineering", "Product", "Research", "Field Programs"])} at ${company}`;
  const title = `${person} - ${headline} | LinkedIn`;
  const text = [
    `${person}`,
    `${headline}`,
    `${company} · ${city}, ${pick(["Remote", "Hybrid", "On-site"])} · ${int(300, 4200)} followers · ${int(200, 500)}+ connections`,
    `About`,
    `${years} years in ${c.theme}. I care about ${pick(c.subtopics)} and ${pick(c.subtopics)}. Previously built the ${pick(c.nouns)} program at ${prev}. Open to speaking about ${pick(c.subtopics)}.`,
    `Experience`,
    `${headline} · ${company} · ${2026 - int(1, 4)} to present · ${city}`,
    `Led ${pick(c.subtopics)} for ${int(2, 9)} teams; ${sentence(c)}`,
    `${pick(["Engineer", "Analyst", "Coordinator", "Manager"])} · ${prev} · ${2026 - years} to ${2026 - int(1, 4)}`,
    `${sentence(c)}`,
    `Education`,
    `${pick(["Institute of", "University of", "Polytechnic"])} ${city} · ${pick(["BSc", "MSc", "MEng"])} ${pick(["Systems Engineering", "Applied Physics", "Industrial Design", "Data Science"])}`,
    `Skills`,
    `${pick(c.subtopics)} · ${pick(c.nouns)} · ${pick(c.nouns)} · ${pick(["Team leadership", "Vendor management", "Field testing", "Grant writing"])}`,
  ].join("\n");
  return {
    page: mkPage(`gen-${c.key}-profile-${i}`, `https://www.linkedin.com/in/${person.toLowerCase().replace(/\s+/g, "-")}-${c.key}${i}/`, title, text, "spa", `<main><section class="profile">${text.replace(/\n/g, "<br/>")}</section></main>`),
    cluster: c.key,
    anchorNoun: company,
    anchorNumber: `${years} years`,
    anchorPerson: person,
    kind: "profile",
  };
}

function buildDocs(c: Cluster, i: number): GeneratedPageMeta {
  const lib = productName(c);
  const fn = `create${lib.replace(/[^A-Za-z]/g, "")}Client`;
  const opt = `${pick(c.nouns).split(" ")[0]}Timeout`;
  const number = `${int(250, 9000)} ms`;
  const person = personName();
  const title = `${lib} API reference: ${fn} and ${opt}`;
  const text = [
    `# ${lib} API reference`,
    `${lib} is a TypeScript client for ${c.theme}. Install with npm install ${lib.toLowerCase()} and import ${fn} from "${lib.toLowerCase()}".`,
    `## ${fn}(config)`,
    `Creates a client. Options: ${opt} (number, default ${number}), retries (number, default ${int(1, 5)}), and ${pick(c.nouns).replace(/\s+/g, "")}Source (string).`,
    `const client = ${fn}({ ${opt}: ${number.split(" ")[0]}, retries: ${int(1, 5)} });`,
    `## client.${pick(c.verbs).replace(/s$/, "")}(input)`,
    `${sentence(c)} Returns a promise that resolves with the ${pick(c.nouns)} and rejects with ${lib}Error when the ${pick(c.nouns)} is missing.`,
    `## Events`,
    `The client emits "${pick(c.nouns).replace(/\s+/g, "-")}" and "drift" events. ${sentence(c)}`,
    `## Migration notes`,
    paragraph(c, 4, `Maintainer ${person} deprecated the legacy ${pick(c.nouns)} field in version ${int(2, 6)}.${int(0, 9)}.`),
    `## Troubleshooting`,
    paragraph(c, 4),
  ].join("\n\n");
  return {
    page: mkPage(`gen-${c.key}-docs-${i}`, `https://docs.${c.domain}/${lib.toLowerCase()}/api`, title, text, "docs"),
    cluster: c.key,
    anchorNoun: fn,
    anchorNumber: number,
    anchorPerson: person,
    kind: "docs",
  };
}

function buildTranscript(c: Cluster, i: number): GeneratedPageMeta {
  const host = personName();
  const guest = personName();
  const product = productName(c);
  const number = `${int(5, 90)} minutes`;
  const title = `Episode ${int(10, 99)}: ${guest} on ${pick(c.subtopics)} (video transcript)`;
  const lines: string[] = [];
  let t = 0;
  const speakers = [host, guest];
  for (let n = 0; n < 48; n++) {
    t += int(8, 25);
    const mm = String(Math.floor(t / 60)).padStart(2, "0");
    const ss = String(t % 60).padStart(2, "0");
    const who = speakers[n % 2]!;
    let line = sentence(c);
    if (n === 6) line = `${guest}: so at ${product} we spent about ${number} per day just on ${pick(c.subtopics)}, which sounds wasteful until you see the ${pick(c.nouns)} numbers.`;
    if (n === 20) line = `${host}: and the thing people miss about ${pick(c.subtopics)} is the ${pick(c.nouns)}, right?`;
    lines.push(`[${mm}:${ss}] ${who.split(" ")[0]}: ${line}`);
  }
  const text = [`Video: ${title}`, `Channel: ${c.theme} weekly`, ...lines].join("\n");
  return {
    page: mkPage(`gen-${c.key}-transcript-${i}`, `https://www.youtube.com/watch?v=${c.key.slice(0, 3)}${i}${int(1000, 9999)}`, title, text, "spa"),
    cluster: c.key,
    anchorNoun: product,
    anchorNumber: number,
    anchorPerson: guest,
    kind: "transcript",
  };
}

function buildTable(c: Cluster, i: number): GeneratedPageMeta {
  const caption = `${pick(c.adjectives)} ${pick(c.nouns)} comparison, ${2026 - int(0, 2)}`;
  const headers = ["Model", pick(c.nouns), pick(c.nouns), "Price", "Rating"];
  const rows: string[] = [];
  const models: string[] = [];
  for (let r = 0; r < 24; r++) {
    const m = `${productName(c)} ${pick(["Mini", "Pro", "Max", "Field", "Studio"])} ${int(1, 9)}`;
    models.push(m);
    rows.push(
      `${headers[0]}: ${m}; ${headers[1]}: ${int(1, 99)} ${pick(["units", "kg", "hours", "cycles"])}; ${headers[2]}: ${pick(["yes", "no", "optional"])}; ${headers[3]}: ${int(90, 4900)} credits; ${headers[4]}: ${(int(20, 50) / 10).toFixed(1)} of 5`
    );
  }
  const anchorModel = models[int(0, models.length - 1)]!;
  const title = `${caption} (table)`;
  const text = [`Table: ${caption}`, `Columns: ${headers.join(", ")}`, ...rows, paragraph(c, 3)].join("\n");
  const html = `<table><caption>${caption}</caption><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.split("; ").map((cell) => `<td>${cell.split(": ")[1]}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return {
    page: mkPage(`gen-${c.key}-table-${i}`, `https://${c.domain}/tables/${c.key}-compare-${i}`, title, text, "long-form", html),
    cluster: c.key,
    anchorNoun: anchorModel,
    anchorNumber: `${rows.length} rows`,
    anchorPerson: "",
    kind: "table",
  };
}

function buildImagePage(c: Cluster, i: number): GeneratedPageMeta {
  const photographer = personName();
  const place = pick(CITIES);
  const product = productName(c);
  const title = `Photo essay: ${c.theme} in ${place}`;
  const captions: string[] = [];
  for (let f = 1; f <= 12; f++) {
    captions.push(`Figure ${f}: ${pick(c.adjectives)} ${pick(c.nouns)} photographed in ${place} by ${photographer}. ${f === 5 ? `The ${product} unit in the foreground is the one described in the caption about ${pick(c.subtopics)}.` : sentence(c)}`);
  }
  const text = [`${title}`, `Alt text and captions for ${captions.length} images.`, ...captions].join("\n");
  const html = `<main><h1>${title}</h1>${captions.map((cap, k) => `<figure><img src="/img/${c.key}-${k}.jpg" alt="${cap.split(". ")[0]}" width="800" height="600"><figcaption>${cap}</figcaption></figure>`).join("")}</main>`;
  return {
    page: mkPage(`gen-${c.key}-image-${i}`, `https://${c.domain}/photos/${place.toLowerCase()}-${i}`, title, text, "long-form", html),
    cluster: c.key,
    anchorNoun: product,
    anchorNumber: `${captions.length} images`,
    anchorPerson: photographer,
    kind: "image",
  };
}

export const GENERATED_META: GeneratedPageMeta[] = [];
for (const c of CLUSTERS) {
  for (let i = 1; i <= 4; i++) GENERATED_META.push(buildArticle(c, i));
  for (let i = 1; i <= 3; i++) GENERATED_META.push(buildProfile(c, i));
  for (let i = 1; i <= 2; i++) GENERATED_META.push(buildDocs(c, i));
  for (let i = 1; i <= 2; i++) GENERATED_META.push(buildTranscript(c, i));
  GENERATED_META.push(buildTable(c, 1));
  GENERATED_META.push(buildImagePage(c, 1));
  for (let i = 1; i <= 2; i++) GENERATED_META.push(buildNews(c, i));
}
// Extra tables and images to reach the brief's 15 tables and 10 image pages.
for (const c of CLUSTERS.slice(0, 5)) GENERATED_META.push(buildTable(c, 2));

export const GENERATED_PAGES: CorpusPage[] = GENERATED_META.map((m) => m.page);

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------
const NEGATIVE_QUERIES: string[] = [
  "how to change a flat tire on a bicycle",
  "best time of year to plant tomatoes",
  "python list comprehension syntax",
  "who won the 1998 football world cup",
  "difference between baking soda and baking powder",
  "how long to boil an egg for a soft yolk",
  "capital city of Australia",
  "chess opening for beginners e4",
  "how to tie a bowline knot",
  "symptoms of vitamin d deficiency",
  "convert celsius to fahrenheit formula",
  "how do I renew a passport",
  "mortgage amortization schedule explained",
  "what is the boiling point of nitrogen",
  "guitar chords for a twelve bar blues",
  "how to remove red wine stains from carpet",
  "photosynthesis light dependent reactions",
  "recipe for sourdough starter feeding schedule",
  "marathon training plan for first timers",
  "how does a refrigerator compressor work",
  "history of the printing press",
  "how to write a resignation letter",
  "sql join types inner left right full",
  "jet lag tips for eastward flights",
  "how many teaspoons in a tablespoon",
  "compound interest calculator monthly",
  "watercolor techniques wet on wet",
  "how to descale an espresso machine",
  "knitting cast on methods for beginners",
  "what causes the northern lights",
];

function q(id: string, query: string, rel: string[], type: RetrievalQuery["query_type"], notes?: string): RetrievalQuery {
  return { id, query, relevant_doc_ids: rel, relevant_chunk_ids: [], query_type: type, notes };
}

export const GENERATED_QUERIES: RetrievalQuery[] = [];
let qn = 100;
const nextId = (): string => `q-${String(qn++).padStart(3, "0")}`;

for (const m of GENERATED_META) {
  const c = CLUSTERS.find((x) => x.key === m.cluster)!;
  // Factual: anchor noun + theme (one right page). Sample about half the pages.
  if (m.kind === "article" || m.kind === "docs" || m.kind === "news" || m.kind === "transcript") {
    if (rand() < 0.6) {
      const phr =
        m.kind === "docs"
          ? `${m.anchorNoun} ${m.anchorNumber} default`
          : m.kind === "transcript"
            ? `${m.anchorPerson} ${m.anchorNoun} ${m.anchorNumber} per day`
            : `${m.anchorNoun} ${m.anchorNumber} ${c.theme}`;
      GENERATED_QUERIES.push(q(nextId(), phr, [m.page.id], "factual", m.kind));
    }
  }
  if (m.kind === "profile" && rand() < 0.7) {
    GENERATED_QUERIES.push(q(nextId(), `${m.anchorPerson} linkedin ${m.anchorNoun}`, [m.page.id], "factual", "profile"));
  }
  if (m.kind === "table" && rand() < 0.8) {
    GENERATED_QUERIES.push(q(nextId(), `${m.anchorNoun} price rating table`, [m.page.id], "factual", "table"));
  }
  if (m.kind === "image" && rand() < 0.8) {
    GENERATED_QUERIES.push(q(nextId(), `photo essay ${c.theme} ${m.anchorPerson}`, [m.page.id], "factual", "image"));
  }
  // Navigational: title-ish phrasing for some pages.
  if (rand() < 0.22) {
    const stem = m.page.title.split(/[:|(]/)[0]!.trim();
    GENERATED_QUERIES.push(q(nextId(), `that ${m.kind === "transcript" ? "video" : m.kind === "profile" ? "profile" : "page"} about ${stem}`, [m.page.id], "navigational", m.kind));
  }
}

// Exploratory: one per cluster and kind group (articles, profiles).
for (const c of CLUSTERS) {
  const articles = GENERATED_META.filter((m) => m.cluster === c.key && (m.kind === "article" || m.kind === "news")).map((m) => m.page.id);
  GENERATED_QUERIES.push(q(nextId(), `${c.theme} overview`, articles, "exploratory", "cluster articles + news"));
  const profiles = GENERATED_META.filter((m) => m.cluster === c.key && m.kind === "profile").map((m) => m.page.id);
  GENERATED_QUERIES.push(q(nextId(), `people who work in ${c.theme}`, profiles, "exploratory", "cluster profiles"));
}

for (const neg of NEGATIVE_QUERIES) {
  GENERATED_QUERIES.push(q(nextId(), neg, [], "negative", "real world topic absent from corpus"));
}

export const GENERATED_STATS = {
  pages: GENERATED_PAGES.length,
  byKind: GENERATED_META.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] ?? 0) + 1;
    return acc;
  }, {}),
  queries: GENERATED_QUERIES.length,
  byType: GENERATED_QUERIES.reduce<Record<string, number>>((acc, x) => {
    acc[x.query_type] = (acc[x.query_type] ?? 0) + 1;
    return acc;
  }, {}),
};
