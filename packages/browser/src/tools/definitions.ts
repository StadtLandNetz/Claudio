import { join, relative, isAbsolute } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  AcStatusSchema,
  FindingCategorySchema,
  KNOWLEDGE_DOCS,
  KnowledgeDocNameSchema,
  SeveritySchema,
  resolveCredentials,
  type DriverName,
  type Finding,
  type RoleConfig,
} from "@claudio/core";
import type { BrowserAttachment } from "../driver.js";
import { detectCaptcha, type HumanBridge } from "../human.js";
import { loginWithRole } from "../login.js";
import type { RunStore } from "../run-store.js";

export type ToolContext = {
  runDir: string;
  store: RunStore;
  attachment: BrowserAttachment | null;
  instanceUrl: string;
  roles: Record<string, RoleConfig>;
  driver: DriverName;
  env?: NodeJS.ProcessEnv;
  /** Repository analysis only: directory the knowledge documents are written to. Enables write_knowledge. */
  knowledgeDir?: string;
  /** A person who can take over the browser for a moment (CAPTCHA, bot check). Enables request_human_help. */
  human?: HumanBridge;
  /** Stores a learning about operating the app for later runs on this repository. Enables remember_learning. */
  onLearning?: (text: string) => void;
  /** Re-review: the open findings of the earlier review. Enables recheck_finding. */
  followUp?: { reviewId: number; findings: Finding[] };
  /** The viewports this run checks. With more than one, set_viewport switches between them. */
  viewports?: ("desktop" | "mobile")[];
};

/** A tool definition that both the Agent SDK adapter and the stdio MCP server can consume. */
export type ClaudioTool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  schema: S;
  readOnly?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<string>;
};

export function def<S extends z.ZodRawShape>(t: ClaudioTool<S>): ClaudioTool<S> {
  return t;
}

