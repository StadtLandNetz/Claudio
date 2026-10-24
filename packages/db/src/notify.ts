import { changeRef, type Language, type Provider, type Verdict } from "@claudio/core";
import { slackWebhookUrl } from "./queries.js";
import type { NotificationSettings, Repo } from "./schema.js";

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  takeover: true,
  reviews: "all",
  automation: true,
  tests: "failed",
  analyses: true,
  mention: "",
};

/** Something worth a message in the repository's Slack channel. */
export type NotifyEvent =
  | { kind: "takeover"; run: "review" | "analysis" | "test"; id: number; what: string; reason: string }
  | { kind: "question"; run: "review" | "analysis" | "test"; id: number; what: string; question: string; options: string[] }
  | {
      kind: "review";
      id: number;
      prNumber: number;
      prTitle: string | null;
      status: string;
      verdict: Verdict | null;
      acPassed: number;
      acTotal: number;
      findings: number;
      blocking: string[];
      tests: { passed: number; total: number } | null;
      costUsd: number;
      /** Re-review: "Re-review of review #12: 2 fixed, 1 still open." */
      followUp: string | null;
      error: string | null;
    }
  | { kind: "automation"; started: boolean; prNumber: number; prTitle: string | null; trigger: string; reason: string; reviewId?: number }
  | { kind: "test"; id: number; name: string; outcome: string | null; status: string; summary: string }
  | { kind: "suite"; batchId: string; total: number; passed: number; failed: string[] }
  | { kind: "analysis"; id: number; status: string; docs: number; error: string | null }
  | { kind: "budget"; spent: number; limit: number; exhausted: boolean };

export type SlackMessage = { text: string; blocks: unknown[] };

const T = {
  de: {
    takeover: "Claudio braucht dich",
    question: "Claudio hat eine Frage",
    answerIn: "Antworten im Review: der Lauf wartet, bis jemand antwortet",
    takeoverRun: { review: "Review", analysis: "Analyse", test: "Testlauf" },
    open: "Öffnen",
    verdict: { approve: "Abnahme empfohlen", request_changes: "Änderungen nötig", inconclusive: "Review unvollständig" },
    failedRun: "Review nicht abgeschlossen",
    criteria: "Kriterien",
    findings: "Findings",
    blocking: "blockierend",
    tests: "Tests",
    started: "Automatisches Review gestartet",
    skipped: "Automatisches Review nicht gestartet",
    trigger: { comment: "Kommentar", label: "Label", push: "Push", deployment: "Deployment", manual: "manuell" } as Record<string, string>,
    test: { passed: "bestanden", failed: "fehlgeschlagen", inconclusive: "unklar" } as Record<string, string>,
    testRun: "Test",
    suite: "Testsuite fertig",
    suiteLine: "{passed} von {total} bestanden",
    failedTests: "Fehlgeschlagen",
    analysisDone: "Wissensbasis aktualisiert",
    analysisFailed: "Analyse fehlgeschlagen",
    docs: "{n} Dokumente",
    budgetWarn: "{pct} % des Monatsbudgets verbraucht",
    budgetStop: "Monatsbudget erreicht: neue Läufe starten erst im nächsten Monat oder mit höherem Budget",
    budgetLine: "{spent} von {limit} USD in diesem Monat",
    testMessage: "Testnachricht von Claudio: Benachrichtigungen für {repo} kommen hier an.",
  },
  en: {
    takeover: "Claudio needs you",
    question: "Claudio has a question",
    answerIn: "Answer in the review: the run waits until someone does",
    takeoverRun: { review: "Review", analysis: "Analysis", test: "Test run" },
    open: "Open",
    verdict: { approve: "Approval recommended", request_changes: "Changes needed", inconclusive: "Review incomplete" },
    failedRun: "Review did not finish",
    criteria: "Criteria",
    findings: "Findings",
    blocking: "blocking",
    tests: "Tests",
    started: "Automatic review started",
    skipped: "Automatic review not started",
    trigger: { comment: "comment", label: "label", push: "push", deployment: "deployment", manual: "manual" } as Record<string, string>,
    test: { passed: "passed", failed: "failed", inconclusive: "inconclusive" } as Record<string, string>,
    testRun: "Test",
    suite: "Test suite finished",
    suiteLine: "{passed} of {total} passed",
    failedTests: "Failed",
    analysisDone: "Knowledge base updated",
    analysisFailed: "Analysis failed",
    docs: "{n} documents",
    budgetWarn: "{pct} % of the monthly budget used",
    budgetStop: "Monthly budget reached: new runs start next month or with a higher budget",
    budgetLine: "{spent} of {limit} USD this month",
    testMessage: "Test message from Claudio: notifications for {repo} arrive here.",
  },
} as const;

