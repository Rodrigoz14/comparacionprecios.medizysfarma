import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";
import { levenshteinDistance } from "@/lib/matching/fuzzy";
import { stripAccents } from "@/lib/matching/normalize";

/**
 * Más permisivo que el umbral usado para principio activo
 * (lib/matching/fuzzy.ts), que está afinado para no confundir sustancias
 * distintas cuando el sistema decide automáticamente. Aquí el usuario elige
 * visualmente de una lista de sugerencias, así que se prioriza tolerar
 * varios errores de tipeo sobre la precisión estricta.
 */
function searchThreshold(length: number): number {
  return Math.max(2, Math.ceil(length / 3));
}

const MAX_RESULTS = 8;
// Tope de productos activos que se traen para comparar por tolerancia a
// errores de tipeo cuando la búsqueda exacta no basta -- igual que el resto
// del motor de matching (lib/matching/candidate-search.ts), se prioriza no
// perder resultados por una letra sobre la eficiencia de un catálogo que
// hoy es manejable.
const FUZZY_SCAN_LIMIT = 5000;

function wordsOf(text: string): string[] {
  return stripAccents(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export async function GET(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ products: [] });

  const exactMatches = await prisma.product.findMany({
    where: { status: "ACTIVE", standardName: { contains: q, mode: "insensitive" } },
    take: MAX_RESULTS,
    orderBy: { standardName: "asc" },
    select: {
      id: true,
      standardName: true,
      dosageForm: true,
      concentration: true,
      concentrationUnit: true,
      presentationQuantity: true,
      presentationUnit: true,
    },
  });

  if (exactMatches.length >= MAX_RESULTS) {
    return Response.json({ products: exactMatches });
  }

  const queryWords = wordsOf(q);
  if (queryWords.length === 0) return Response.json({ products: exactMatches });

  const seen = new Set(exactMatches.map((p) => p.id));
  const pool = await prisma.product.findMany({
    where: { status: "ACTIVE", id: { notIn: [...seen] } },
    take: FUZZY_SCAN_LIMIT,
    select: {
      id: true,
      standardName: true,
      dosageForm: true,
      concentration: true,
      concentrationUnit: true,
      presentationQuantity: true,
      presentationUnit: true,
    },
  });

  // Cada palabra buscada debe tener una palabra parecida (distancia de
  // Levenshtein dentro del margen proporcional a su largo) en el nombre del
  // producto -- así "acetaminofn 500" sigue encontrando "ACETAMINOFEN 500MG"
  // aunque falte una letra, sin importar el orden de las palabras.
  const scored = pool
    .map((product) => {
      const targetWords = wordsOf(product.standardName);
      let totalDistance = 0;
      for (const queryWord of queryWords) {
        const threshold = searchThreshold(queryWord.length);
        let best = Infinity;
        for (const targetWord of targetWords) {
          if (Math.abs(targetWord.length - queryWord.length) > threshold + 2) continue;
          const distance = levenshteinDistance(queryWord, targetWord);
          if (distance < best) best = distance;
        }
        if (best > threshold) return null;
        totalDistance += best;
      }
      return { product, totalDistance };
    })
    .filter((s): s is { product: (typeof pool)[number]; totalDistance: number } => s !== null)
    .sort((a, b) => a.totalDistance - b.totalDistance)
    .slice(0, MAX_RESULTS - exactMatches.length)
    .map((s) => s.product);

  return Response.json({ products: [...exactMatches, ...scored] });
}
