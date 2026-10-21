import { describe, expect, it } from "vitest";
import { capBudget } from "@claudio/core";
import { parseBudget } from "../src/budget.js";
import { renderSlack, wants, DEFAULT_NOTIFICATIONS } from "../src/notify.js";

describe("monthly budget", () => {
  it("reads amounts and treats empty or invalid input as no limit", () => {
    expect(parseBudget("150")).toBe(150);
    expect(parseBudget("12,5")).toBe(12.5);
    expect(parseBudget("")).toBeNull();
    expect(parseBudget("0")).toBeNull();
    expect(parseBudget("viel")).toBeNull();
  });
  it("caps a run's cost at what is left", () => {
    expect(capBudget({ maxBudgetUsd: 8 }, 3).maxBudgetUsd).toBe(3);
    expect(capBudget({ maxBudgetUsd: 8 }, 20).maxBudgetUsd).toBe(8);
    expect(capBudget({ maxBudgetUsd: 8 }, null).maxBudgetUsd).toBe(8);
    expect(capBudget({ maxBudgetUsd: 8 }, 0).maxBudgetUsd).toBe(0.05);
  });
  it("warns in Slack, always, with the numbers", () => {
    const e = { kind: "budget" as const, spent: 82, limit: 100, exhausted: false };
    expect(wants({ ...DEFAULT_NOTIFICATIONS, reviews: "off", tests: "off", takeover: false }, e)).toBe(true);
    const m = renderSlack("o/r", e, { language: "de", baseUrl: "https://c.test", mention: "" });
    expect(m.text).toBe("82 % des Monatsbudgets verbraucht (o/r)");
    expect(JSON.stringify(m.blocks)).toContain("82.00 von 100.00 USD in diesem Monat");
  });
  it("puts an agent's question with its suggested answers into Slack", () => {
    const m = renderSlack("o/r", { kind: "question", run: "review", id: 4, what: "#17 X", question: "Ist das Fahrzeug Pflicht?", options: ["Ja", "Nein"] }, { language: "de", baseUrl: "https://c.test", mention: "<!here>" });
    const text = JSON.stringify(m.blocks);
    expect(text).toContain("<!here> :speech_balloon: *Claudio hat eine Frage:* Ist das Fahrzeug Pflicht?");
    expect(text).toContain("• Ja");
    expect(text).toContain("https://c.test/reviews/4");
  });
});
