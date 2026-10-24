import { describe, expect, it } from "vitest";
import { weekStart } from "../src/gitlab/forge.js";
import { countDiffLines, extractGitlabIssueRefs, fileStatus, gitlabLevel } from "../src/gitlab/links.js";

const project = { fullName: "slw/apps/dispo", host: "gitlab.example.test" };

describe("GitLab issue references", () => {
  it("finds this project's issues in the description and the branch name", () => {
    const body = "Closes #12\nSee (#7) and https://gitlab.example.test/slw/apps/dispo/-/issues/99 and slw/apps/dispo#5";
    expect(extractGitlabIssueRefs(body, "16-neue-fahrt", project).sort((a, b) => a - b)).toEqual([5, 7, 12, 16, 99]);
  });

  it("leaves out merge requests, other projects and other hosts", () => {
    const body = "Needs !12, slw/other#3, https://gitlab.com/slw/apps/dispo/-/issues/4 and https://x.test/page#5";
    expect(extractGitlabIssueRefs(body, "main", project)).toEqual([]);
  });
});

describe("GitLab roles", () => {
  it("maps roles onto Claudio's levels", () => {
    expect(gitlabLevel(50, {})).toBe("admin");
    expect(gitlabLevel(40, {})).toBe("admin");
    expect(gitlabLevel(30, {})).toBe("write");
    expect(gitlabLevel(20, {})).toBe("read");
  });

  it("lets guests and non-members read only open repositories", () => {
    expect(gitlabLevel(10, { visibility: "private" })).toBe("none");
    expect(gitlabLevel(10, { visibility: "public" })).toBe("read");
    expect(gitlabLevel(0, { visibility: "internal" })).toBe("read");
    expect(gitlabLevel(0, { visibility: "public", repository_access_level: "private" })).toBe("none");
    expect(gitlabLevel(0, { visibility: "private" })).toBe("none");
  });
});

describe("GitLab diffs", () => {
  it("counts added and removed lines of a hunk", () => {
    expect(countDiffLines("@@ -1,3 +1,3 @@\n context\n-old\n+new\n+more\n--- not a header\n")).toEqual({ additions: 2, deletions: 2 });
  });

  it("names file changes the way GitHub does", () => {
    expect(fileStatus({ new_file: true })).toBe("added");
    expect(fileStatus({ deleted_file: true })).toBe("removed");
    expect(fileStatus({ renamed_file: true })).toBe("renamed");
    expect(fileStatus({})).toBe("modified");
  });

  it("starts contributor weeks on Sunday, like GitHub's statistics", () => {
    // Wednesday 2026-10-21 → Sunday 2026-10-18 00:00 UTC
    expect(new Date(weekStart("2026-10-21T15:30:00Z") * 1000).toISOString()).toBe("2026-10-18T00:00:00.000Z");
    expect(new Date(weekStart("2026-10-18T00:00:00Z") * 1000).toISOString()).toBe("2026-10-18T00:00:00.000Z");
    expect(new Date(weekStart("1970-01-01T12:00:00Z") * 1000).toISOString()).toBe("1969-12-28T00:00:00.000Z");
  });
});
