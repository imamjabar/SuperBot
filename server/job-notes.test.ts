import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJobNotes } from "./job-notes.ts";
import type { Message } from "./store.ts";
import type { Store, TaskRecord } from "./store.ts";

describe("job-notes", () => {
  let tempDir: string;
  let tasks: Map<string, TaskRecord>;
  let messages: Map<string, Message[]>;
  let appended: Array<{ threadId: string; message: Omit<Message, "id" | "at"> }>;

  function fakeStore(): Pick<Store, "taskByThread" | "messagesFor" | "appendMessage"> {
    return {
      taskByThread: (botId: string, threadId: string) => tasks.get(`${botId}:${threadId}`),
      messagesFor: (threadId: string) => messages.get(threadId) ?? [],
      appendMessage: (threadId: string, message: Omit<Message, "id" | "at">) => {
        appended.push({ threadId, message });
        const list = messages.get(threadId) ?? [];
        const full: Message = { ...message, id: `msg-${list.length + 1}`, at: Date.now() };
        list.push(full);
        messages.set(threadId, list);
        return full;
      },
    };
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "job-notes-test-"));
    tasks = new Map();
    messages = new Map();
    appended = [];
  });

  afterEach(() => {
    try {
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("refuses job_notes in a thread that does not report back", () => {
    tasks.set("bot:other-thread", {
      threadId: "other-thread",
      title: "Normal thread",
      openedBy: { botId: "bot", name: "Bot", at: 0 },
    } as TaskRecord);
    const notes = createJobNotes(fakeStore(), tempDir);
    const res = notes.handle("bot", "other-thread", { read: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("only in a job that reports back");
  });

  it("adds, reads, finds, and unions columns in first-seen order", () => {
    tasks.set("bot:job-1", {
      threadId: "job-1",
      title: "Job 1",
      openedBy: { botId: "bot", name: "Bot", at: 0, reportsBack: true },
    } as TaskRecord);
    const notes = createJobNotes(fakeStore(), tempDir);

    const r1 = notes.handle("bot", "job-1", {
      add: [
        { company: "Acme", price: "100" },
        { company: "Beta", rating: "5" },
      ],
    });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ rows: 2, columns: ["company", "price", "rating"] });

    const r2 = notes.handle("bot", "job-1", {
      add: [{ company: "Gamma", price: "150", notes: "remote" }],
    });
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ rows: 3, columns: ["company", "price", "rating", "notes"] });

    const rRead = notes.handle("bot", "job-1", { read: true });
    expect(rRead.status).toBe(200);
    expect(rRead.body.rows).toBe(3);
    const readItems = rRead.body.items as Array<Record<string, string>>;
    expect(readItems.length).toBe(3);
    expect(readItems).toEqual([
      { company: "Acme", price: "100" },
      { company: "Beta", rating: "5" },
      { company: "Gamma", price: "150", notes: "remote" },
    ]);

    const rFind = notes.handle("bot", "job-1", { find: "gamma" });
    expect(rFind.status).toBe(200);
    expect(rFind.body.rows).toBe(3);
    expect(rFind.body.items).toEqual([{ company: "Gamma", price: "150", notes: "remote" }]);
  });

  it("validates limits and bad inputs", () => {
    tasks.set("bot:job-1", {
      threadId: "job-1",
      title: "Job 1",
      openedBy: { botId: "bot", name: "Bot", at: 0, reportsBack: true },
    } as TaskRecord);
    const notes = createJobNotes(fakeStore(), tempDir);

    expect(notes.handle("bot", "job-1", null).status).toBe(400);
    expect(notes.handle("bot", "job-1", {}).status).toBe(400);
    expect(notes.handle("bot", "job-1", { add: "not-an-array" }).status).toBe(400);
    expect(notes.handle("bot", "job-1", { add: ["string-row"] }).status).toBe(400);

    const tooManyKeys: Record<string, string> = {};
    for (let i = 0; i < 31; i++) tooManyKeys[`k${i}`] = "val";
    expect(notes.handle("bot", "job-1", { add: [tooManyKeys] }).status).toBe(400);

    const longKey = { ["k".repeat(61)]: "val" };
    expect(notes.handle("bot", "job-1", { add: [longKey] }).status).toBe(400);

    expect(notes.handle("bot", "job-1", { find: "a" }).status).toBe(400);
    expect(notes.handle("bot", "job-1", { find: "x".repeat(201) }).status).toBe(400);

    // Row limit: 2000 rows
    const chunk: Array<Record<string, string>> = [];
    for (let i = 0; i < 50; i++) chunk.push({ c: `row-${i}` });
    for (let i = 0; i < 40; i++) {
      const added = notes.handle("bot", "job-1", { add: chunk });
      expect(added.status).toBe(200);
    }
    // 2000 rows now. The 2001st row must return 409
    const overLimit = notes.handle("bot", "job-1", { add: [{ c: "one-too-many" }] });
    expect(overLimit.status).toBe(409);
    expect(String(overLimit.body.error)).toContain("2,000 rows");
  });

  it("persists rows across separate createJobNotes instances", () => {
    tasks.set("bot:job-persist", {
      threadId: "job-persist",
      title: "Persist Job",
      openedBy: { botId: "bot", name: "Bot", at: 0, reportsBack: true },
    } as TaskRecord);

    const instance1 = createJobNotes(fakeStore(), tempDir);
    instance1.handle("bot", "job-persist", { add: [{ a: "1", b: "2" }] });

    const instance2 = createJobNotes(fakeStore(), tempDir);
    const read = instance2.handle("bot", "job-persist", { read: true });
    expect(read.status).toBe(200);
    expect(read.body.items).toEqual([{ a: "1", b: "2" }]);
  });

  it("delivers a CSV with BOM, header, RFC 4180 quotes, and requestMessageId, and is idempotent", async () => {
    tasks.set("bot:job-deliver", {
      threadId: "job-deliver",
      title: "Price & Market Check",
      openedBy: { botId: "bot", name: "Bot", at: 0, reportsBack: true, requestMessageId: "req-123" },
    } as TaskRecord);

    const notes = createJobNotes(fakeStore(), tempDir);
    notes.handle("bot", "job-deliver", {
      add: [
        { item: 'Widget "Pro", v2\nEdition', price: "10,000", tag: "best" },
        { item: "Standard", price: "5000", tag: "ok" },
      ],
    });

    await notes.deliver({
      botId: "bot",
      jobThreadId: "job-deliver",
      parentThreadId: "chat-parent",
      title: "Price & Market Check",
      requestMessageId: "req-123",
    });

    expect(appended).toHaveLength(1);
    const delivery = appended[0]!;
    expect(delivery.threadId).toBe("chat-parent");
    expect(delivery.message.requestMessageId).toBe("req-123");
    expect(delivery.message.attachments).toHaveLength(1);
    const csvAtt = delivery.message.attachments![0]!;
    expect(csvAtt.mime).toBe("text/csv");
    expect(csvAtt.name).toBe("price-market-check.csv");

    // Verify CSV file content
    const csvBytes = readFileSync(csvAtt.path);
    // BOM: EF BB BF
    expect(csvBytes[0]).toBe(0xef);
    expect(csvBytes[1]).toBe(0xbb);
    expect(csvBytes[2]).toBe(0xbf);

    const csvText = csvBytes.subarray(3).toString("utf8");
    const lines = csvText.split("\r\n");
    expect(lines[0]).toBe("item,price,tag");
    expect(lines[1]).toBe('"Widget ""Pro"", v2\nEdition","10,000",best');
    expect(lines[2]).toBe("Standard,5000,ok");

    // Second deliver call does nothing
    await notes.deliver({
      botId: "bot",
      jobThreadId: "job-deliver",
      parentThreadId: "chat-parent",
      title: "Price & Market Check",
      requestMessageId: "req-123",
    });
    expect(appended).toHaveLength(1);
  });

  it("attaches markdown report only when last bot text exceeds 12,000 characters", async () => {
    tasks.set("bot:job-long", {
      threadId: "job-long",
      title: "Long Research",
      openedBy: { botId: "bot", name: "Bot", at: 0, reportsBack: true },
    } as TaskRecord);

    const store = fakeStore();
    const notes = createJobNotes(store, tempDir);
    notes.handle("bot", "job-long", { add: [{ item: "a" }] });

    // 12,050 char text message in the job thread
    const longReport = "# Detailed Report\n" + "X".repeat(12_050);
    store.appendMessage("job-long", { role: "bot", kind: "text", text: longReport });

    await notes.deliver({
      botId: "bot",
      jobThreadId: "job-long",
      parentThreadId: "chat-parent",
      title: "Long Research",
    });

    const delivery = appended.find((a) => a.threadId === "chat-parent");
    expect(delivery).toBeDefined();
    expect(delivery!.message.attachments).toHaveLength(2);

    const attachments = delivery!.message.attachments!;
    const csvAtt = attachments.find((a) => a.mime === "text/csv");
    const mdAtt = attachments.find((a) => a.mime === "text/markdown");
    expect(csvAtt).toBeDefined();
    expect(mdAtt).toBeDefined();
    expect(mdAtt!.name).toBe("long-research.md");

    const savedMd = readFileSync(mdAtt!.path, "utf8");
    expect(savedMd).toBe(longReport);
  });
});
