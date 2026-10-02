/** Fixed topic list. The short label is what the sheet stores. The embed text is only for MiniLM. */
export interface TopicLabel {
  label: string;
  embed: string;
}

export const TOPIC_CATALOG: readonly TopicLabel[] = [
  {
    label: "AI security",
    embed: "AI security, securing language models, attacks on AI systems, and defenses that keep a model from being abused",
  },
  {
    label: "prompt injection",
    embed: "prompt injection, hidden instructions in a web page, and chatbots that obey untrusted text from strangers",
  },
  {
    label: "LLMs",
    embed: "large language models, tokens, chat models, and how a language model generates text",
  },
  {
    label: "RAG",
    embed: "retrieval augmented generation, fetching passages to answer a question with a language model",
  },
  {
    label: "vector databases",
    embed: "vector databases such as Pinecone or Weaviate, embedding indexes, and nearest neighbor search",
  },
  {
    label: "evals and benchmarking",
    embed: "evals and benchmarks that score model quality on a held out test set",
  },
  {
    label: "AI agents",
    embed: "AI agents that call tools, read the result, and choose the next step in a loop",
  },
  {
    label: "machine learning",
    embed: "machine learning, training a model on features, and cross validation scores",
  },
  {
    label: "data science",
    embed: "data science, exploratory analysis, statistics, and notebooks that explain a dataset",
  },
  {
    label: "Python",
    embed: "the Python programming language, pip, and Python scripts",
  },
  {
    label: "TypeScript",
    embed: "the TypeScript programming language, types, and tsc",
  },
  {
    label: "JavaScript",
    embed: "the JavaScript programming language in the browser and in Node",
  },
  {
    label: "Chrome extensions",
    embed: "Chrome extensions, Manifest V3, service workers, and content scripts",
  },
  {
    label: "web development",
    embed: "web development, HTML, CSS, and building websites",
  },
  {
    label: "APIs",
    embed: "HTTP APIs, request and response schemas, and client libraries",
  },
  {
    label: "open source",
    embed: "open source software, licenses, maintainers, and public contributions",
  },
  {
    label: "GitHub",
    embed: "GitHub repositories, pull requests, issues, and cloning a project",
  },
  {
    label: "cloud infrastructure",
    embed: "cloud infrastructure, servers, Kubernetes, and deploying a service",
  },
  {
    label: "databases",
    embed: "relational databases, SQL tables, and query plans",
  },
  {
    label: "startups",
    embed: "startups, founders, fundraising, and early stage companies",
  },
  {
    label: "job search",
    embed: "job search, applications, recruiters, and open roles",
  },
  {
    label: "interviews",
    embed: "job interviews, interview questions, and a hiring loop",
  },
  {
    label: "LinkedIn networking",
    embed: "LinkedIn networking, connection requests, and reaching out to people in a field",
  },
  {
    label: "Tesla",
    embed: "Tesla vehicles, factories, and the car company",
  },
  {
    label: "San Francisco Bay Area",
    embed: "the San Francisco Bay Area, Oakland, San Jose, and neighborhoods around the bay",
  },
  {
    label: "flights and travel",
    embed: "flights, airports, layovers, and trip planning",
  },
  {
    label: "apartment hunting",
    embed: "apartment hunting, rent, leases, and touring a place to live",
  },
  {
    label: "fitness",
    embed: "fitness, workouts, running, and training",
  },
  {
    label: "cooking and recipes",
    embed: "cooking and recipes, ingredients, and how to prepare a meal",
  },
  {
    label: "news and current events",
    embed: "news and current events, what happened today in the world",
  },
  {
    label: "finance and investing",
    embed: "finance and investing, index funds, expense ratios, and a portfolio",
  },
  {
    label: "productivity",
    embed: "productivity, focus, task lists, and getting work done",
  },
  {
    label: "note taking and PKM",
    embed: "note taking and personal knowledge management, linking notes, and a second brain",
  },
  {
    label: "podcasts and video essays",
    embed: "podcasts and video essays, episodes, and long spoken explainers",
  },
  {
    label: "academic papers",
    embed: "academic papers, abstracts, citations, and a methods section",
  },
  {
    label: "documentation and manuals",
    embed: "documentation and manuals, command flags, and how to use a product",
  },
  {
    label: "shopping",
    embed: "shopping, product pages, prices, and buying an item",
  },
  {
    label: "health",
    embed: "health, clinics, symptoms, and medical appointments",
  },
  {
    label: "sports",
    embed: "sports, basketball and other games, a final score, and athletes",
  },
  {
    label: "entertainment",
    embed: "entertainment, shows, movies, and reviews of what to watch",
  },
];

export const TOPIC_LABELS: readonly string[] = TOPIC_CATALOG.map((t) => t.label);
