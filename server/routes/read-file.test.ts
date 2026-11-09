import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";

import { createValidPdf } from "./pdf-text.test.ts";
import {
  extractFileContent,
  formatFindWindows,
  handleReadFile,
  openZip,
  type ReadFileDeps,
} from "./read-file.ts";

function buildZip(files: Array<{ name: string; content: Buffer | string; method?: 0 | 8 }>): Buffer {
  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const rawData = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const method = file.method ?? 0;
    const compressedData = method === 8 ? zlib.deflateRawSync(rawData) : rawData;
    const nameBuf = Buffer.from(file.name, "utf8");

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(0, 14);
    lfh.writeUInt32LE(compressedData.length, 18);
    lfh.writeUInt32LE(rawData.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    localHeaders.push(lfh, compressedData);

    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(0, 16);
    cdh.writeUInt32LE(compressedData.length, 20);
    cdh.writeUInt32LE(rawData.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    nameBuf.copy(cdh, 46);

    cdHeaders.push(cdh);
    offset += lfh.length + compressedData.length;
  }

  const cdStart = offset;
  const cdBuf = Buffer.concat(cdHeaders);
  const cdSize = cdBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

describe("read_file extraction", () => {
  it("extracts text from docx xml preserving paragraphs and decoding entities", async () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>First Paragraph &amp; Heading</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second paragraph with &quot;quotes&quot; and</w:t><w:br/><w:t>a forced line break.</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const zip = buildZip([{ name: "word/document.xml", content: docXml, method: 8 }]);
    const result = await extractFileContent("report.docx", zip);
    expect(result.type).toBe("Word document (.docx)");
    expect(result.text).toContain("First Paragraph & Heading");
    expect(result.text).toContain('Second paragraph with "quotes" and\na forced line break.');
    expect(result.text).not.toContain("<w:");
  });

  it("extracts slides from pptx in numerical slide order", async () => {
    const slide1 = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:p><a:r><a:t>Overview Slide</a:t></a:r></a:p></p:cSld></p:sld>`;
    const slide2 = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:p><a:r><a:t>Financial Details</a:t></a:r></a:p></p:cSld></p:sld>`;
    const zip = buildZip([
      { name: "ppt/slides/slide2.xml", content: slide2, method: 0 },
      { name: "ppt/slides/slide1.xml", content: slide1, method: 8 },
    ]);
    const result = await extractFileContent("presentation.pptx", zip);
    expect(result.type).toBe("PowerPoint presentation (.pptx)");
    expect(result.text).toBe("[slide 1]\nOverview Slide\n\n[slide 2]\nFinancial Details");
  });

  it("lists sheet names from xlsx and directs model to data_load", async () => {
    const workbookXml = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>
    <sheet name="Summary 2026" sheetId="1" r:id="rId1"/>
    <sheet name="Q1 Revenue &amp; Profit" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;
    const zip = buildZip([{ name: "xl/workbook.xml", content: workbookXml, method: 8 }]);
    const result = await extractFileContent("model.xlsx", zip);
    expect(result.type).toBe("Excel spreadsheet (.xlsx)");
    expect(result.text).toContain("Sheets: Summary 2026, Q1 Revenue & Profit");
    expect(result.text).toContain("Use data_load to inspect spreadsheet cells.");
  });

  it("extracts text from a valid PDF", async () => {
    const pdfBuf = createValidPdf("BT /F1 12 Tf 72 712 Td (Quarterly Audit Findings) Tj ET");
    const result = await extractFileContent("audit.pdf", pdfBuf);
    expect(result.type).toBe("PDF (.pdf)");
    expect(result.text).toContain("[page 1]");
    expect(result.text).toContain("Quarterly Audit Findings");
  });

  it("extracts Markdown and CSV as UTF-8 text", async () => {
    const md = "# Readme\n\nProject instructions.";
    const mdResult = await extractFileContent("README.md", Buffer.from(md, "utf8"));
    expect(mdResult.type).toBe("MD file");
    expect(mdResult.text).toBe(md);

    const csv = "id,name,rate\n1,Alice,45\n2,Bob,50";
    const csvResult = await extractFileContent("rates.csv", Buffer.from(csv, "utf8"));
    expect(csvResult.type).toBe("CSV file");
    expect(csvResult.text).toBe(csv);
  });

  it("extracts HTML text using pageText", async () => {
    const html = `<!doctype html><html><head><title>Web Page</title></head><body><h1>Heading</h1><p>Main body text.</p></body></html>`;
    const result = await extractFileContent("index.html", Buffer.from(html, "utf8"));
    expect(result.type).toBe("HTML (.html)");
    expect(result.text).toContain("Heading");
    expect(result.text).toContain("Main body text.");
  });

  it("answers that attached images are seen directly", async () => {
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const result = await extractFileContent("chart.png", pngMagic);
    expect(result.isImage).toBe(true);
    expect(result.text).toContain("Attached images are seen directly by the model");
  });

  it("suggests to_computer for unsupported binary files", async () => {
    const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const result = await extractFileContent("driver.bin", binary);
    expect(result.notText).toBe(true);
    expect(result.text).toContain("cannot be read as text");
    expect(result.text).toContain("to_computer: true");
  });
});

describe("paging and find", () => {
  it("pages long text with 12,000 char windows and next offset", () => {
    const longText = "A".repeat(25_000);
    const window1 = longText.slice(0, 12_000);
    expect(window1).toHaveLength(12_000);
    const nextOffset = 12_000;
    const window2 = longText.slice(nextOffset, nextOffset + 12_000);
    expect(window2).toHaveLength(12_000);
    const tail = longText.slice(24_000, 24_000 + 12_000);
    expect(tail).toHaveLength(1_000);
  });

  it("finds matching terms and merges nearby windows with offsets", () => {
    const text = "Prefix content... " + "x".repeat(400) + " target term alpha " + "y".repeat(100) + " target term beta " + "z".repeat(500);
    const { matches } = formatFindWindows(text, "alpha | beta", 0);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.text).toContain("target term alpha");
    expect(matches[0]?.text).toContain("target term beta");
  });
});

