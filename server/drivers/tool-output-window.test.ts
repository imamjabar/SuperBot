import { describe, expect, it } from "vitest";
import { DROPPED_TOOL_OUTPUT, fitToolOutputs } from "./tool-output-window.ts";
import type { OpenAIChatMessage } from "./openai-chat.ts";

describe("fitToolOutputs", () => {
  const toolRound = (id: string, outputSize: number): OpenAIChatMessage[] => [
    { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "fetch", arguments: "{}" } }] },
    { role: "tool", tool_call_id: id, content: JSON.stringify({ ok: true, result: "x".repeat(outputSize) }) },
  ];

  it("under 55% window nothing changes and returns 0", () => {
    const window = 10_000;
    const messages: OpenAIChatMessage[] = [
      { role: "system", content: "You are a research bot." },
      { role: "user", content: "Investigate this topic." },
      ...toolRound("call-1", 500),
      ...toolRound("call-2", 500),
    ];
    const initialJson = JSON.stringify(messages);

    const dropped = fitToolOutputs(messages, window);

    expect(dropped).toBe(0);
    expect(JSON.stringify(messages)).toBe(initialJson);
  });

  it("over threshold replaces oldest tool outputs until <= 35%, keeping last 3 rounds and non-tool messages intact", () => {
    const window = 10_000;
    const system: OpenAIChatMessage = { role: "system", content: "System prompt." };
    const user: OpenAIChatMessage = { role: "user", content: "User question." };
    const screenshot: OpenAIChatMessage = {
      role: "user",
      content: [{ type: "text", text: "Screenshot from tool call-1" }],
    };

    const messages: OpenAIChatMessage[] = [
      system,
      user,
      ...toolRound("call-1", 6000),
      screenshot,
      ...toolRound("call-2", 6000),
      ...toolRound("call-3", 6000),
      ...toolRound("call-4", 1000),
      ...toolRound("call-5", 1000),
      ...toolRound("call-6", 1000),
    ];

    const droppedContent = JSON.stringify({ ok: true, result: DROPPED_TOOL_OUTPUT });
    const dropped = fitToolOutputs(messages, window);

    expect(dropped).toBe(2);
    expect(messages.find((m) => m.tool_call_id === "call-1")?.content).toBe(droppedContent);
    expect(messages.find((m) => m.tool_call_id === "call-2")?.content).toBe(droppedContent);
    expect(messages.find((m) => m.tool_call_id === "call-3")?.content).toContain("x".repeat(6000));
    expect(messages.find((m) => m.tool_call_id === "call-4")?.content).toContain("x".repeat(1000));
    expect(messages.find((m) => m.tool_call_id === "call-5")?.content).toContain("x".repeat(1000));
    expect(messages.find((m) => m.tool_call_id === "call-6")?.content).toContain("x".repeat(1000));

    expect(messages[0]).toBe(system);
    expect(messages[1]).toBe(user);
    expect(messages[4]).toBe(screenshot);
    expect(messages[2].role).toBe("assistant");
    expect(messages[2].tool_calls?.[0].id).toBe("call-1");

    messages.push(...toolRound("call-7", 6000));
    messages.push(...toolRound("call-8", 6000));
    const secondPassDropped = fitToolOutputs(messages, window);
    expect(secondPassDropped).toBeGreaterThan(0);
    expect(messages.find((m) => m.tool_call_id === "call-1")?.content).toBe(droppedContent);
    expect(messages.find((m) => m.tool_call_id === "call-2")?.content).toBe(droppedContent);
    expect(messages.find((m) => m.tool_call_id === "call-3")?.content).toBe(droppedContent);
  });

  it("a second call right after returns 0 for a stable prefix", () => {
    const window = 5_000;
    const messages: OpenAIChatMessage[] = [
      { role: "system", content: "System." },
      { role: "user", content: "User." },
      ...toolRound("call-1", 6000),
      ...toolRound("call-2", 6000),
      ...toolRound("call-3", 1000),
      ...toolRound("call-4", 1000),
      ...toolRound("call-5", 1000),
    ];

    const firstDropped = fitToolOutputs(messages, window);
    expect(firstDropped).toBeGreaterThan(0);

    const snapshot = JSON.stringify(messages);
    const secondDropped = fitToolOutputs(messages, window);
    expect(secondDropped).toBe(0);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });
});
