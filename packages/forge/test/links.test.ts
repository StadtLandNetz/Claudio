import { describe, expect, it } from "vitest";
import { extractLinkedIssueNumbers, parseRepo } from "../src/github/links.js";

describe("extractLinkedIssueNumbers", () => {
  it("finds closing keywords, plain refs, links and branch numbers", () => {
    const body = "Closes #12\nSee also #7 and https://github.com/o/r/issues/99\nFixes: o/r#5";
    expect(extractLinkedIssueNumbers(body, "feature/42-neue-fahrt").sort((a, b) => a - b)).toEqual([5, 7, 12, 42, 99]);
  });
  it("ignores branch names without issue numbers", () => {
    expect(extractLinkedIssueNumbers("", "main")).toEqual([]);
    expect(extractLinkedIssueNumbers(null, "feature/foo")).toEqual([]);
  });
  it("parses owner/name", () => {
    expect(parseRepo("vanderlars/claudio")).toEqual({ owner: "vanderlars", repo: "claudio" });
    expect(() => parseRepo("nope")).toThrow();
  });
});
