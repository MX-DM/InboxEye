import Anthropic from "@anthropic-ai/sdk";

export interface LLMRequest {
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens: number;
}

export interface LLMResponse {
  content: Anthropic.ContentBlock[];
  stopReason: Anthropic.Message["stop_reason"];
  usage: { input: number; output: number };
}

/** Única interfaz hacia el modelo: la usan el agente y, luego, el analyzer. Permite mockear en tests. */
export interface LLMClient {
  /** Identificador del modelo, para auditar que las corridas comparadas usan el mismo. */
  readonly model?: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
}

export class AnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor(readonly model: string, apiKey?: string) {
    // La clave se lee del entorno del backend; nunca se registra.
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      ...(req.tools?.length
        ? {
            tools: req.tools,
            // Una herramienta por turno: evita llamadas concurrentes con resultados parciales.
            tool_choice: { type: "auto" as const, disable_parallel_tool_use: true },
          }
        : {}),
    });
    return {
      content: res.content,
      stopReason: res.stop_reason,
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
    };
  }
}