export function createClaudioTools(ctx: ToolContext): ClaudioTool<any>[] {
  const { store } = ctx;
  const roleNames = Object.keys(ctx.roles);

  const loginAs = def({
    name: "login_as",
    description: `Log the browser in as one of the configured application roles (${roleNames.join(", ") || "none configured"}). Credentials stay on the host; you only get the result. Call this before testing anything that needs authentication, and again to switch roles.`,
    schema: { role: z.string().describe("Role name as configured for this repository") },
    handler: async ({ role }) => {
      const cfg = ctx.roles[role];
      if (!cfg) return `Unknown role "${role}". Available roles: ${roleNames.join(", ") || "none"}.`;
      if (!ctx.instanceUrl) return "No instance URL configured (CLAUDIO_INSTANCE_URL). Ask the person for the URL of the app under test.";
      if (ctx.driver === "chrome" || !ctx.attachment) {
        return `Live mode: ask the person watching to log in as "${role}"${cfg.description ? ` (${cfg.description})` : ""} in the browser window, then continue.`;
      }
      const creds = resolveCredentials(cfg, ctx.env ?? process.env);
      if (!creds) return `Credentials for role "${role}" are missing (env vars ${cfg.usernameEnv} / ${cfg.passwordEnv}). Report this as blocked and continue with what you can test without login.`;
      await ctx.attachment.context.clearCookies().catch(() => undefined);
      const result = await loginWithRole(ctx.attachment.context, ctx.instanceUrl, cfg, creds);
      if (!result.ok) {
        store.addNote(`login_as(${role}) failed: ${result.error}`);
        return `Login as "${role}" failed: ${result.error}${result.finalUrl ? ` (at ${result.finalUrl})` : ""}. You may inspect the login page yourself, but do not type credentials.`;
      }
      store.addNote(`login_as(${role}) ok → ${result.finalUrl}`);
      return `Logged in as "${role}"${cfg.description ? ` (${cfg.description})` : ""}. Current URL: ${result.finalUrl}. Take a fresh snapshot before continuing.`;
    },
  });

  const captureEvidence = def({
    name: "capture_evidence",
    description:
      "Record evidence for something you observed: takes a screenshot of the current page (Playwright driver) or registers a screenshot you already saved (pass `path`). Returns an evidence id to reference in findings and acceptance results.",
    schema: {
      label: z.string().describe("Short label, e.g. 'Fahrt anlegen: Validierungsfehler'"),
      note: z.string().optional().describe("What the evidence shows"),
      path: z.string().optional().describe("Path of an existing screenshot file (live mode); omit to capture now"),
    },
    handler: async ({ label, note, path }) => {
      const id = store.nextEvidenceId();
      const safe = label.replace(/[^\w.-]+/g, "_").slice(0, 60);
      if (path) {
        const abs = isAbsolute(path) ? path : join(ctx.runDir, path);
        if (!existsSync(abs)) return `File not found: ${abs}. Save the screenshot first, then register it.`;
        store.addEvidence({ id, kind: "screenshot", label, path: relative(ctx.runDir, abs), note, pageUrl: undefined });
        return `Evidence ${id} registered (${relative(ctx.runDir, abs)}).`;
      }
      const page = ctx.attachment?.activePage();
      if (!page) {
        store.addEvidence({ id, kind: "note", label, note });
        return `Evidence ${id} recorded as a note (no browser attachment available for a screenshot).`;
      }
      const file = join(store.evidenceDir, `${id}-${safe}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const viewport = ctx.attachment?.viewport?.current();
      store.addEvidence({ id, kind: "screenshot", label, path: relative(ctx.runDir, file), note, pageUrl: page.url(), ...(viewport === "mobile" ? { viewport } : {}) });
      return `Evidence ${id} captured: ${relative(ctx.runDir, file)} (${page.url()}).`;
    },
  });

  const getConsole = def({
    name: "get_console",
    description: "Return browser console messages and uncaught page errors captured since the run started (Playwright driver). Use after each flow to check for JavaScript errors.",
    readOnly: true,
    schema: {
      level: z.enum(["error", "warning", "all"]).default("error"),
      contains: z.string().optional().describe("Only messages containing this text"),
      sinceSeq: z.number().int().optional().describe("Only entries after this sequence number (from a previous call)"),
      limit: z.number().int().min(1).max(200).default(50),
    },
    handler: async (args) => {
      if (!ctx.attachment) return "Console capture is not available in this driver mode. Use the browser's own console tool instead.";
      const entries = ctx.attachment.capture.queryConsole(args);
      if (entries.length === 0) return `No console entries (level=${args.level}). Last seq: ${ctx.attachment.capture.lastSeq}.`;
      return [
        `${entries.length} entries (level=${args.level}, last seq ${ctx.attachment.capture.lastSeq}):`,
        ...entries.map((e) => `#${e.seq} [${e.level}] ${e.text}${e.location ? ` (${e.location})` : ""} @ ${e.pageUrl}`),
      ].join("\n");
    },
  });

  const getNetwork = def({
    name: "get_network",
    description:
      "Return network requests captured since the run started (Playwright driver): method, URL, status, timing, and truncated bodies for API calls. Use it to verify that the right requests were sent and to spot 4xx/5xx responses.",
    readOnly: true,
    schema: {
      urlContains: z.string().optional().describe("Only requests whose URL contains this text"),
      onlyErrors: z.boolean().default(false).describe("Only failed requests and HTTP status >= 400"),
      onlyApi: z.boolean().default(true).describe("Only document/XHR/fetch requests (skip assets)"),
      sinceSeq: z.number().int().optional(),
      limit: z.number().int().min(1).max(200).default(40),
      includeBodies: z.boolean().default(false),
    },
    handler: async (args) => {
      if (!ctx.attachment) return "Network capture is not available in this driver mode. Use the browser's own network tool instead.";
      const entries = ctx.attachment.capture.queryNetwork(args);
      if (entries.length === 0) return `No matching requests. Last seq: ${ctx.attachment.capture.lastSeq}.`;
      return [
        `${entries.length} requests (last seq ${ctx.attachment.capture.lastSeq}):`,
        ...entries.map((e) => {
          const status = e.failed ? `FAILED ${e.failed}` : (e.status ?? "pending");
          let line = `#${e.seq} ${e.method} ${e.url} → ${status}${e.durationMs !== undefined ? ` ${e.durationMs}ms` : ""} [${e.resourceType}]`;
          if (args.includeBodies) {
            if (e.requestBody) line += `\n    request: ${e.requestBody}`;
            if (e.responseBody) line += `\n    response: ${e.responseBody}`;
          }
          return line;
        }),
      ].join("\n");
    },
  });

  const reportFinding = def({
    name: "report_finding",
    description:
      "Record a finding (bug, regression, UX/UI issue, console or network error, suggestion). Every finding you intend to mention in the report must go through this tool so it is stored with severity, steps and evidence.",
    schema: {
      category: FindingCategorySchema,
      severity: SeveritySchema.describe("blocker: feature unusable or data loss; major: AC not met or clear bug; minor: wrong but workable; suggestion: improvement"),
      title: z.string().max(140),
      description: z.string(),
      steps: z.array(z.string()).default([]).describe("Steps to reproduce"),
      expected: z.string().optional(),
      actual: z.string().optional(),
      url: z.string().optional(),
      acceptanceCriterion: z.string().optional().describe("The AC this finding relates to, if any"),
      evidenceIds: z.array(z.string()).default([]),
    },
    handler: async (args) => {
      const f = store.addFinding(args);
      return `Finding ${f.id} recorded ([${f.severity}] ${f.title}).`;
    },
  });

  const recordAc = def({
    name: "record_ac_result",
    description: "Record the verification result for one acceptance criterion. Call it once per criterion; a later call for the same criterion replaces the earlier one.",
    schema: {
      criterion: z.string().describe("The criterion text, verbatim or lightly shortened"),
      status: AcStatusSchema,
      notes: z.string().default("").describe("How you verified it and what you saw"),
      evidenceIds: z.array(z.string()).default([]),
    },
    handler: async (args) => {
      store.recordAcResult(args);
      return `Recorded: "${args.criterion}" → ${args.status}.`;
    },
  });

  const note = def({
    name: "note",
    description: "Write a working note into the run log (observations, data you created, assumptions). Notes are kept with the report.",
    schema: { text: z.string() },
    handler: async ({ text }) => {
      store.addNote(text);
      return "Noted.";
    },
  });

  const todoAdd = def({
    name: "todo_add",
    description: "Add items to the run's todo list (things to test). Build the list first, then work through it with todo_next / todo_done.",
    schema: { items: z.array(z.string()).min(1) },
    handler: async ({ items }) => {
      const added = store.todoAdd(items);
      return `Added ${added.length} items: ${added.map((t) => `#${t.id} ${t.text}`).join("; ")}`;
    },
  });

  const todoNext = def({
    name: "todo_next",
    description: "Return the next open todo item, or a summary when the list is done.",
    readOnly: true,
    schema: {},
    handler: async () => {
      const next = store.todoNext();
      if (next) return `#${next.id} ${next.text}`;
      const all = store.todos();
      return `No open items. ${all.filter((t) => t.status === "done").length} done, ${all.filter((t) => t.status === "skipped").length} skipped.`;
    },
  });

  const todoDone = def({
    name: "todo_done",
    description: "Mark a todo item as done or skipped with a one-line result.",
    schema: {
      id: z.number().int(),
      result: z.string(),
      status: z.enum(["done", "skipped"]).default("done"),
    },
    handler: async ({ id, result, status }) => {
      const item = store.todoDone(id, result, status);
      if (!item) return `No todo item #${id}.`;
      const next = store.todoNext();
      return `#${id} ${status}. ${next ? `Next: #${next.id} ${next.text}` : "List complete."}`;
    },
  });

  const tools: ClaudioTool<any>[] = [loginAs, captureEvidence, getConsole, getNetwork, reportFinding, recordAc, note, todoAdd, todoNext, todoDone];
  if (ctx.knowledgeDir) tools.push(writeKnowledgeTool(ctx.knowledgeDir));
  if (ctx.human) tools.push(humanHelpTool(ctx.human, ctx.attachment));
  if (ctx.human?.ask) tools.push(askHumanTool(ctx.human, store));
  if (ctx.onLearning) tools.push(rememberLearningTool(ctx.onLearning));
  if (ctx.followUp?.findings.length) tools.push(recheckFindingTool(store, ctx.followUp));
  if (ctx.attachment?.viewport && (ctx.viewports?.length ?? 0) > 1) tools.push(setViewportTool(ctx));
  return tools;
}

