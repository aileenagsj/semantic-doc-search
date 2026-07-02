import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import path from "path";

// ─── Helpers mirrored from batchUploadRoute.ts ────────────────────────────────

const ALLOWED_DOC_MIMES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

const MAX_ENTRY_SIZE = 20 * 1024 * 1024;

function classifyEntry(entryName: string, size: number): { accept: boolean; reason?: string } {
  const baseName = path.basename(entryName);
  const ext = path.extname(baseName).toLowerCase();

  if (baseName.startsWith(".") || entryName.includes("__MACOSX")) {
    return { accept: false, reason: "System file" };
  }
  if (!ALLOWED_DOC_MIMES[ext]) {
    return { accept: false, reason: "Unsupported file type" };
  }
  if (size === 0) {
    return { accept: false, reason: "Empty file" };
  }
  if (size > MAX_ENTRY_SIZE) {
    return { accept: false, reason: "Exceeds 20 MB limit" };
  }
  return { accept: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ZIP entry classification", () => {
  it("accepts a valid PDF entry", () => {
    expect(classifyEntry("docs/report.pdf", 1024).accept).toBe(true);
  });

  it("accepts a valid DOCX entry", () => {
    expect(classifyEntry("folder/contract.docx", 2048).accept).toBe(true);
  });

  it("accepts a valid DOC entry", () => {
    expect(classifyEntry("letter.doc", 512).accept).toBe(true);
  });

  it("rejects an image file", () => {
    const r = classifyEntry("photo.jpg", 1024);
    expect(r.accept).toBe(false);
    expect(r.reason).toMatch(/unsupported/i);
  });

  it("rejects a hidden file", () => {
    const r = classifyEntry(".DS_Store", 128);
    expect(r.accept).toBe(false);
    expect(r.reason).toMatch(/system/i);
  });

  it("rejects __MACOSX artefacts", () => {
    const r = classifyEntry("__MACOSX/._report.pdf", 64);
    expect(r.accept).toBe(false);
  });

  it("rejects an empty file", () => {
    const r = classifyEntry("empty.pdf", 0);
    expect(r.accept).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });

  it("rejects a file exceeding the size limit", () => {
    const r = classifyEntry("huge.pdf", MAX_ENTRY_SIZE + 1);
    expect(r.accept).toBe(false);
    expect(r.reason).toMatch(/20 MB/i);
  });
});

describe("AdmZip in-memory extraction", () => {
  it("can create and read a ZIP buffer in memory", () => {
    const zip = new AdmZip();
    zip.addFile("hello.txt", Buffer.from("hello world"));
    const buffer = zip.toBuffer();

    const zip2 = new AdmZip(buffer);
    const entries = zip2.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("hello.txt");
    expect(entries[0].getData().toString()).toBe("hello world");
  });

  it("filters out directory entries", () => {
    const zip = new AdmZip();
    zip.addFile("subdir/", Buffer.alloc(0)); // directory
    zip.addFile("subdir/doc.pdf", Buffer.from("%PDF-1.4"));
    const buffer = zip.toBuffer();

    const zip2 = new AdmZip(buffer);
    const files = zip2.getEntries().filter(e => !e.isDirectory);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("doc.pdf");
  });

  it("handles an empty ZIP gracefully", () => {
    const zip = new AdmZip();
    const buffer = zip.toBuffer();
    const zip2 = new AdmZip(buffer);
    expect(zip2.getEntries().filter(e => !e.isDirectory)).toHaveLength(0);
  });
});

describe("batch entry limit", () => {
  it("stops accepting entries after the cap", () => {
    const MAX_ENTRIES = 200;
    const names = Array.from({ length: 250 }, (_, i) => `file_${i}.pdf`);
    const accepted: string[] = [];
    const skipped: string[] = [];

    for (const name of names) {
      if (accepted.length >= MAX_ENTRIES) {
        skipped.push(name);
      } else {
        accepted.push(name);
      }
    }

    expect(accepted).toHaveLength(MAX_ENTRIES);
    expect(skipped).toHaveLength(50);
  });
});