/** Slack mrkdwn needs &, < and > escaped in text that is not a link. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (all, k: string) => (k in p ? String(p[k]) : all));
const link = (url: string | null, label: string) => (url ? `<${url}|${esc(label)}>` : esc(label));

/** Whether the repository wants to hear about this event at all. */
export function wants(settings: NotificationSettings, e: NotifyEvent): boolean {
  switch (e.kind) {
    case "takeover":
    case "question":
      return settings.takeover;
    case "review":
      return settings.reviews === "all" || (settings.reviews === "changes" && e.verdict !== "approve");
    case "automation":
      return settings.automation;
    case "test":
      return settings.tests === "all" || (settings.tests === "failed" && e.outcome !== "passed");
    case "suite":
      return settings.tests === "all" || (settings.tests === "failed" && e.failed.length > 0);
    case "analysis":
      return settings.analyses;
    case "budget":
      return true;
  }
}

/** The message for one event. `baseUrl` is the web UI (links are left out without it). */
export function renderSlack(repo: string, e: NotifyEvent, opts: { language: Language; baseUrl: string; mention: string; provider?: Provider }): SlackMessage {
  const t = T[opts.language];
  const url = (path: string) => (opts.baseUrl ? `${opts.baseUrl}${path}` : null);
  const mention = opts.mention.trim() ? `${opts.mention.trim()} ` : "";
  const context = (extra?: string) => ({ type: "context", elements: [{ type: "mrkdwn", text: `${esc(repo)}${extra ? ` · ${extra}` : ""}` }] });
  const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
  const button = (path: string) =>
    url(path) ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: t.open }, url: url(path) }] }] : [];

  switch (e.kind) {
    case "takeover": {
      const path = `/${e.run === "review" ? "reviews" : e.run === "analysis" ? "analyses" : "test-runs"}/${e.id}`;
      const text = `${mention}:raising_hand: *${t.takeover}:* ${esc(e.reason)}`;
      return { text: `${t.takeover}: ${e.reason}`, blocks: [section(text), context(`${t.takeoverRun[e.run]} ${link(url(path), e.what)}`), ...button(path)] };
    }
    case "question": {
      const path = `/${e.run === "review" ? "reviews" : e.run === "analysis" ? "analyses" : "test-runs"}/${e.id}`;
      const opts = e.options.length ? `\n${e.options.map((o) => `• ${esc(o)}`).join("\n")}` : "";
      return {
        text: `${t.question}: ${e.question}`,
        blocks: [section(`${mention}:speech_balloon: *${t.question}:* ${esc(e.question)}${opts}`), context(`${t.takeoverRun[e.run]} ${link(url(path), e.what)} · ${t.answerIn}`), ...button(path)],
      };
    }
    case "review": {
      const path = `/reviews/${e.id}`;
      const finished = e.verdict !== null;
      const icon = !finished ? ":warning:" : e.verdict === "approve" ? ":white_check_mark:" : e.verdict === "request_changes" ? ":x:" : ":grey_question:";
      const word = finished ? t.verdict[e.verdict!] : t.failedRun;
      const title = `${changeRef(opts.provider, e.prNumber)} ${e.prTitle ?? ""}`.trim();
      const facts = finished
        ? [
            `${t.criteria} ${e.acPassed}/${e.acTotal}`,
            `${t.findings} ${e.findings}${e.blocking.length ? `, ${e.blocking.length} ${t.blocking}` : ""}`,
            e.tests ? `${t.tests} ${e.tests.passed}/${e.tests.total}` : null,
            `${e.costUsd.toFixed(2)} USD`,
          ]
            .filter(Boolean)
            .join(" · ")
        : esc(e.error ?? e.status);
      const lines = [`${e.verdict === "request_changes" ? mention : ""}${icon} *${word}* · ${link(url(path), title)}`, facts];
      if (e.followUp) lines.push(`_${esc(e.followUp)}_`);
      const blocks: unknown[] = [section(lines.join("\n"))];
      if (e.blocking.length) blocks.push(section(e.blocking.slice(0, 5).map((b) => `• ${esc(b)}`).join("\n") + (e.blocking.length > 5 ? `\n• … +${e.blocking.length - 5}` : "")));
      blocks.push(context(), ...button(path));
      return { text: `${word}: ${title}`, blocks };
    }
    case "automation": {
      const title = `${changeRef(opts.provider, e.prNumber)} ${e.prTitle ?? ""}`.trim();
      const word = e.started ? t.started : t.skipped;
      const how = t.trigger[e.trigger] ?? e.trigger;
      const target = e.reviewId ? link(url(`/reviews/${e.reviewId}`), title) : esc(title);
      const text = `${e.started ? ":robot_face:" : ":double_vertical_bar:"} *${word}* · ${target}\n${esc(how)}${e.started ? "" : `: ${esc(e.reason)}`}`;
      return { text: `${word}: ${title}`, blocks: [section(text), context(), ...(e.reviewId ? button(`/reviews/${e.reviewId}`) : [])] };
    }
    case "test": {
      const path = `/test-runs/${e.id}`;
      const word = t.test[e.outcome ?? ""] ?? e.status;
      const icon = e.outcome === "passed" ? ":white_check_mark:" : e.outcome === "failed" ? ":x:" : ":grey_question:";
      const text = `${icon} *${t.testRun} ${link(url(path), e.name)}* ${esc(word)}${e.summary ? `\n${esc(e.summary.slice(0, 300))}` : ""}`;
      return { text: `${t.testRun} ${e.name}: ${word}`, blocks: [section(text), context(), ...button(path)] };
    }
    case "suite": {
      const path = `/repos/${repo}?tab=tests&batch=${encodeURIComponent(e.batchId)}`;
      const icon = e.failed.length ? ":x:" : ":white_check_mark:";
      const line = fill(t.suiteLine, { passed: e.passed, total: e.total });
      const text = `${icon} *${link(url(path), t.suite)}* · ${line}${e.failed.length ? `\n${t.failedTests}: ${e.failed.map(esc).join(", ")}` : ""}`;
      return { text: `${t.suite}: ${line}`, blocks: [section(text), context(), ...button(path)] };
    }
    case "budget": {
      const path = `/repos/${repo}?tab=settings#budget`;
      const word = e.exhausted ? t.budgetStop : fill(t.budgetWarn, { pct: Math.round((e.spent / e.limit) * 100) });
      const line = fill(t.budgetLine, { spent: e.spent.toFixed(2), limit: e.limit.toFixed(2) });
      return { text: `${word} (${repo})`, blocks: [section(`${mention}${e.exhausted ? ":no_entry:" : ":warning:"} *${esc(word)}*\n${line}`), context(), ...button(path)] };
    }
    case "analysis": {
      const path = `/analyses/${e.id}`;
      const ok = e.status === "completed";
      const word = ok ? t.analysisDone : t.analysisFailed;
      const text = `${ok ? ":books:" : ":warning:"} *${link(url(path), word)}*${ok ? ` · ${fill(t.docs, { n: e.docs })}` : e.error ? `\n${esc(e.error.slice(0, 300))}` : ""}`;
      return { text: word, blocks: [section(text), context(), ...button(path)] };
    }
  }
}

