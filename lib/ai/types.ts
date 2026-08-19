export type AIProviderName = "claude" | "openai";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionRequest {
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface AICompletionResult {
  text: string;
  provider: AIProviderName;
  model: string;
}

export interface AIProvider {
  readonly name: AIProviderName;
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
}
