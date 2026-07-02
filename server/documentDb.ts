import { eq, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { documents, InsertDocument, Document } from "../drizzle/schema";

export async function insertDocument(doc: InsertDocument): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(documents).values(doc);
  return (result[0] as unknown as { insertId: number }).insertId;
}

export async function getDocuments(): Promise<Document[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(documents).orderBy(desc(documents.createdAt));
}

export async function getDocumentById(id: number): Promise<Document | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return rows[0];
}

export async function getReadyDocuments(): Promise<Document[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(documents)
    .where(eq(documents.status, "ready"))
    .orderBy(desc(documents.createdAt));
}

export async function updateDocumentEmbedding(
  id: number,
  extractedText: string,
  embeddingJson: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(documents)
    .set({ extractedText, embeddingJson, status: "ready" })
    .where(eq(documents.id, id));
}

export async function updateDocumentError(id: number, errorMessage: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(documents)
    .set({ status: "error", errorMessage })
    .where(eq(documents.id, id));
}

export async function deleteDocument(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(documents).where(eq(documents.id, id));
}

export async function resetDocumentToProcessing(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(documents)
    .set({ status: "processing", errorMessage: null, extractedText: null, embeddingJson: null })
    .where(eq(documents.id, id));
}

export async function deleteDocuments(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(documents).where(inArray(documents.id, ids));
}
