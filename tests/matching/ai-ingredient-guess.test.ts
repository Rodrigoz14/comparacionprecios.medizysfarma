import { afterEach, describe, expect, it, vi } from "vitest";

// Se simula el proveedor de IA (nunca una llamada real: lenta, paga, y no
// determinista) para poder probar cómo guessIngredientWithAI interpreta
// distintas respuestas, sin depender de que haya una CLAUDE_API_KEY real.
vi.mock("@/lib/ai/provider", () => ({
  getAIProvider: vi.fn(),
}));

import { getAIProvider } from "@/lib/ai/provider";
import { guessIngredientWithAI } from "@/lib/matching/ai-ingredient-guess";

function mockCompletion(text: string) {
  vi.mocked(getAIProvider).mockReturnValue({
    name: "claude",
    complete: vi.fn().mockResolvedValue({ text, provider: "claude", model: "test" }),
  });
}

describe("guessIngredientWithAI", () => {
  afterEach(() => {
    vi.mocked(getAIProvider).mockReset();
  });

  it("devuelve las sugerencias cuando la IA responde un JSON valido", async () => {
    mockCompletion('{"guesses": ["sulfametoxazol trimetoprim", "trimetoprim"]}');
    const guesses = await guessIngredientWithAI("trimetropin sulfa");
    expect(guesses).toEqual(["sulfametoxazol trimetoprim", "trimetoprim"]);
  });

  it("devuelve una lista vacia cuando la IA no tiene ninguna sugerencia razonable", async () => {
    mockCompletion('{"guesses": []}');
    expect(await guessIngredientWithAI("asdfqwerty123")).toEqual([]);
  });

  it("devuelve una lista vacia si la respuesta no es JSON valido (nunca lanza)", async () => {
    mockCompletion("esto no es JSON en absoluto");
    expect(await guessIngredientWithAI("algo")).toEqual([]);
  });

  it("devuelve una lista vacia si la llamada a la IA falla (sin clave, red caida, etc.)", async () => {
    vi.mocked(getAIProvider).mockReturnValue({
      name: "claude",
      complete: vi.fn().mockRejectedValue(new Error("CLAUDE_API_KEY no está configurada.")),
    });
    expect(await guessIngredientWithAI("algo")).toEqual([]);
  });

  it("ignora una respuesta con forma distinta a la esperada (nunca lanza)", async () => {
    mockCompletion('{"algo_distinto": true}');
    expect(await guessIngredientWithAI("algo")).toEqual([]);
  });
});