describe("security and sandbox isolation", () => {
  it("allows files under conversation roots and rejects traversal and outside files", async () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "omb-test-root-")));
    const outsideDir = realpathSync(mkdtempSync(join(tmpdir(), "omb-test-outside-")));
    const vmDir = realpathSync(mkdtempSync(join(tmpdir(), "omb-test-vm-")));

    try {
      const allowedFile = join(rootDir, "notes.txt");
      writeFileSync(allowedFile, "Confidential notes content");

      const outsideFile = join(outsideDir, "secret.txt");
      writeFileSync(outsideFile, "Outside secret");

      const symlinkOut = join(rootDir, "link_to_outside.txt");
      symlinkSync(outsideFile, symlinkOut);

      const deps: Omit<ReadFileDeps, "readBody"> = {
        botId: "bot-1",
        threadId: "thread-1",
        ownsThread: () => true,
        roots: () => [rootDir],
        vmWorkspace: async () => vmDir,
      };

      const okRes = await handleReadFile(deps, { path: "notes.txt" });
      expect(okRes.status).toBe(200);
      expect(okRes.body.text).toBe("Confidential notes content");

      const outsideRes = await handleReadFile(deps, { path: outsideFile });
      expect(outsideRes.status).toBe(403);
      expect(outsideRes.body.error).toContain("outside this conversation's workspace");

      const traversalRes = await handleReadFile(deps, { path: "../omb-test-outside/secret.txt" });
      expect(traversalRes.status).toBe(403);

      const symlinkRes = await handleReadFile(deps, { path: symlinkOut });
      expect(symlinkRes.status).toBe(403);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
      rmSync(vmDir, { recursive: true, force: true });
    }
  });

  it("rejects files exceeding 50 MB", async () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "omb-test-large-")));
    try {
      const largeFile = join(rootDir, "huge.txt");
      writeFileSync(largeFile, Buffer.alloc(50 * 1024 * 1024 + 10));

      const deps: Omit<ReadFileDeps, "readBody"> = {
        botId: "bot-1",
        threadId: "thread-1",
        ownsThread: () => true,
        roots: () => [rootDir],
        vmWorkspace: async () => null,
      };

      const res = await handleReadFile(deps, { path: largeFile });
      expect(res.status).toBe(413);
      expect(res.body.error).toContain("50 MB");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("copies to Local VM workspace when to_computer is true", async () => {
    const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "omb-test-to-vm-")));
    const vmDir = realpathSync(mkdtempSync(join(tmpdir(), "omb-test-vm-dest-")));
    try {
      const dataFile = join(rootDir, "dataset.csv");
      writeFileSync(dataFile, "x,y\n1,2\n3,4");

      const deps: Omit<ReadFileDeps, "readBody"> = {
        botId: "bot-1",
        threadId: "thread-1",
        ownsThread: () => true,
        roots: () => [rootDir],
        vmWorkspace: async () => vmDir,
      };

      const res = await handleReadFile(deps, { path: "dataset.csv", to_computer: true });
      expect(res.status).toBe(200);
      expect(res.body.toComputer).toBe("/home/cua/workspace/uploads/dataset.csv");
      expect(res.body.formatted).toContain("Copied to Local VM: /home/cua/workspace/uploads/dataset.csv");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(vmDir, { recursive: true, force: true });
    }
  });

  it("stops zip bombs exceeding entry limits or uncompressed size", () => {
    const fakeZipWithTooManyEntries = Buffer.alloc(30);
    fakeZipWithTooManyEntries.writeUInt32LE(0x06054b50, 0);
    fakeZipWithTooManyEntries.writeUInt16LE(5001, 10);
    fakeZipWithTooManyEntries.writeUInt32LE(0, 12);
    fakeZipWithTooManyEntries.writeUInt32LE(0, 16);

    expect(() => openZip(fakeZipWithTooManyEntries)).toThrow(/Zip entry count/);
  });
});
