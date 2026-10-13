import { describe, expect, it } from "vitest";
import { TestStepSchema, describeStep, hostAllowed, parseHostList, resolveStepTemplates, resolveTemplate } from "../src/index.js";

const now = new Date(2026, 9, 12, 10, 0, 0);

describe("templates", () => {
  it("resolves run tag and relative dates", () => {
    expect(resolveTemplate("claudio-{{run}}-Fahrt", { runTag: "abc1", now })).toBe("claudio-abc1-Fahrt");
    expect(resolveTemplate("{{date:+1:DD.MM.YYYY}}", { runTag: "x", now })).toBe("13.10.2026");
    expect(resolveTemplate("{{date:-12}}", { runTag: "x", now })).toBe("2026-09-30");
    expect(resolveTemplate("{{ date }}", { runTag: "x", now })).toBe("2026-10-12");
  });
  it("leaves unknown templates alone", () => {
    expect(resolveTemplate("{{user}}", { runTag: "x", now })).toBe("{{user}}");
  });
  it("resolves inside targets too", () => {
    const step = TestStepSchema.parse({ action: "expect_visible", target: { role: "cell", name: "claudio-{{run}}" } });
    expect(resolveStepTemplates(step, { runTag: "r9", now })).toEqual({ action: "expect_visible", target: { role: "cell", name: "claudio-r9" } });
  });
});

describe("describeStep", () => {
  it("reads like an instruction", () => {
    expect(describeStep({ action: "click", target: { role: "button", name: "Speichern" } })).toBe("Klicken auf button „Speichern“");
    expect(describeStep({ action: "fill", target: { label: "Datum" }, value: "{{date:+1}}" })).toBe("Feld „Datum“ ausfüllen mit „{{date:+1}}“");
    expect(describeStep({ action: "expect_no_errors" })).toBe("Prüfen: keine Fehler in Konsole und Netzwerk");
  });
});

describe("allowed hosts", () => {
  it("normalises user input to host names", () => {
    expect(parseHostList("https://www.Google.com/search?q=x, login.example.de;  bad host, localhost")).toEqual(["www.google.com", "login.example.de"]);
  });
  it("allows subdomains of allowed hosts only", () => {
    expect(hostAllowed("www.google.com", ["google.com"])).toBe(true);
    expect(hostAllowed("evilgoogle.com", ["google.com"])).toBe(false);
    expect(hostAllowed("127.0.0.1", ["127.0.0.1"])).toBe(true);
  });
});
