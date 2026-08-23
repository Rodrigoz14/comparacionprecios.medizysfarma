import { z } from "zod";
import { getAIProvider } from "@/lib/ai/provider";

const responseSchema = z.object({
  guesses: z.array(z.string()).max(3),
});

/**
 * Última red antes de NO_MATCH: cuando ni la búsqueda exacta, ni sinónimos,
 * ni tolerancia a typos, ni subconjuntos de palabras, ni nombre comercial
 * encontraron nada, se le pregunta a la IA a qué principio activo real
 * podría referirse un texto mal escrito o mal transcrito (p. ej. de voz a
 * texto). La IA nunca decide el match: solo sugiere un nombre, que después
 * se busca en el catálogo real con las mismas reglas determinísticas de
 * siempre (candidate-search.ts) — si la IA "inventa" un principio activo que
 * no existe en el catálogo, esa sugerencia simplemente no encuentra nada y
 * se descarta, sin ningún efecto.
 */
export async function guessIngredientWithAI(rawText: string): Promise<string[]> {
  const prompt = `Un cliente de una farmacia en Colombia escribió esto para pedir un medicamento (puede tener errores de tipeo, abreviaturas, o estar mal transcrito de voz a texto):
"${rawText}"

¿A qué principio activo (nombre genérico/DCI) real se refiere probablemente? Da hasta 3 posibilidades, ordenadas de más a menos probable, con el nombre en español tal como se usa en Colombia (sin concentración, sin forma farmacéutica, solo el nombre del principio activo o combinación).

Responde EXCLUSIVAMENTE con un JSON con esta forma exacta, sin texto adicional:
{"guesses": ["principio activo 1", "principio activo 2"]}

Si no tienes ninguna idea razonable, responde {"guesses": []}. Nunca inventes un nombre que no sea un principio activo real.`;

  let rawResponse: string;
  try {
    const provider = getAIProvider();
    const result = await provider.complete({
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente farmacéutico que ayuda a identificar principios activos a partir de texto mal escrito. Respondes solo JSON válido, nunca inventas información fuera del formato pedido.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    });
    rawResponse = result.text;
  } catch {
    return [];
  }

  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  const parsed = responseSchema.safeParse(parsedJson);
  if (!parsed.success) return [];

  return parsed.data.guesses.filter((g) => g.trim().length > 0);
}