/** Posts a message to a Slack incoming webhook. Returns an error text, or null when Slack accepted it. */
export async function postSlack(webhookUrl: string, message: SlackMessage): Promise<string | null> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return null;
    return `Slack answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
  } catch (e) {
    return `Slack not reachable: ${(e as Error).message}`;
  }
}

/** Only Slack's own webhook host: the URL is stored and called by the server. */
export const isSlackWebhookUrl = (url: string): boolean => /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[\w/-]+$/.test(url);

/**
 * Sends an event to the repository's Slack channel if one is set up and the
 * repository wants this kind of event. Never throws: a notification must not
 * break a run.
 */
export async function notify(
  repo: Pick<Repo, "fullName" | "provider" | "slackWebhookEnc" | "notifications">,
  e: NotifyEvent,
  opts: { language: Language; baseUrl: string; log?: (msg: string) => void },
): Promise<void> {
  try {
    const hook = slackWebhookUrl(repo);
    if (!hook) return;
    const settings = { ...DEFAULT_NOTIFICATIONS, ...(repo.notifications ?? {}) };
    if (!wants(settings, e)) return;
    const err = await postSlack(hook, renderSlack(repo.fullName, e, { language: opts.language, baseUrl: opts.baseUrl, mention: settings.mention, provider: repo.provider }));
    if (err) opts.log?.(`slack (${repo.fullName}, ${e.kind}): ${err}`);
  } catch (err) {
    opts.log?.(`slack (${repo.fullName}, ${e.kind}): ${(err as Error).message}`);
  }
}

export function testMessage(repo: string, language: Language): SlackMessage {
  const text = fill(T[language].testMessage, { repo });
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text: `:wave: ${esc(text)}` } }] };
}
