import { parseQuestion } from "./question-parser";
import { runAdvancedSearch } from "../search-engine";
import {
  buildChatPrompt,
  CHAT_SYSTEM_PROMPT,
  selectChunksForBudget,
} from "./context-builder";
import {
  decideRoute,
  streamAnswer,
  ChatUnavailableError,
  type RouteDecision,
} from "./llm-router";
import { CortexError } from "../errors";
import { addMessageToConversation, createConversation } from "./conversation-store";
import type { ChatSettings } from "./types";
export interface ChatStreamEvent {
  type:
    | "conversation"
    | "route"
    | "sources"
    | "token"
    | "done"
    | "error";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export async function* runChat(
  conversationId: number | null,
  question: string,
  settings: ChatSettings,
  embedQuery: (text: string) => Promise<number[] | null>
): AsyncIterable<ChatStreamEvent> {
  try {
    const parsed = parseQuestion(question);

    let convId = conversationId;
    if (convId == null) {
      convId = await createConversation(question);
      yield { type: "conversation", data: { id: convId } };
    }

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
            ? `I don't have anything indexed from ${parsed.timeRange.label} matching your question.`
            : `I don't have anything in your library matching that question.`,
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
      settings
    )) {
      fullAnswer += token;
      yield { type: "token", data: token };
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
