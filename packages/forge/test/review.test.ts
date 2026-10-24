import { describe, expect, it } from "vitest";
import type { Octokit } from "octokit";
import { postPullRequestReview } from "../src/github/client.js";

type Review = { id: number; state: string; user: { login: string }; body: string };

/** Just enough of Octokit for postPullRequestReview; records what was sent. */
function fakeOctokit(opts: { ownPr?: boolean; reviews?: Review[] } = {}) {
  const created: string[] = [];
  const dismissed: number[] = [];
  const octokit = {
    rest: {
      pulls: {
        createReview: async ({ event }: { event: string }) => {
          if (event === "REQUEST_CHANGES" && opts.ownPr) throw Object.assign(new Error("Can not request changes on your own pull request"), { status: 422 });
          created.push(event);
          return { data: { html_url: `https://github.test/review/${created.length}` } };
        },
        listReviews: {},
        dismissReview: async ({ review_id }: { review_id: number }) => {
          dismissed.push(review_id);
        },
      },
      users: { getAuthenticated: async () => ({ data: { login: "claudio-user" } }) },
    },
    paginate: async () => opts.reviews ?? [],
  } as unknown as Octokit;
  return { octokit, created, dismissed };
}

describe("postPullRequestReview", () => {
  it("requests changes when the review found something blocking", async () => {
    const gh = fakeOctokit();
    expect(await postPullRequestReview(gh.octokit, "o/r", 1, "**Claudio Review: …**", true)).toEqual({ url: "https://github.test/review/1", requestedChanges: true });
    expect(gh.created).toEqual(["REQUEST_CHANGES"]);
  });

  it("falls back to a comment on the person's own pull request", async () => {
    const gh = fakeOctokit({ ownPr: true });
    expect((await postPullRequestReview(gh.octokit, "o/r", 1, "body", true)).requestedChanges).toBe(false);
    expect(gh.created).toEqual(["COMMENT"]);
  });

  it("withdraws only Claudio's own earlier change requests when nothing blocks any more", async () => {
    const gh = fakeOctokit({
      reviews: [
        { id: 1, state: "CHANGES_REQUESTED", user: { login: "claudio-user" }, body: "**Claudio Review: Änderungen nötig**" },
        { id: 2, state: "CHANGES_REQUESTED", user: { login: "claudio-user" }, body: "Bitte noch Tests ergänzen" },
        { id: 3, state: "CHANGES_REQUESTED", user: { login: "someone-else" }, body: "**Claudio Review: Änderungen nötig**" },
        { id: 4, state: "COMMENTED", user: { login: "claudio-user" }, body: "**Claudio Review: …**" },
      ],
    });
    await postPullRequestReview(gh.octokit, "o/r", 1, "body", false);
    expect(gh.dismissed).toEqual([1]);
    expect(gh.created).toEqual(["COMMENT"]);
  });
});
