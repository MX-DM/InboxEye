import "dotenv/config";
import { companyConfig, GUARD_MISSION } from "./company/config.js";
import { createGuardedAgent } from "./core/AgentRunner.js";
import { InputGuard } from "./core/inputGuard.js";
import { AnthropicClient } from "./core/llm.js";
import { RunStore } from "./core/RunStore.js";
import { createApp } from "./http/routes.js";

const model = process.env.ANTHROPIC_MODEL;
if (!model) throw new Error("ANTHROPIC_MODEL no configurado (ver .env.example)");
// El clasificador usa un cliente aparte; por defecto el mismo modelo que el agente.
const guardModel = process.env.ANTHROPIC_GUARD_MODEL ?? model;

const store = new RunStore();
const agent = createGuardedAgent({
  config: companyConfig,
  llm: new AnthropicClient(model, process.env.ANTHROPIC_API_KEY),
  inspector: new InputGuard(new AnthropicClient(guardModel, process.env.ANTHROPIC_API_KEY), GUARD_MISSION),
  store,
});

const port = Number(process.env.PORT ?? 3001);
// Solo loopback: la consola corre en la misma máquina.
createApp(agent, store).listen(port, "127.0.0.1", () => {
  console.log(`InboxEye API en http://127.0.0.1:${port}`);
});