/** Switches the browser between desktop and phone emulation (reviews that check both). */
export function setViewportTool(ctx: ToolContext): ClaudioTool<any> {
  return def({
    name: "set_viewport",
    description:
      "Switch the browser between the desktop viewport (1280×800) and a phone (390×844, touch, mobile user agent). Reload the page after switching, then take a fresh snapshot. Mention the viewport in findings that only occur on one of them.",
    schema: { viewport: z.enum(["desktop", "mobile"]) },
    handler: async ({ viewport }) => {
      const emulation = ctx.attachment?.viewport;
      if (!emulation) return "This browser cannot switch viewports.";
      await emulation.set(viewport);
      ctx.store.addNote(`viewport: ${viewport}`);
      return `Viewport is now ${viewport}. Reload the page (browser_navigate to the current URL) and snapshot again.`;
    },
  });
}

/**
 * Re-review: the verdict on one finding of the earlier review. A finding that is
 * still open is recorded again in this run (so it counts for the verdict), with a
 * link to the earlier one.
 */
export function recheckFindingTool(store: RunStore, followUp: { reviewId: number; findings: Finding[] }): ClaudioTool<any> {
  const byId = new Map(followUp.findings.map((f) => [f.id, f]));
  // findingId of the earlier review → id of the finding recorded again in this run
  const carried = new Map<string, string>();
  return def({
    name: "recheck_finding",
    description: `Record what became of one finding of review #${followUp.reviewId}: "fixed" when the problem no longer occurs, "still_open" when it still does. Reproduce it first (follow its steps) and capture evidence of the current state. Call it once per earlier finding; a later call replaces the earlier verdict. Findings you do not re-check are carried over as still open.`,
    schema: {
      findingId: z.string().describe("Id of the earlier finding, e.g. F3"),
      status: z.enum(["fixed", "still_open"]),
      notes: z.string().default("").describe("What you did and what you saw now"),
      actual: z.string().optional().describe("still_open: the behaviour observed now, if it changed"),
      evidenceIds: z.array(z.string()).default([]),
    },
    handler: async ({ findingId, status, notes, actual, evidenceIds }) => {
      const prev = byId.get(findingId);
      if (!prev) return `Review #${followUp.reviewId} has no open finding ${findingId}. Open findings: ${[...byId.keys()].join(", ")}.`;
      const old = carried.get(findingId);
      if (old) {
        store.removeFinding(old);
        carried.delete(findingId);
      }
      store.recordRecheck({ findingId, title: prev.title, severity: prev.severity, status, notes, evidenceIds });
      if (status === "fixed") return `${findingId} recorded as fixed.`;
      const { id: _id, createdAt: _at, previous: _p, ...rest } = prev;
      const again = store.addFinding({
        ...rest,
        actual: actual ?? prev.actual,
        evidenceIds: evidenceIds.length ? evidenceIds : [],
        previous: { reviewId: followUp.reviewId, findingId, status: "still_open" },
      });
      carried.set(findingId, again.id);
      return `${findingId} is still open; recorded again as ${again.id}.`;
    },
  });
}

