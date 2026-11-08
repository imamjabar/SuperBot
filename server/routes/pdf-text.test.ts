import { describe, expect, it } from "vitest";

import { pdfText } from "./pdf-text.ts";

export function createValidPdf(contentStream: string | null = "BT /F1 12 Tf 72 712 Td (Hello SuperBot) Tj ET"): Buffer {
  const chunks: string[] = [];
  const offsets: number[] = [];

  function add(str: string): void {
    chunks.push(str);
  }

  add("%PDF-1.4\n");

  offsets[1] = Buffer.byteLength(chunks.join(""), "latin1");
  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  offsets[2] = Buffer.byteLength(chunks.join(""), "latin1");
  add("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  offsets[3] = Buffer.byteLength(chunks.join(""), "latin1");
  if (contentStream !== null) {
    add("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n");
    offsets[4] = Buffer.byteLength(chunks.join(""), "latin1");
    const streamLen = Buffer.byteLength(contentStream, "latin1");
    add(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${contentStream}\nendstream\nendobj\n`);
    offsets[5] = Buffer.byteLength(chunks.join(""), "latin1");
    add("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  } else {
    add("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n");
  }

  const objCount = contentStream !== null ? 6 : 4;
  const startxref = Buffer.byteLength(chunks.join(""), "latin1");
  add(`xref\n0 ${objCount}\n0000000000 65535 f \n`);
  for (let i = 1; i < objCount; i++) {
    const off = String(offsets[i]).padStart(10, "0");
    add(`${off} 00000 n \n`);
  }
  add(`trailer\n<< /Size ${objCount} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  return Buffer.from(chunks.join(""), "latin1");
}

describe("pdfText", () => {
  it("extracts text and page count from a valid one-page PDF", async () => {
    const pdfBytes = new Uint8Array(createValidPdf());
    const result = await pdfText(pdfBytes);
    expect(result).toBeDefined();
    expect(result?.pages).toBe(1);
    expect(result?.text).toContain("[page 1]");
    expect(result?.text).toContain("Hello SuperBot");
  });

  it("returns undefined for random bytes starting with %PDF-", async () => {
    const corrupt = new Uint8Array(Buffer.from("%PDF-corrupted-random-binary-content-garbage\x00\xff\xfe"));
    const result = await pdfText(corrupt);
    expect(result).toBeUndefined();
  });
});
