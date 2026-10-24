import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATIONS, isSlackWebhookUrl, postSlack, renderSlack, wants, type NotifyEvent } from "../src/notify.js";

const review = (over: Partial<Extract<NotifyEvent, { kind: "review" }>> = {}): NotifyEvent => ({
  kind: "review",
  id: 7,
  prNumber: 1448,
  prTitle: "Trip trackings <can> be edited",
  status: "completed",
  verdict: "request_changes",
  acPassed: 10,
  acTotal: 12,
  findings: 2,
  blocking: ["Speichern verliert Änderungen"],
  tests: { passed: 0, total: 1 },
  costUsd: 7.27,
  followUp: "Nachprüfung von Review #5: 1 behoben, 1 weiterhin offen.",
  error: null,
  ...over,
});
const opts = { language: "de" as const, baseUrl: "https://claudio.example.test", mention: "<!here>" };

describe("wants", () => {
  it("follows the per-repo settings", () => {
    const s = { ...DEFAULT_NOTIFICATIONS, reviews: "changes" as const, tests: "failed" as const };
    expect(wants(s, review())).toBe(true);
    expect(wants(s, review({ verdict: "approve" }))).toBe(false);
    expect(wants({ ...s, reviews: "off" }, review())).toBe(false);
    expect(wants(s, { kind: "test", id: 1, name: "t", outcome: "passed", status: "completed", summary: "" })).toBe(false);
    expect(wants(s, { kind: "suite", batchId: "b", total: 3, passed: 2, failed: ["x"] })).toBe(true);
    expect(wants({ ...s, takeover: false }, { kind: "takeover", run: "review", id: 1, what: "#1", reason: "CAPTCHA" })).toBe(false);
  });
});

describe("renderSlack", () => {
  it("writes a short review result with link, counts, blocking titles and the re-review line", () => {
    const m = renderSlack("StadtLandNetz/Nova", review(), opts);
    const text = JSON.stringify(m.blocks);
    expect(m.text).toBe("Änderungen nötig: #1448 Trip trackings <can> be edited");
    expect(text).toContain("<!here> :x: *Änderungen nötig*");
    expect(text).toContain("<https://claudio.example.test/reviews/7|#1448 Trip trackings &lt;can&gt; be edited>");
    expect(text).toContain("Kriterien 10/12 · Findings 2, 1 blockierend · Tests 0/1 · 7.27 USD");
    expect(text).toContain("Speichern verliert Änderungen");
    expect(text).toContain("Nachprüfung von Review #5");
  });
  it("mentions only results that need someone", () => {
    const m = renderSlack("o/r", review({ verdict: "approve", blocking: [] }), opts);
    expect(JSON.stringify(m.blocks)).not.toContain("<!here>");
  });
  it("leaves links out without a base URL", () => {
    const m = renderSlack("o/r", { kind: "takeover", run: "test", id: 3, what: "#3", reason: "Bot-Prüfung" }, { ...opts, baseUrl: "" });
    const text = JSON.stringify(m.blocks);
    expect(text).toContain("Claudio braucht dich");
    expect(text).not.toContain("http");
    expect(text).not.toContain('"actions"');
  });
  it("says why an automatic review did not start", () => {
    const m = renderSlack("o/r", { kind: "automation", started: false, prNumber: 12, prTitle: "X", trigger: "push", reason: "Kein Deployment" }, { ...opts, language: "en" });
    expect(JSON.stringify(m.blocks)).toContain("*Automatic review not started*");
    expect(JSON.stringify(m.blocks)).toContain("push: Kein Deployment");
  });
});

describe("postSlack", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns null when Slack accepts, the answer otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    expect(await postSlack("https://hooks.slack.com/services/T/B/x", { text: "a", blocks: [] })).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid_token", { status: 403 })));
    expect(await postSlack("https://hooks.slack.com/services/T/B/x", { text: "a", blocks: [] })).toBe("Slack answered 403: invalid_token");
  });
});

describe("isSlackWebhookUrl", () => {
  it("accepts only Slack's webhook host", () => {
    expect(isSlackWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXX")).toBe(true);
    expect(isSlackWebhookUrl("http://hooks.slack.com/services/T000/B000/XXXX")).toBe(false);
    expect(isSlackWebhookUrl("https://hooks.slack.com.evil.test/services/x")).toBe(false);
    expect(isSlackWebhookUrl("https://169.254.169.254/latest")).toBe(false);
  });
});

describe("wording", () => {
  // Guards the GitHub wording while the messages become provider-aware.
  it("names pull requests the GitHub way", () => {
    expect(renderSlack("o/r", review(), opts).text).toMatchSnapshot();
    expect(renderSlack("o/r", { kind: "automation", started: true, prNumber: 17, prTitle: "Neue Fahrt", trigger: "comment", reason: "", reviewId: 9 }, opts)).toMatchSnapshot();
  });
});

describe("GitLab wording", () => {
  it("references merge requests with !", () => {
    expect(renderSlack("slw/dispo", review(), { ...opts, provider: "gitlab" }).text).toContain("!1448 Trip trackings");
  });
});
