import { randomUUID } from "node:crypto";
import type { EventType, Run, RunEvent, RunMode, RunStatus } from "./types.js";

/** Estado en memoria: se pierde al reiniciar el servidor (documentado). */
export class RunStore {
  private runs = new Map<string, Run>();

  create(emailId: string, mode: RunMode = "PROTECTED"): Run {
    const run: Run = {
      id: randomUUID(),
      emailId,
      mode,
      status: "PROCESSING",
      agentReport: null,
      tokens: { input: 0, output: 0 },
      events: [],
      effects: { tags: [], reviews: [] },
    };
    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  list(): Run[] {
    return [...this.runs.values()];
  }

  append(run: Run, eventType: EventType, extra: Partial<RunEvent> = {}): void {
    run.events.push({
      runId: run.id,
      emailId: run.emailId,
      ts: new Date().toISOString(),
      eventType,
      ...extra,
    });
  }

  finish(run: Run, status: RunStatus, failureReason?: string): void {
    run.status = status;
    if (failureReason !== undefined) run.failureReason = failureReason;
  }
}
