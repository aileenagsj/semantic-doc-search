import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Minimal context (no auth required — public procedure) ────────────────────

function makeCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

// ─── Input validation ─────────────────────────────────────────────────────────

describe("documents.bulkDelete input validation", () => {
  it("rejects an empty ids array", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.documents.bulkDelete({ ids: [] })
    ).rejects.toThrow();
  });

  it("rejects ids with non-positive integers", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.documents.bulkDelete({ ids: [0] })
    ).rejects.toThrow();
  });

  it("rejects ids exceeding the 500-item cap", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const tooMany = Array.from({ length: 501 }, (_, i) => i + 1);
    await expect(
      caller.documents.bulkDelete({ ids: tooMany })
    ).rejects.toThrow();
  });

  it("accepts exactly 500 ids", async () => {
    // This will fail at DB level (no real DB in unit tests), but the Zod
    // validation must pass — so we expect a DB-level error, not a Zod error.
    const caller = appRouter.createCaller(makeCtx());
    const maxIds = Array.from({ length: 500 }, (_, i) => i + 1);
    try {
      await caller.documents.bulkDelete({ ids: maxIds });
    } catch (err: unknown) {
      // Must NOT be a Zod validation error
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/too_big|too_small|invalid_type/i);
    }
  });

  it("accepts a single valid id", async () => {
    const caller = appRouter.createCaller(makeCtx());
    try {
      await caller.documents.bulkDelete({ ids: [999999] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/too_big|too_small|invalid_type/i);
    }
  });
});

// ─── deleteDocuments helper ───────────────────────────────────────────────────

describe("deleteDocuments helper — edge cases", () => {
  it("no-ops gracefully when ids array is empty (direct helper)", async () => {
    // Import the helper directly to test the guard clause
    const { deleteDocuments } = await import("./documentDb");
    // Should resolve without throwing (early return before DB call)
    await expect(deleteDocuments([])).resolves.toBeUndefined();
  });
});
