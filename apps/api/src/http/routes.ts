import express from "express";
import { z } from "zod";
import { EMAILS, findEmail } from "../company/emails.js";
import type { createGuardedAgent } from "../core/AgentRunner.js";
import type { RunStore } from "../core/RunStore.js";
import { toProcessingResult } from "../core/result.js";

const StartRunBody = z.object({ emailId: z.string().regex(/^[a-z0-9-]{1,40}$/) });

export function createApp(agent: ReturnType<typeof createGuardedAgent>, store: RunStore) {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  app.post("/runs", (req, res) => {
    const body = StartRunBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "invalid emailId" });
    if (!findEmail(body.data.emailId)) return res.status(404).json({ error: "email not found" });
    const { run } = agent.start(body.data.emailId);
    res.status(202).json({ runId: run.id });
  });

  // Sin cuerpo: el contenido del correo solo llega al agente vía readEmail (y pasa por el Input Guard).
  app.get("/emails", (_req, res) => {
    res.json(EMAILS.map(({ id, from, subject }) => ({ id, from, subject })));
  });

  // Solo para la consola del operador (humano). El agente sigue recibiendo el cuerpo únicamente vía readEmail.
  app.get("/emails/:id", (req, res) => {
    const email = findEmail(req.params.id);
    if (!email) return res.status(404).json({ error: "email not found" });
    res.json({ id: email.id, from: email.from, subject: email.subject, body: email.textBody });
  });

  app.get("/runs", (_req, res) => {
    res.json(store.list().map(toProcessingResult));
  });

  app.get("/runs/:id", (req, res) => {
    const run = store.get(req.params.id);
    if (!run) return res.status(404).json({ error: "run not found" });
    res.json(toProcessingResult(run));
  });

  return app;
}
