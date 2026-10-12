import { describe, expect, it } from "vitest";
import { StepRecorder } from "../src/tools/test-tools.js";

describe("StepRecorder", () => {
  it("records only successful steps and continues after a replayed prefix", () => {
    const r = new StepRecorder([{ action: "login", role: "dispatcher" }]);
    r.add({ action: "click", target: { text: "Alt" } }, false, 10, "not found", true);
    r.add({ action: "click", target: { role: "button", name: "Neu" } }, true, 12, undefined, true);
    expect(r.results.map((x) => [x.index, x.ok])).toEqual([[1, false], [2, true]]);
    expect(r.compiled()).toEqual([
      { action: "login", role: "dispatcher" },
      { action: "click", target: { role: "button", name: "Neu" } },
    ]);
  });
});
