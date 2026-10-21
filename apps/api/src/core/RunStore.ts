import { randomUUID } from "node:crypto";
import type { EventType, Run, RunEvent, RunStatus } from "./types.js";

/** Estado en memoria: se pierde al reiniciar el servidor (documentado). */
export class RunStore {
  private runs = new Map<string, Run>();

  create(emailId: string): Run {
    const run: Run = {
      id: randomUUID(),
      emailId,
      status: "PROCESSING",
      tokens: { input: 0, output: 0 },
      events: [],
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

  finish(run: Run, status: RunStatus, summary?: string): void {
    run.status = status;
    if (summary !== undefined) run.summary = summary;
  }
}
