import { parseQuestion } from "./question-parser";
import { runAdvancedSearch } from "../search-engine";
import {
  buildChatPrompt,
  CHAT_SYSTEM_PROMPT,
  selectChunksForBudget,
  selectHistoryForPrompt,
} from "./context-builder";
import { addMessageToConversation, createConversation, getConversationMessages } from "./conversation-store";
import {
  decideRoute,
  streamAnswer,
  ChatUnavailableError,
  type RouteDecision,
} from "./llm-router";
import { CortexError } from "../errors";
import type { ChatSettings } from "./types";
import { answerPeopleQuery, parsePeopleQuery } from "../people";
export interface ChatStreamEvent {
  type:
    | "conversation"
    | "route"
    | "sources"
    | "token"
    | "done"
    | "error"
    | "aborted";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface RunChatOptions {
  /** CORTEX_CHAT_ABORT: stop streaming, do not store the partial answer. */
  signal?: AbortSignal;
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

export async function* runChat(
  conversationId: number | null,
  question: string,
  settings: ChatSettings,
  embedQuery: (text: string) => Promise<number[] | null>,
  opts: RunChatOptions = {}
): AsyncIterable<ChatStreamEvent> {
  const signal = opts.signal;
  try {
    const parsed = parseQuestion(question);

    let convId = conversationId;
    if (convId == null) {
      convId = await createConversation(question);
      yield { type: "conversation", data: { id: convId } };
    }

    // People questions ("who did I view from X") come from the people store,
    // not from page search or a model. Falls through to RAG when nobody matches.
    if (settings.peopleEnabled !== false) {
      const pq = parsePeopleQuery(question);
      const answer = pq ? await answerPeopleQuery(pq) : null;
      if (answer) {
        await addMessageToConversation(convId, { role: "user", content: question, timestamp: Date.now() });
        yield { type: "sources", data: { chunks: [] } };
        yield { type: "token", data: answer.text };
        await addMessageToConversation(convId, {
          role: "assistant",
          content: answer.text,
          timestamp: Date.now(),
          citedChunks: [],
        });
        yield { type: "done", data: { provider: "people" } };
        return;
      }
    }

    const priorMessages =
      convId != null ? await getConversationMessages(convId) : [];
    const history = selectHistoryForPrompt(
      priorMessages.map((m) => ({ role: m.role, content: m.content }))
    );

    const forceTimeRange = parsed.timeRange
      ? {
          start: parsed.timeRange.from.getTime(),
          end: parsed.timeRange.to.getTime(),
        }
      : undefined;

    const qtext =
      parsed.searchQuery.trim() ||
      parsed.rawQuery.trim() ||
      parsed.rawQuery;

    const searchResults = await runAdvancedSearch(qtext, embedQuery, {
      maxHits: 20,
      forceTimeRange,
      includeChunks: true,
    });

    const rawChunks = searchResults.chunks ?? [];

    if (rawChunks.length === 0) {
      yield {
        type: "error",
        data: {
          message: parsed.timeRange
            ? `I didn't find that in your library for ${parsed.timeRange.label}.`
            : "I didn't find that in your library.",
          userAction: searchResults.abstained
            ? "Try different words, or read the page again so Cortex can index it."
            : undefined,
          recoverable: true,
        },
      };
      return;
    }

    const NANO_MAX = 18_000;
    const CLOUD_MAX = 200_000;
    const maxChars =
      settings.cloudEnabled && settings.geminiApiKey ? CLOUD_MAX : NANO_MAX;

    const selectedChunks = selectChunksForBudget(
      rawChunks,
      maxChars,
      question.length
    );

    yield {
      type: "sources",
      data: {
        chunks: selectedChunks,
        timeRange: parsed.timeRange,
      },
    };

    const prompt = buildChatPrompt({
      question: parsed.rawQuery,
      chunks: selectedChunks,
      timeContext: parsed.timeRange?.label,
      history,
    });

    const route: RouteDecision = await decideRoute(prompt, parsed, settings);
    yield { type: "route", data: route };

    await addMessageToConversation(convId, {
      role: "user",
      content: question,
      timestamp: Date.now(),
    });

    let fullAnswer = "";
    for await (const token of streamAnswer(
      prompt,
      CHAT_SYSTEM_PROMPT,
      route,
      settings,
      { signal }
    )) {
      if (signal?.aborted) break;
      fullAnswer += token;
      yield { type: "token", data: token };
      if (signal?.aborted) break;
    }

    if (signal?.aborted) {
      yield { type: "aborted", data: { provider: route.provider } };
      return;
    }

    const citedChunks = selectedChunks
      .filter((c) => c.id != null)
      .map((c) => ({
        chunkId: c.id as number,
        documentId: c.documentId,
        url: c.document.url,
        title: c.document.title,
      }));

    await addMessageToConversation(convId, {
      role: "assistant",
      content: fullAnswer,
      timestamp: Date.now(),
      citedChunks,
      provider: route.provider,
    });

    yield { type: "done", data: { provider: route.provider } };
  } catch (e) {
    if (signal?.aborted || isAbortError(e)) {
      yield { type: "aborted", data: {} };
      return;
    }
    if (e instanceof ChatUnavailableError) {
      yield {
        type: "error",
        data: {
          message: e.message,
          userAction: e.userAction,
          recoverable: true,
        },
      };
      return;
    }
    if (e instanceof CortexError) {
      yield {
        type: "error",
        data: {
          ...e.toPayload(),
        },
      };
      return;
    }
    yield {
      type: "error",
      data: {
        message: `Chat failed: ${String(e)}`,
        recoverable: false,
      },
    };
  }
}
