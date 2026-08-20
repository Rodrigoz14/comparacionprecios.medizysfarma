/**
 * Distancia de Levenshtein (número mínimo de inserciones/borrados/sustituciones
 * para convertir a en b). Determinística, sin IA: sirve para tolerar errores de
 * tipeo/OCR en el ingrediente activo (p. ej. "valprico" en vez de "valproico"),
 * nunca para inferir equivalencias entre sustancias distintas — eso sigue
 * siendo exclusivo de IngredientSynonym, con fuente explícita.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const insertCost = currentRow[j] + 1;
      const deleteCost = previousRow[j + 1] + 1;
      const substituteCost = previousRow[j] + (a[i] === b[j] ? 0 : 1);
      currentRow.push(Math.min(insertCost, deleteCost, substituteCost));
    }
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

/**
 * Tolerancia proporcional al largo del texto: una palabra corta no puede
 * tener el mismo margen de error absoluto que una larga, o "sal" y "col"
 * (o dos principios activos cortos y distintos) terminarían "coincidiendo".
 */
export function fuzzyIngredientThreshold(length: number): number {
  return Math.max(1, Math.floor(length / 7));
}
