import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { groupPeerExchanges } from "./peer-exchange";

describe("groupPeerExchanges", () => {
  it("collapses request, activity, and terminal reply while keeping inbox message visible", () => {
    const request: Message = {
      id: "m1",
      at: 1000,
      role: "bot",
      kind: "text",
      roomRequest: { id: "req-1", phase: "request" },
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      text: "@Designer Bot Ping Imam now...",
    };
    const activity: Message = {
      id: "m2",
      at: 2000,
      role: "bot",
      kind: "activity",
      tool: { name: "agents_message_person", ok: true },
    };
    const inbox: Message = {
      id: "m3",
      at: 3000,
      role: "bot",
      kind: "text",
      inbox: { kind: "message", from: { name: "Designer Bot", botId: "designer" }, replies: true },
      text: "Halo Imam...",
    };
    const terminal: Message = {
      id: "m4",
      at: 4000,
      role: "bot",
      kind: "text",
      turnId: "turn-1",
      turnTerminal: true,
      turnSucceeded: true,
      text: "Sent. One-line confirmation: pinged Imam.",
    };
    const digest: Message = {
      id: "m5",
      at: 5000,
      role: "bot",
      kind: "digest",
    };

    const items = groupPeerExchanges([request, activity, inbox, terminal, digest]);
    expect(items).toHaveLength(3);

    expect(items[0]).toEqual({
      kind: "peer-exchange",
      id: "peer:req-1",
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      messages: [request, activity, terminal],
    });

    expect(items[1]).toEqual({
      kind: "message",
      message: inbox,
    });

    expect(items[2]).toEqual({
      kind: "message",
      message: digest,
    });
  });

  it("stops a peer exchange span early when a user message arrives", () => {
    const request: Message = {
      id: "m1",
      at: 1000,
      role: "bot",
      kind: "text",
      roomRequest: { id: "req-2", phase: "request" },
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      text: "Do background check",
    };
    const activity: Message = {
      id: "m2",
      at: 2000,
      role: "bot",
      kind: "activity",
      tool: { name: "search", ok: true },
    };
    const userMessage: Message = {
      id: "m3",
      at: 3000,
      role: "user",
      kind: "text",
      text: "Wait, cancel that",
    };
    const terminal: Message = {
      id: "m4",
      at: 4000,
      role: "bot",
      kind: "text",
      turnTerminal: true,
      text: "Cancelled",
    };

    const items = groupPeerExchanges([request, activity, userMessage, terminal]);
    expect(items).toHaveLength(3);

    expect(items[0]).toEqual({
      kind: "peer-exchange",
      id: "peer:req-2",
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      messages: [request, activity],
    });
    expect(items[1]).toEqual({ kind: "message", message: userMessage });
    expect(items[2]).toEqual({ kind: "message", message: terminal });
  });

  it("leaves messages ungrouped when there is no peer request", () => {
    const userMessage: Message = {
      id: "u1",
      at: 1000,
      role: "user",
      kind: "text",
      text: "Hello",
    };
    const botMessage: Message = {
      id: "b1",
      at: 2000,
      role: "bot",
      kind: "text",
      text: "Hello there",
    };
    const activity: Message = {
      id: "a1",
      at: 3000,
      role: "bot",
      kind: "activity",
      tool: { name: "lookup", ok: true },
    };

    const items = groupPeerExchanges([userMessage, botMessage, activity]);
    expect(items).toEqual([
      { kind: "message", message: userMessage },
      { kind: "message", message: botMessage },
      { kind: "message", message: activity },
    ]);
  });

  it("handles two separate exchanges in the same transcript", () => {
    const request1: Message = {
      id: "r1",
      at: 1000,
      role: "bot",
      kind: "text",
      roomRequest: { id: "req-1", phase: "request" },
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      text: "Step 1",
    };
    const terminal1: Message = {
      id: "t1",
      at: 2000,
      role: "bot",
      kind: "text",
      turnTerminal: true,
      text: "Step 1 done",
    };
    const humanInterjection: Message = {
      id: "u1",
      at: 3000,
      role: "user",
      kind: "text",
      text: "Great job",
    };
    const request2: Message = {
      id: "r2",
      at: 4000,
      role: "bot",
      kind: "text",
      roomRequest: { id: "req-2", phase: "request" },
      from: { botId: "scout", name: "Scout Bot", color: "green" },
      text: "Step 2",
    };
    const activity2: Message = {
      id: "a2",
      at: 5000,
      role: "bot",
      kind: "activity",
      tool: { name: "fetch", ok: true },
    };
    const terminal2: Message = {
      id: "t2",
      at: 6000,
      role: "bot",
      kind: "text",
      turnTerminal: true,
      text: "Step 2 done",
    };

    const items = groupPeerExchanges([
      request1,
      terminal1,
      humanInterjection,
      request2,
      activity2,
      terminal2,
    ]);

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      kind: "peer-exchange",
      id: "peer:req-1",
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      messages: [request1, terminal1],
    });
    expect(items[1]).toEqual({ kind: "message", message: humanInterjection });
    expect(items[2]).toEqual({
      kind: "peer-exchange",
      id: "peer:req-2",
      from: { botId: "scout", name: "Scout Bot", color: "green" },
      messages: [request2, activity2, terminal2],
    });
  });
  it("folds requesting side exchange rows: sentRow, teammateResultRow, and resumed line", () => {
    const coord: Message = {
      id: "coord-1",
      at: 1000,
      role: "bot",
      kind: "activity",
      tool: { name: "agents_coordinate_bots", ok: true },
    };
    const sent: Message = {
      id: "sent-1",
      at: 2000,
      role: "bot",
      kind: "activity",
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      tool: { name: "Sent to Designer Bot", ok: true },
      threadRef: { botId: "designer", threadId: "t-1", title: "Teammate work" },
      roomRequest: { id: "req-1", phase: "request" },
    };
    const result: Message = {
      id: "result-1",
      at: 3000,
      role: "bot",
      kind: "activity",
      from: { botId: "designer", name: "Designer Bot", color: "purple" },
      tool: { name: "Designer Bot replied", ok: true, output: "Wireframes ready" },
      roomRequest: { id: "req-1", phase: "result" },
      threadRef: { botId: "designer", threadId: "t-1", title: "Teammate work" },
    };
    const resumed: Message = {
      id: "resumed-1",
      at: 4000,
      role: "bot",
      kind: "activity",
      tool: { name: "Resumed with Designer Bot results, reviewing", ok: true },
    };
    const reply: Message = {
      id: "reply-1",
      at: 5000,
      role: "bot",
      kind: "text",
      text: "The wireframes are ready to inspect.",
    };

    const items = groupPeerExchanges([coord, sent, result, resumed, reply]);
    expect(items).toHaveLength(3);

    expect(items[0]).toEqual({
      kind: "message",
      message: coord,
    });

    expect(items[1]).toEqual({
      kind: "peer-exchange",
      id: "peer:req-1",
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      toName: "Designer Bot",
      messages: [sent, result, resumed],
    });

    expect(items[2]).toEqual({
      kind: "message",
      message: reply,
    });
  });

  it("folds requesting side with comm field and room handoff shape", () => {
    const sent: Message = {
      id: "sent-2",
      at: 1000,
      role: "bot",
      kind: "activity",
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      tool: { name: "Sent to Architect Bot in Architecture", ok: true },
      comm: { groupId: "grp-arch", threadId: "t-arch", withBotId: "arch", withName: "Architect Bot", withColor: "red" },
    };
    const result: Message = {
      id: "result-2",
      at: 2000,
      role: "bot",
      kind: "activity",
      from: { botId: "arch", name: "Architect Bot", color: "red" },
      tool: { name: "Architect Bot replied · Architecture", ok: true, output: "System design approved" },
      comm: { groupId: "grp-arch", threadId: "t-arch", withBotId: "arch", withName: "Architect Bot", withColor: "red" },
    };
    const resumed: Message = {
      id: "resumed-2",
      at: 3000,
      role: "bot",
      kind: "activity",
      tool: { name: "Resumed with Architect Bot results, reviewing", ok: true },
    };

    const items = groupPeerExchanges([sent, result, resumed]);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      kind: "peer-exchange",
      id: "peer:sent-2",
      from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
      toName: "Architect Bot",
      messages: [sent, result, resumed],
    });
  });

  it("leaves unmatched outbound request as a regular message until result arrives", () => {
    const sent: Message = {
      id: "sent-pending",
      at: 1000,
      role: "bot",
      kind: "activity",
      from: { botId: "chief", name: "Chief Assistant Bot" },
      tool: { name: "Sent to Designer Bot", ok: true },
      threadRef: { botId: "designer", threadId: "t-pending", title: "Teammate work" },
    };

    const items = groupPeerExchanges([sent]);
    expect(items).toEqual([{ kind: "message", message: sent }]);
  });

  it("handles parallel outbound requests to separate teammates cleanly", () => {
    const sent1: Message = {
      id: "sent-a",
      at: 1000,
      role: "bot",
      kind: "activity",
      from: { botId: "chief", name: "Chief Assistant Bot" },
      tool: { name: "Sent to Designer Bot", ok: true },
      threadRef: { botId: "designer", threadId: "t-a", title: "Teammate work" },
      roomRequest: { id: "req-a", phase: "request" },
    };
    const sent2: Message = {
      id: "sent-b",
      at: 2000,
      role: "bot",
      kind: "activity",
      from: { botId: "chief", name: "Chief Assistant Bot" },
      tool: { name: "Sent to Researcher Bot", ok: true },
      threadRef: { botId: "researcher", threadId: "t-b", title: "Teammate work" },
      roomRequest: { id: "req-b", phase: "request" },
    };
    const result1: Message = {
      id: "result-a",
      at: 3000,
      role: "bot",
      kind: "activity",
      from: { botId: "designer", name: "Designer Bot" },
      tool: { name: "Designer Bot replied", ok: true },
      roomRequest: { id: "req-a", phase: "result" },
    };
    const result2: Message = {
      id: "result-b",
      at: 4000,
      role: "bot",
      kind: "activity",
      from: { botId: "researcher", name: "Researcher Bot" },
      tool: { name: "Researcher Bot replied", ok: true },
      roomRequest: { id: "req-b", phase: "result" },
    };

    const items = groupPeerExchanges([sent1, sent2, result1, result2]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      kind: "peer-exchange",
      id: "peer:req-a",
      from: { botId: "chief", name: "Chief Assistant Bot" },
      toName: "Designer Bot",
      messages: [sent1, result1],
    });
    expect(items[1]).toEqual({
      kind: "peer-exchange",
      id: "peer:req-b",
      from: { botId: "chief", name: "Chief Assistant Bot" },
      toName: "Researcher Bot",
      messages: [sent2, result2],
    });
  });
});
