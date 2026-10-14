import { describe, expect, it } from "vitest";
import { rememberLearningTool } from "../src/tools/definitions.js";

describe("remember_learning", () => {
  it("hands learnings to the worker and stops after five per run", async () => {
    const saved: string[] = [];
    const tool = rememberLearningTool((t) => saved.push(t));
    for (let i = 1; i <= 6; i++) await tool.handler({ text: `Lernpunkt Nummer ${i} für spätere Läufe` });
    expect(saved).toHaveLength(5);
    expect(await tool.handler({ text: "noch einer, der nicht mehr gespeichert wird" })).toMatch(/Limit/);
  });
});
