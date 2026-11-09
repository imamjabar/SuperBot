import { describe, expect, it, vi } from "vitest";
import { markedThread, openBotRow, openRoomThread } from "./thread-navigation";

type Task = { threadId: string; activity?: string; unread?: boolean; busy?: boolean; routineRunId?: string; archivedAt?: number; createdAt?: number; updatedAt?: number };
const chief = (tasks: Task[], threadId = "main", mainThreadId = "main") => ({ id: "cos", threadId, mainThreadId, tasks: [{ threadId: "main", createdAt: 1 }, ...tasks] });
const opened = (bot: ReturnType<typeof chief>) => {
  const dispatch = vi.fn();
  openBotRow(dispatch, bot);
  return dispatch.mock.calls.map(([action]) => action);
};


describe("what a bot's row or tile is marked for", () => {
  it("is what waits on the person first, then an unread reply, then work under way", () => {
    const working = { threadId: "work", busy: true }, unread = { threadId: "reply", unread: true }, waiting = { threadId: "ask", activity: "waiting-on-you" };
    expect(markedThread(chief([working]))).toBe("work");
    expect(markedThread(chief([working, unread]))).toBe("reply");
    expect(markedThread(chief([working, unread, waiting]))).toBe("ask");
  });

  it("is the newest of equals, unless the thread the bot opens to is one of them", () => {
    const older = { threadId: "older", unread: true, updatedAt: 5 }, newer = { threadId: "newer", unread: true, updatedAt: 9 };
    expect(markedThread(chief([older, newer]))).toBe("newer");
    expect(markedThread({ ...chief([older, newer]), tasks: [{ threadId: "main", unread: true, createdAt: 1 }, older, newer] })).toBe("main");
  });

  it("is never a routine's run, nor an archived thread unless it waits on the person, as the row's own dot reads them", () => {
    expect(markedThread(chief([{ threadId: "run", busy: true, routineRunId: "r" }]))).toBeNull();
    expect(markedThread(chief([{ threadId: "put-away", unread: true, archivedAt: 1 }]))).toBeNull();
    expect(markedThread(chief([{ threadId: "put-away", activity: "waiting-on-you", archivedAt: 0 }]))).toBe("put-away");
  });

  it("is nothing on a quiet bot", () => {
    expect(markedThread(chief([{ threadId: "quiet" }]))).toBeNull();
    expect(markedThread({ id: "x", threadId: "t" } as unknown as ReturnType<typeof chief>)).toBeNull();
  });
});

describe("a click on a bot's row or tile", () => {
  const work = { threadId: "work", unread: true };

  it("always opens the bot's main chat, ignoring marked thread", () => {
    expect(opened(chief([work]))).toEqual([{ type: "select", id: "cos" }]);
    expect(opened(chief([work], "work"))).toEqual([{ type: "switchTask", botId: "cos", threadId: "main" }]);
  });

  it("opens the bot as ever when nothing is marked, or when the main chat itself is what is marked", () => {
    expect(opened(chief([{ threadId: "quiet" }]))).toEqual([{ type: "select", id: "cos" }]);
    expect(opened({ ...chief([work]), tasks: [{ threadId: "main", unread: true, createdAt: 1 }, { threadId: "work" }] })).toEqual([{ type: "select", id: "cos" }]);
  });

});

describe("a hand-off's chip for work in a room", () => {
  const room = { id: "room", threadId: "room-now", tasks: [{ threadId: "room-now" }, { threadId: "room-older" }] };
  const clicked = (comm: { groupId: string; threadId?: string }) => {
    const dispatch = vi.fn();
    openRoomThread(dispatch, comm, [room]);
    return dispatch.mock.calls.map(([action]) => action);
  };

  it("lands on the thread it names, not whichever the room is on", () => {
    expect(clicked({ groupId: "room", threadId: "room-older" })).toEqual([{ type: "select", id: "room" }, { type: "switchGroupTask", groupId: "room", threadId: "room-older" }]);
  });

  it("opens the room when it names no thread, or one the room no longer has", () => {
    expect(clicked({ groupId: "room" })).toEqual([{ type: "select", id: "room" }]);
    expect(clicked({ groupId: "room", threadId: "deleted" })).toEqual([{ type: "select", id: "room" }]);
  });
});
