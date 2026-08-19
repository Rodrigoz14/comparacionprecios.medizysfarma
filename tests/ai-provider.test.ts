import { describe, expect, it } from "vitest";
import { getAIProvider } from "@/lib/ai/provider";

describe("getAIProvider", () => {
  it("returns the Claude provider by default", () => {
    const provider = getAIProvider();
    expect(provider.name).toBe("claude");
  });

  it("returns the OpenAI provider when requested explicitly", () => {
    const provider = getAIProvider("openai");
    expect(provider.name).toBe("openai");
  });

  it("rejects a completion request when no API key is configured", async () => {
    delete process.env.CLAUDE_API_KEY;
    const provider = getAIProvider("claude");

    await expect(
      provider.complete({ messages: [{ role: "user", content: "hola" }] }),
    ).rejects.toThrow("CLAUDE_API_KEY no está configurada.");
  });
});
