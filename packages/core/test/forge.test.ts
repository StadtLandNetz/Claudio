import { describe, expect, it } from "vitest";
import {
  ReviewRequestSchema,
  changeRef,
  envMatches,
  isValidFullName,
  parseRepoInput,
  parseRepoPath,
  providerOf,
  repoHref,
  repoPath,
  splitRepo,
} from "../src/index.js";

describe("repository paths", () => {
  it("keeps GitHub at owner/name and puts GitLab below gitlab/", () => {
    expect(repoPath({ fullName: "vanderlars/claudio" })).toBe("vanderlars/claudio");
    expect(repoPath({ provider: "github", fullName: "vanderlars/claudio" })).toBe("vanderlars/claudio");
    expect(repoPath({ provider: "gitlab", fullName: "slw/apps/dispo" })).toBe("gitlab/slw/apps/dispo");
    expect(repoHref({ provider: "gitlab", fullName: "slw/dispo" }, "tab=settings")).toBe("/repos/gitlab/slw/dispo?tab=settings");
  });

  it("parses what repoPath produces", () => {
    for (const repo of [
      { provider: "github" as const, fullName: "vanderlars/claudio" },
      { provider: "github" as const, fullName: "gitlab/claudio" },
      { provider: "gitlab" as const, fullName: "slw/dispo" },
      { provider: "gitlab" as const, fullName: "slw/apps/sub/dispo.web" },
    ]) {
      expect(parseRepoPath(repoPath(repo))).toEqual(repo);
    }
  });

  it("rejects paths that name no repository", () => {
    expect(parseRepoPath("vanderlars")).toBeNull();
    expect(parseRepoPath("a/b/c")).toBeNull();
    expect(parseRepoPath("gitlab/onlygroup")).toEqual({ provider: "github", fullName: "gitlab/onlygroup" });
    expect(parseRepoPath("gitlab/a/../b")).toBeNull();
    expect(parseRepoPath("own er/name")).toBeNull();
  });

  it("checks the segment count per provider", () => {
    expect(isValidFullName("github", "o/r")).toBe(true);
    expect(isValidFullName("github", "o/r/x")).toBe(false);
    expect(isValidFullName("gitlab", "g/sub/p")).toBe(true);
    expect(isValidFullName("gitlab", "p")).toBe(false);
  });

  it("splits namespace and name", () => {
    expect(splitRepo("slw/apps/dispo")).toEqual({ namespace: "slw/apps", name: "dispo" });
    expect(splitRepo("o/r")).toEqual({ namespace: "o", name: "r" });
  });
});

describe("provider wording", () => {
  it("references pull and merge requests the way each forge does", () => {
    expect(changeRef("github", 12)).toBe("#12");
    expect(changeRef(undefined, 12)).toBe("#12");
    expect(changeRef("gitlab", 12)).toBe("!12");
  });

  it("treats rows without a provider as GitHub", () => {
    expect(providerOf({})).toBe("github");
    expect(providerOf(null)).toBe("github");
    expect(providerOf({ provider: "gitlab" })).toBe("gitlab");
  });
});

describe("environments", () => {
  it("matches a name or a folder of it", () => {
    expect(envMatches("Preview", "preview")).toBe(true);
    expect(envMatches("review", "Review/16-neue-fahrt")).toBe(true);
    expect(envMatches("review", "reviewer")).toBe(false);
    expect(envMatches("", "review")).toBe(false);
  });
});

describe("requests", () => {
  it("accept nested GitLab paths and keep old GitHub requests valid", () => {
    const base = { pr: 3, instanceUrl: "https://pr-3.example.test" };
    expect(ReviewRequestSchema.parse({ ...base, repo: "o/r" }).provider).toBeUndefined();
    expect(ReviewRequestSchema.parse({ ...base, repo: "g/sub/p", provider: "gitlab" }).repo).toBe("g/sub/p");
    expect(() => ReviewRequestSchema.parse({ ...base, repo: "nope" })).toThrow();
  });
});

describe("repository input", () => {
  it("accepts paths and links of the provider", () => {
    expect(parseRepoInput("vanderlars/claudio", "github")).toBe("vanderlars/claudio");
    expect(parseRepoInput("https://github.com/vanderlars/claudio.git/", "github")).toBe("vanderlars/claudio");
    expect(parseRepoInput("slw/apps/dispo", "gitlab")).toBe("slw/apps/dispo");
    expect(parseRepoInput("https://gitlab.com/slw/apps/dispo/-/merge_requests/3", "gitlab")).toBe("slw/apps/dispo");
    expect(parseRepoInput("https://git.example.de/slw/dispo.git", "gitlab", "git.example.de")).toBe("slw/dispo");
  });

  it("rejects other hosts and malformed names", () => {
    expect(parseRepoInput("https://gitlab.com/slw/dispo", "github")).toBeNull();
    expect(parseRepoInput("a/b/c", "github")).toBeNull();
    expect(parseRepoInput("nope", "gitlab")).toBeNull();
    expect(parseRepoInput("https://evil.test/slw/dispo", "gitlab")).toBeNull();
  });
});
