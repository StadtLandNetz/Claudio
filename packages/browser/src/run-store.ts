import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  AcceptanceCriterionResultSchema,
  EvidenceSchema,
  FindingSchema,
  RecheckSchema,
  TestProposalSchema,
  TodoItemSchema,
  nowIso,
  type AcceptanceCriterionResult,
  type Evidence,
  type Finding,
  type Recheck,
  type TestProposal,
  type TodoItem,
} from "@claudio/core";
import { z } from "zod";

/**
 * File-backed state of one run. Every write goes straight to disk, so a
 * crashed or aborted run still leaves findings, evidence and notes behind.
 */
export class RunStore {
  readonly evidenceDir: string;
  private counters = { finding: 0, evidence: 0, todo: 0 };

  constructor(readonly runDir: string) {
    mkdirSync(runDir, { recursive: true });
    this.evidenceDir = join(runDir, "evidence");
    mkdirSync(this.evidenceDir, { recursive: true });
    this.counters.finding = this.findings().length;
    this.counters.evidence = this.evidence().length;
    this.counters.todo = this.todos().length;
  }

  private file(name: string): string {
    return join(this.runDir, name);
  }

  private readJson<T>(name: string, schema: z.ZodType<T>): T[] {
    const f = this.file(name);
    if (!existsSync(f)) return [];
    const raw = JSON.parse(readFileSync(f, "utf8"));
    return z.array(schema).parse(raw);
  }

  private writeJson(name: string, data: unknown): void {
    writeFileSync(this.file(name), JSON.stringify(data, null, 2));
  }

  findings(): Finding[] {
    return this.readJson("findings.json", FindingSchema);
  }

  addFinding(input: Omit<Finding, "id" | "createdAt">): Finding {
    const finding: Finding = { ...input, id: `F${++this.counters.finding}`, createdAt: nowIso() };
    this.writeJson("findings.json", [...this.findings(), finding]);
    return finding;
  }

  evidence(): Evidence[] {
    return this.readJson("evidence.json", EvidenceSchema);
  }

  nextEvidenceId(): string {
    return `E${++this.counters.evidence}`;
  }

  addEvidence(input: Omit<Evidence, "createdAt">): Evidence {
    const ev: Evidence = { ...input, createdAt: nowIso() };
    this.writeJson("evidence.json", [...this.evidence(), ev]);
    return ev;
  }

  acResults(): AcceptanceCriterionResult[] {
    return this.readJson("acceptance.json", AcceptanceCriterionResultSchema);
  }

  recordAcResult(input: Omit<AcceptanceCriterionResult, "createdAt">): AcceptanceCriterionResult {
    const existing = this.acResults().filter((a) => a.criterion !== input.criterion);
    const result: AcceptanceCriterionResult = { ...input, createdAt: nowIso() };
    this.writeJson("acceptance.json", [...existing, result]);
    return result;
  }

  /** Re-review: what became of the earlier review's findings (one entry per finding, the latest wins). */
  rechecks(): Recheck[] {
    return this.readJson("rechecks.json", RecheckSchema);
  }

  recordRecheck(input: Recheck): Recheck {
    const rest = this.rechecks().filter((r) => r.findingId !== input.findingId);
    this.writeJson("rechecks.json", [...rest, input]);
    return input;
  }

  /** Removes a finding again (a re-checked finding that turned out fixed after all). */
  removeFinding(id: string): void {
    this.writeJson("findings.json", this.findings().filter((f) => f.id !== id));
  }

  /** Analysis only: tests proposed for the core flows. */
  testProposals(): TestProposal[] {
    return this.readJson("test-proposals.json", TestProposalSchema);
  }

  addTestProposal(input: Omit<TestProposal, "id" | "createdAt">): TestProposal {
    const existing = this.testProposals();
    const proposal: TestProposal = { ...input, id: `P${existing.length + 1}`, createdAt: nowIso() };
    this.writeJson("test-proposals.json", [...existing, proposal]);
    return proposal;
  }

  addNote(text: string): void {
    appendFileSync(this.file("notes.md"), `- ${nowIso()} ${text.trim().replace(/\n/g, "\n  ")}\n`);
  }

  notes(): string {
    const f = this.file("notes.md");
    return existsSync(f) ? readFileSync(f, "utf8") : "";
  }

  todos(): TodoItem[] {
    return this.readJson("todo.json", TodoItemSchema);
  }

  todoAdd(items: string[]): TodoItem[] {
    const added = items.map((text) => ({ id: ++this.counters.todo, text, status: "open" as const }));
    this.writeJson("todo.json", [...this.todos(), ...added]);
    return added;
  }

  todoNext(): TodoItem | undefined {
    return this.todos().find((t) => t.status === "open");
  }

  todoDone(id: number, result: string, status: "done" | "skipped" = "done"): TodoItem | undefined {
    const all = this.todos();
    const item = all.find((t) => t.id === id);
    if (!item) return undefined;
    item.status = status;
    item.result = result;
    this.writeJson("todo.json", all);
    return item;
  }

  /** Arbitrary JSON side files (pr-context.json, cost.json, ...). */
  writeFile(name: string, content: string | object): void {
    writeFileSync(this.file(name), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
}
