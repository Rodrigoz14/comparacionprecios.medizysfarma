import { z } from "zod";

export const parsedOfferRowSchema = z.object({
  originalProductName: z.string().min(1, "El nombre del producto está vacío."),
  price: z.number().positive("El precio debe ser mayor que cero."),
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