/** At most this many learnings per run, so one confused run cannot flood the prompt of later ones. */
const MAX_LEARNINGS_PER_RUN = 5;

/** Lets the agent pass on what it found out about operating the app to later runs. */
export function rememberLearningTool(onLearning: (text: string) => void): ClaudioTool<any> {
  let count = 0;
  return def({
    name: "remember_learning",
    description:
      "Save one lesson about operating this application for future runs on this repository, e.g. which target works for a field without a label, a banner or dialog that must be dismissed first, a page that needs extra waiting, a login quirk, or a constraint on test data. Write it as a concrete, reusable instruction (one or two sentences, name the screen). Use it after you overcame an obstacle that cost you attempts. Not for bugs (report_finding) or for this run only (note).",
    schema: { text: z.string().min(10).max(400) },
    handler: async ({ text }) => {
      if (count >= MAX_LEARNINGS_PER_RUN) return `Limit of ${MAX_LEARNINGS_PER_RUN} learnings per run reached; not saved.`;
      count++;
      onLearning(text);
      return "Saved. Later runs on this repository will see it.";
    },
  });
}

/**
 * Pauses the run until a person has dealt with something only a person may
 * handle: a CAPTCHA or bot check. The agent never solves those itself.
 */
/** At most this many questions per run: a run that keeps asking should rather record what is unclear. */
const MAX_QUESTIONS = 3;

