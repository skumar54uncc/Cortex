import { db } from "../../db/schema";

export interface Conversation {
  id?: number;
  createdAt: number;
  updatedAt: number;
  title: string;
}

export interface Message {
  id?: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  citedChunks?: Array<{
    chunkId: number;
    documentId: number;
    url: string;
    title: string;
  }>;
  provider?: "nano" | "cloud";
}

export async function createConversation(firstMessage: string): Promise<number> {
  const title =
    firstMessage.slice(0, 60) + (firstMessage.length > 60 ? "…" : "");
  const id = await db.conversations.add({
    createdAt: Date.now(),
    updatedAt: Date.now(),
    title,
  });
  return id as number;
}

export async function addMessageToConversation(
  conversationId: number,
  message: Omit<Message, "id" | "conversationId">
): Promise<void> {
  await db.transaction("rw", db.messages, db.conversations, async () => {
    await db.messages.add({
      conversationId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      citedChunksJson: message.citedChunks
        ? JSON.stringify(message.citedChunks)
        : undefined,
      provider: message.provider,
    });
    await db.conversations.update(conversationId, { updatedAt: Date.now() });
  });
}

export async function getConversationMessages(
  conversationId: number
): Promise<Message[]> {
  const rows = await db.messages
    .where("conversationId")
    .equals(conversationId)
    .sortBy("timestamp");
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    role: r.role,
    content: r.content,
    timestamp: r.timestamp,
    provider: r.provider,
    citedChunks: r.citedChunksJson
      ? (JSON.parse(r.citedChunksJson) as Message["citedChunks"])
      : undefined,
  }));
}

export async function listRecentConversations(
  limit = 20
): Promise<Conversation[]> {
  return db.conversations.orderBy("updatedAt").reverse().limit(limit).toArray();
}

export async function deleteConversation(
  conversationId: number
): Promise<void> {
  await db.transaction("rw", db.messages, db.conversations, async () => {
    await db.messages.where("conversationId").equals(conversationId).delete();
    await db.conversations.delete(conversationId);
  });
}
