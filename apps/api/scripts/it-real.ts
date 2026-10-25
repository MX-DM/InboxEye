// Integración REAL con Claude: consume crédito. Solo corre con RUN_REAL_LLM=1.
import "dotenv/config";
import { companyConfig } from "../src/company/config.js";
import { createGuardedAgent } from "../src/core/AgentRunner.js";
import { StubInspector } from "../src/core/inspector.js";
import { AnthropicClient } from "../src/core/llm.js";
import { RunStore } from "../src/core/RunStore.js";

if (process.env.RUN_REAL_LLM !== "1") {
  console.error("Abortado: definí RUN_REAL_LLM=1 para permitir la llamada real.");
  process.exit(1);
}
const model = process.env.ANTHROPIC_MODEL;
if (!model || !process.env.ANTHROPIC_API_KEY) {
  console.error("Faltan ANTHROPIC_MODEL / ANTHROPIC_API_KEY en el entorno.");
  process.exit(1);
}

const store = new RunStore();
const agent = createGuardedAgent({
  config: companyConfig,
  llm: new AnthropicClient(model, process.env.ANTHROPIC_API_KEY),
  inspector: new StubInspector(),
  store,
});

const { run, done } = agent.start(process.argv[2] ?? "email-001");
await done;
console.log(JSON.stringify({ status: run.status, agentReport: run.agentReport, failureReason: run.failureReason, tokens: run.tokens }, null, 2));
for (const e of run.events) console.log(e.eventType, e.tool ?? "", e.decision ?? "", e.reason ?? "", JSON.stringify(e.detail ?? {}));
