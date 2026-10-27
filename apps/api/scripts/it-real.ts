// Integración REAL con Claude: consume crédito. Solo corre con RUN_REAL_LLM=1.
// Uso: RUN_REAL_LLM=1 npm run it:real -w @inboxeye/api -- email-id [email-id ...]   (máx. 12 por invocación)
import "dotenv/config";
import { companyConfig, GUARD_MISSION } from "../src/company/config.js";
import { createGuardedAgent } from "../src/core/AgentRunner.js";
import { InputGuard } from "../src/core/inputGuard.js";
import { AnthropicClient } from "../src/core/llm.js";
import { RunStore } from "../src/core/RunStore.js";
import { toProcessingResult } from "../src/core/result.js";

if (process.env.RUN_REAL_LLM !== "1") {
  console.error("Abortado: definí RUN_REAL_LLM=1 para permitir la llamada real.");
  process.exit(1);
}
const model = process.env.ANTHROPIC_MODEL;
if (!model || !process.env.ANTHROPIC_API_KEY) {
  console.error("Faltan ANTHROPIC_MODEL / ANTHROPIC_API_KEY en el entorno.");
  process.exit(1);
}
const ids = process.argv.slice(2);
if (ids.length === 0 || ids.length > 12) {
  console.error("Indicá entre 1 y 12 emailId.");
  process.exit(1);
}
const guardModel = process.env.ANTHROPIC_GUARD_MODEL ?? model;

const store = new RunStore();
const agent = createGuardedAgent({
  config: companyConfig,
  llm: new AnthropicClient(model, process.env.ANTHROPIC_API_KEY),
  inspector: new InputGuard(new AnthropicClient(guardModel, process.env.ANTHROPIC_API_KEY), GUARD_MISSION),
  store,
});

const total = { input: 0, output: 0 };
for (const id of ids) {
  const { run, done } = agent.start(id);
  await done;
  total.input += run.tokens.input;
  total.output += run.tokens.output;
  const r = toProcessingResult(run);
  const tools = run.events.filter((e) => e.eventType === "TOOL_PROPOSED").map((e) => e.tool);
  console.log(`\n=== ${id} ===`);
  console.log(
    JSON.stringify(
      {
        status: r.status,
        risk: r.security.risk,
        reason: r.security.reason,
        signals: r.security.signals,
        deniedActions: r.security.deniedActions,
        tools,
        agentReport: r.agentReport,
        reportChecks: run.events.filter((e) => e.eventType === "REPORT_CHECK").map((e) => e.reason),
        failureReason: run.failureReason,
        tokens: run.tokens,
      },
      null,
      2,
    ),
  );
}
console.log(`\nTOTAL tokens: ${total.input} entrada / ${total.output} salida en ${ids.length} corridas`);
