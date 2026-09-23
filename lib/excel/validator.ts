import { z } from "zod";

// El precio se guarda en un Decimal(14,2) -- técnicamente cabría hasta casi
// un billón, pero ningún producto real de este catálogo se acerca ni a los
// cientos de millones (el más caro visto en datos reales anda por los
// $10-15 millones). Un precio por encima de este techo es casi siempre una
// fila mal extraída (p. ej. una cantidad de presentación equivocada
// multiplicando un precio por unidad a un número absurdo) -- bug real
// (2026-09-23): una sola fila así hacía fallar TODA la importación con
// "numeric field overflow" de Postgres, sin importar cuántas de las demás
// miles de filas fueran válidas. Se rechaza esa fila puntual como error
// (igual que cualquier otro dato inválido), en vez de tumbar el archivo
// completo.
const MAX_SANE_PRICE = 100_000_000;

export const parsedOfferRowSchema = z.object({
  originalProductName: z.string().min(1, "El nombre del producto está vacío."),
  price: z
    .number()
    .positive("El precio debe ser mayor que cero.")
    .max(MAX_SANE_PRICE, "El precio calculado es absurdamente alto; probablemente la cantidad del empaque se extrajo mal."),
  tax: z.number().min(0).nullable(),
});

export function validateParsedRow(row: {
  originalProductName: string;
  price: number | null;
  tax: number | null;
}): { valid: true } | { valid: false; message: string } {
  const result = parsedOfferRowSchema.safeParse({
    originalProductName: row.originalProductName,
    price: row.price,
    tax: row.tax,
  });
  if (result.success) return { valid: true };
  return { valid: false, message: result.error.issues[0]?.message ?? "Fila inválida." };
}
