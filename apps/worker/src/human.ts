import { applyHumanInput, type HumanBridgeFactory } from "@claudio/browser";
import { closeHumanRequest, createHumanRequest, getHumanRequest, humanInputsSince, type Db, type RunKind } from "@claudio/db";

const TIMEOUT_MS = Number(process.env.CLAUDIO_HUMAN_TIMEOUT_MIN ?? 15) * 60_000;

/** Prefixes the web UI watches for in the live log to switch the live view into takeover mode. */
export const HUMAN_NEEDED = "Mensch gebraucht:";
export const HUMAN_DONE = "Mensch fertig:";

/**
 * Lets a person take over the run's browser: records the request, replays the
 * clicks and keystrokes sent from the web UI, and returns when they continue,
 * cancel, or do not respond in time.
 */
export function humanBridge(db: Db, run: { kind: RunKind; id: number; repoId: number }, emit: (line: string) => void, abort: AbortSignal): HumanBridgeFactory {
  return (attachment) => ({
    async wait(reason) {
      const requestId = await createHumanRequest(db, { runKind: run.kind, runRefId: run.id, repoId: run.repoId, reason });
      emit(`${HUMAN_NEEDED} ${reason}`);
      const deadline = Date.now() + TIMEOUT_MS;
      let lastInput = 0;
      for (;;) {
        if (abort.aborted) {
          await closeHumanRequest(db, requestId, "cancelled", null);
          emit(`${HUMAN_DONE} Run abgebrochen.`);
          return "cancelled";
        }
        for (const i of await humanInputsSince(db, requestId, lastInput)) {
          lastInput = i.id;
          const page = attachment.activePage();
          if (page) await applyHumanInput(page, i.input).catch(() => undefined);
        }
        const req = await getHumanRequest(db, requestId);
        if (req && req.status !== "open") {
          emit(`${HUMAN_DONE} ${req.status === "resolved" ? "Claudio macht weiter." : "Abgebrochen."}`);
          return req.status === "resolved" ? "resolved" : "cancelled";
        }
        if (Date.now() > deadline) {
          await closeHumanRequest(db, requestId, "timeout", null);
          emit(`${HUMAN_DONE} Keine Reaktion innerhalb von ${Math.round(TIMEOUT_MS / 60_000)} Minuten.`);
          return "timeout";
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    },
  });
}
