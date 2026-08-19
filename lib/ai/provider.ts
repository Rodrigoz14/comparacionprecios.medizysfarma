import { ClaudeProvider } from "@/lib/ai/claude";
import { OpenAIProvider } from "@/lib/ai/openai";
import type { AIProvider, AIProviderName } from "@/lib/ai/types";

export function getAIProvider(
  name: AIProviderName = (process.env.AI_PROVIDER as AIProviderName | undefined) ?? "claude",
): AIProvider {
  switch (name) {
    case "claude":
      return new ClaudeProvider();
    case "openai":
      return new OpenAIProvider();
    default:
      throw new Error(`Proveedor de IA desconocido: ${name satisfies never}`);
  }
}

export type {
  AICompletionRequest,
  AICompletionResult,
  AIMessage,
  AIProvider,
  AIProviderName,
} from "@/lib/ai/types";
