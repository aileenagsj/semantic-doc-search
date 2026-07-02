import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function makeCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("documents.reindex input validation", () => {
  it("rejects a non-positive id", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.documents.reindex({ id: 0 })).rejects.toThrow();
  });

  it("rejects a negative id", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.documents.reindex({ id: -1 })).rejects.toThrow();
  });

  it("rejects a missing id", async () => {
    const caller = appRouter.createCaller(makeCtx());
    // @ts-expect-error intentional bad input
    await expect(caller.documents.reindex({})).rejects.toThrow();
  });

  it("accepts a valid positive id (fails at DB level, not validation)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    try {
      await caller.documents.reindex({ id: 999999 });
    } catch (err: unknown) {
      // Must be a NOT_FOUND or DB error, not a Zod validation error
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/invalid_type|too_small/i);
    }
  });
});

describe("resetDocumentToProcessing helper", () => {
  it("resolves or throws a DB-level error (never a Zod error) for a valid id", async () => {
    const { resetDocumentToProcessing } = await import("./documentDb");
    try {
      await resetDocumentToProcessing(999999);
      // If it resolves (DB available but row not found), that's fine
    } catch (err: unknown) {
      // Must be a DB-level error, not a Zod validation error
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/invalid_type|too_small|too_big/i);
    }
  });
});
