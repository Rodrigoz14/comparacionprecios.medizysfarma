import Anthropic from "@anthropic-ai/sdk";
import type {
  AICompletionRequest,
  AICompletionResult,
  AIProvider,
} from "@/lib/ai/types";

const DEFAULT_MODEL = "claude-sonnet-5";

export class ClaudeProvider implements AIProvider {
  readonly name = "claude" as const;
  private client: Anthropic | undefined;

  private getClient(): Anthropic {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error("CLAUDE_API_KEY no está configurada.");
    }
    this.client ??= new Anthropic({ apiKey });
    return this.client;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const client = this.getClient();
    const model = process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;
    const systemMessage = request.messages.find((m) => m.role === "system")?.content;

    const response = await client.messages.create({
      model,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature,
      system: systemMessage,
      messages: request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return { text, provider: this.name, model };
  }
}