/**
 * Lets the agent ask a person when the ticket leaves something open that changes
 * the result (what a criterion means, which data to use, whether a behaviour is
 * intended), instead of guessing or recording "not testable".
 */
export function askHumanTool(human: HumanBridge, store: RunStore): ClaudioTool<any> {
  let asked = 0;
  return def({
    name: "ask_human",
    description: `Ask a person a short question and wait for the answer (they get it in the web UI and in Slack). Use it when the ticket, the PR and the knowledge base leave open something that decides the result: what an acceptance criterion means, which data or role to use, whether a behaviour is intended. Do not ask what you can find out yourself, and not about CAPTCHAs (request_human_help). Offer two to four likely answers in options. At most ${MAX_QUESTIONS} questions per run.`,
    schema: {
      question: z.string().max(400).describe("One question, answerable in a sentence, in the report language"),
      context: z.string().max(1200).optional().describe("What you found so far and why it matters for the result"),
      options: z.array(z.string().max(160)).max(4).optional().describe("Likely answers the person can pick"),
    },
    handler: async ({ question, context, options }) => {
      if (!human.ask) return "Asking is not available in this run. Decide yourself and record your assumption with note.";
      if (asked >= MAX_QUESTIONS) return `You already asked ${MAX_QUESTIONS} questions. Decide yourself and record your assumption with note.`;
      asked++;
      const { outcome, answer } = await human.ask(question, { context, options });
      store.addNote(`Frage an einen Menschen: ${question} → ${answer ? `Antwort: ${answer}` : outcome === "timeout" ? "keine Antwort (Zeit abgelaufen)" : "nicht beantwortet"}`);
      if (answer) return `Answer from a person: ${answer}\nFollow it, and mention in the notes of the affected criterion that it is based on this answer.`;
      return outcome === "timeout"
        ? "Nobody answered in time. Decide yourself with the most plausible reading, say so in the criterion's notes, and continue."
        : "The person did not answer the question. Decide yourself with the most plausible reading, say so in the criterion's notes, and continue.";
    },
  });
}

export function humanHelpTool(human: HumanBridge, attachment: BrowserAttachment | null): ClaudioTool<any> {
  return def({
    name: "request_human_help",
    description:
      "Pause and ask a person to take over the browser, for a CAPTCHA, a bot check or a similar challenge meant for humans. Never try to solve such a challenge yourself. Blocks until the person is done (or gives up), then take a fresh snapshot and continue.",
    schema: { reason: z.string().describe("What the person should do, e.g. 'reCAPTCHA auf der Login-Seite lösen'") },
    handler: async ({ reason }) => {
      const outcome = await human.wait(reason);
      if (outcome !== "resolved") {
        return outcome === "timeout"
          ? "Nobody responded in time. Record what is blocked (not_testable / note) and continue with what you can test without it, or finish."
          : "The person cancelled. Record the blocked part and finish what you can.";
      }
      const still = await detectCaptcha(attachment?.activePage());
      return still
        ? `The person is done, but the page still shows a challenge (${still}). Take a snapshot; if it is still there, record it as blocked.`
        : "The person is done. Take a fresh snapshot and continue where you left off.";
    },
  });
}

/** Writes one document of the repository knowledge base (Markdown). */
export function writeKnowledgeTool(dir: string): ClaudioTool<any> {
  const docList = Object.entries(KNOWLEDGE_DOCS)
    .map(([name, d]) => `- ${name}: ${d.purpose}`)
    .join("\n");
  return def({
    name: "write_knowledge",
    description: `Write a document of the repository knowledge base (Markdown). mode "replace" overwrites the document, "append" adds a section at the end (use it to add one screen at a time to app-map). Documents:\n${docList}`,
    schema: {
      doc: KnowledgeDocNameSchema,
      content: z.string().min(1).max(200_000),
      mode: z.enum(["replace", "append"]).default("replace"),
    },
    handler: async ({ doc, content, mode }) => {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, KNOWLEDGE_DOCS[doc as keyof typeof KNOWLEDGE_DOCS].file);
      const text = content.trim() + "\n";
      if (mode === "append" && existsSync(file)) appendFileSync(file, "\n" + text);
      else writeFileSync(file, text);
      const size = readFileSync(file, "utf8").length;
      return `${doc} ${mode === "append" ? "extended" : "written"} (${size} characters).`;
    },
  });
}
