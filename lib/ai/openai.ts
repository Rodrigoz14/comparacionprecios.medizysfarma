import OpenAI from "openai";
import type {
  AICompletionRequest,
  AICompletionResult,
  AIProvider,
} from "@/lib/ai/types";

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  private client: OpenAI | undefined;

  private getClient(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY no está configurada.");
    }
    this.client ??= new OpenAI({ apiKey });
    return this.client;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const client = this.getClient();
    const model = process.env.OPENAI_MODEL;
    if (!model) {
      throw new Error("OPENAI_MODEL no está configurada.");
    }

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const text = response.choices[0]?.message?.content ?? "";

    return { text, provider: this.name, model };
  }
}
