import { describe, it, expect, vi } from "vitest";
import { sendTermCmd, onTermCmd, type TermCmd } from "./termBus";

describe("termBus", () => {
  it("delivers simple commands to subscribers", () => {
    const seen: TermCmd[] = [];
    const off = onTermCmd((cmd) => seen.push(cmd));
    sendTermCmd("clear");
    sendTermCmd("scroll-bottom");
    off();
    expect(seen).toEqual(["clear", "scroll-bottom"]);
  });

  it("delivers paste payload objects intact", () => {
    const handler = vi.fn();
    const off = onTermCmd(handler);
    const cmd: TermCmd = { kind: "paste", text: "line1\nline2" };
    sendTermCmd(cmd);
    off();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(cmd);
  });

  it("stops delivering after unsubscribe", () => {
    const handler = vi.fn();
    const off = onTermCmd(handler);
    off();
    sendTermCmd("focus");
    expect(handler).not.toHaveBeenCalled();
  });

  it("fans out to multiple subscribers independently", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onTermCmd(a);
    const offB = onTermCmd(b);
    sendTermCmd("find");
    offA();
    sendTermCmd("focus");
    offB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});
