export interface ParsedLine {
  text: string;
  quantity: number;
}

/**
 * Interpreta una lista pegada de texto libre (p. ej. copiada de Word) en
 * líneas de producto + cantidad. No asume un formato único: intenta, en
 * orden, columnas separadas por tabulación, un número al inicio, o un
 * número al final de la línea. Si no encuentra cantidad, usa 1 — el usuario
 * revisa y corrige el resultado antes de confirmar, nunca se envía sin
 * pasar por esa revisión.
 */
export function parsePastedList(raw: string): ParsedLine[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map((line) => parseLine(line));
}

function parseLine(line: string): ParsedLine {
  // Columnas separadas por tabulación (pegado desde una tabla de Word/Excel).
  if (line.includes("\t")) {
    const cols = line.split("\t").map((c) => c.trim()).filter(Boolean);
    const numericCol = cols.find((c) => /^\d+$/.test(c));
    if (numericCol) {
      const text = cols.filter((c) => c !== numericCol).join(" ");
      if (text) return { text, quantity: Number.parseInt(numericCol, 10) };
    }
  }

  // Número al inicio: "20 Acetaminofén 500mg x100" o "20x Acetaminofén...".
  const leading = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
  if (leading) {
    return { text: leading[2].trim(), quantity: Number.parseInt(leading[1], 10) };
  }

  // Número al final, con separador opcional: "Acetaminofén 500mg x100 - 20",
  // "Acetaminofén 500mg x100  20", "Acetaminofén 500mg x100 (20 und)",
  // "Estrógenos conjugados crema: 10 tubos". La palabra de empaque después
  // del número es opcional y solo sirve para reconocer el patrón — la
  // cantidad siempre es el número, sin importar en qué venga (tubos, cajas,
  // frascos...). Sin esto, un número seguido de una palabra no reconocida
  // ("10 tubos") no calzaba con nada y la línea entera —número incluido—
  // quedaba como texto del producto, lo que además rompe la homologación
  // (un dígito ahí se lee como una posible concentración mal escrita).
  // Ojo: la "x" NUNCA cuenta como separador aquí a propósito — el nombre del
  // producto casi siempre termina en "x100" (la presentación), y si "x"
  // contara como separador, "Acetaminofén 500mg x100" se leería como
  // cantidad 100 en vez de como un producto sin cantidad explícita.
  const trailing =
    /^(.+?)[\s.,:\-–(]+(\d+)\s*(?:unid(?:ades)?|und?|u\.?|tubos?|frascos?|cajas?|ampollas?|viales?|sobres?|bl[ií]ster(?:es)?|bolsas?|tabletas?|c[aá]psulas?)?\)?\s*$/i.exec(
      line,
    );
  if (trailing) {
    return { text: trailing[1].trim(), quantity: Number.parseInt(trailing[2], 10) };
  }

  return { text: line, quantity: 1 };
}
