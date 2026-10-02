/** Pages used to lock the topic similarity threshold. Expected labels are the ones a reader should accept. */
export interface TopicFixture {
  id: string;
  text: string;
  expected: string[];
}

export const TOPIC_FIXTURES: readonly TopicFixture[] = [
  {
    id: "injection",
    text: "The article explains why chatbots obey strangers. A hidden instruction in a web page tells the model to ignore its rules and leak the system prompt. The author calls this prompt injection and shows a defense that strips untrusted text before the model sees it.",
    expected: ["prompt injection", "AI security"],
  },
  {
    id: "vectors",
    text: "Pinecone and Weaviate store embeddings so a search can find a paragraph by meaning. The post compares index types and how to filter metadata on a vector database.",
    expected: ["vector databases"],
  },
  {
    id: "rag",
    text: "Retrieval augmented generation fetches a few passages from the company wiki and puts them in the prompt before the model answers. The writeup is about RAG, not about training a new model.",
    expected: ["RAG"],
  },
  {
    id: "tesla",
    text: "Tesla posted delivery numbers for the quarter and described the factory ramp in Fremont and Austin. The piece is about vehicle production at the car company.",
    expected: ["Tesla"],
  },
  {
    id: "apartment",
    text: "We toured a one bedroom in Oakland listed for rent. The notes cover the lease length, pet rules, and how far the apartment is from the station.",
    expected: ["apartment hunting", "San Francisco Bay Area"],
  },
  {
    id: "flights",
    text: "The search compared nonstop flights from the airport to Boston in November, with prices and layover times. It is a trip planning page.",
    expected: ["flights and travel"],
  },
  {
    id: "recipe",
    text: "Roast the chicken and baste it with butter. The recipe serves four and lists the ingredients and the oven steps.",
    expected: ["cooking and recipes"],
  },
  {
    id: "interview",
    text: "The recruiter scheduled a loop of four interviews. I wrote down the questions they asked and how I answered the system design round.",
    expected: ["interviews"],
  },
  {
    id: "extension",
    text: "The Manifest V3 service worker cannot hold a long WebAssembly session, so the Chrome extension loads the model in an offscreen document. The content script only runs after the privacy checks.",
    expected: ["Chrome extensions"],
  },
  {
    id: "python",
    text: "The notebook trains a model with scikit learn on tabular features and prints a cross validation score. The example is written in Python.",
    expected: ["machine learning"],
  },
  {
    id: "investing",
    text: "The portfolio note explains index funds, expense ratios, and how to rebalance a taxable account. It is about long term investing.",
    expected: ["finance and investing"],
  },
  {
    id: "sports",
    text: "The game recap covers the fourth quarter, the final score, and the injured point guard. It is a basketball writeup.",
    expected: ["sports"],
  },
  {
    id: "show",
    text: "The review discusses the season finale, the cast, and whether the show is worth watching this weekend.",
    expected: ["entertainment"],
  },
  {
    id: "github",
    text: "The repository README explains how to clone the project, run the tests, and open a pull request on GitHub.",
    expected: ["GitHub"],
  },
  {
    id: "paper",
    text: "The abstract reports a result on a held out test set and cites the method section. The PDF is an academic paper.",
    expected: ["academic papers"],
  },
  {
    id: "manual",
    text: "The manual lists each command, its flags, and an example. This is the product documentation for installing the tool.",
    expected: ["documentation and manuals"],
  },
  {
    id: "agents",
    text: "The agent loop lets the model call tools, read the result, and decide the next step. The post is about AI agents that browse and complete tasks.",
    expected: ["AI agents"],
  },
  {
    id: "chrome-noise",
    text: "Skip to content. Loading. Accept cookies. Subscribe to the newsletter. Share this page.",
    expected: [],
  },
];
