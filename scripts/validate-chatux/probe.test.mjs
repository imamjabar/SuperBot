import { describe, expect, it } from "vitest";
import { pairFinals } from "./probe.mjs";

const text = (id, at, turnId) => ({ id, at, role: "bot", kind: "text", text: id, ...(turnId ? { turnId } : {}) });
const step = (id, at, turnId) => ({ id, at, role: "bot", kind: "activity", ...(turnId ? { turnId } : {}) });
const user = (id, at) => ({ id, at, role: "user", kind: "text", text: id });

describe("pairFinals", () => {
  it("keeps a job's answer closing when the next job's hand-back steps follow it", () => {
    const rows = [
      user("vps ask", 0), user("news ask", 1), text("news ack", 7, "t-ack1"), text("vps ack", 11, "t-ack2"),
      text("news final", 69, "t-news"), step("MausBot replied", 103), step("Resumed with MausBot results", 103),
      text("vps final", 116, "t-vps"),
    ];
    const replies = rows.filter((m) => m.role === "bot" && m.kind === "text");
    expect(pairFinals(rows, replies, [62, 103]).map((m) => m.id)).toEqual(["news final", "vps final"]);
  });

  it("skips narration its own turn continues with a tool step", () => {
    const rows = [text("Fetching the pages now.", 40, "t1"), step("web_fetch", 41, "t1"), text("Here is the table.", 50, "t1")];
    expect(pairFinals(rows, rows.filter((m) => m.kind === "text"), [39]).map((m) => m.id)).toEqual(["Here is the table."]);
  });
});
