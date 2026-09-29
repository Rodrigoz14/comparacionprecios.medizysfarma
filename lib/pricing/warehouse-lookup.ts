import { prisma } from "@/lib/db/client";
import { canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";
import { expandIngredientTerms } from "@/lib/matching/synonym-service";
import type { WarehouseStock } from "@/lib/generated/prisma/client";

/**
 * Busca la existencia en bodega para un producto, tolerando que el
 * ingrediente esté registrado como sinónimo de otro (p. ej. bodega guarda
 * "Dipirona SÓDICA" pero los proveedores solo dicen "Dipirona") -- sin esto,
 * dos nombres reales del MISMO medicamento quedan con `genericKey` distinto
 * y la existencia real en bodega nunca se descuenta al cotizar (bug real
 * reportado por el cliente, 2026-09-29). El genericKey exacto se prueba
 * primero (una sola consulta, sin tocar sinónimos); la expansión por
 * sinónimo solo se intenta si esa consulta no encuentra nada, así que no
 * agrega costo para el caso normal (coincidencia directa).
 */
export async function findWarehouseStock(product: {
  genericKey: string;
  activeIngredient: string;
  concentration: string;
  concentrationUnit: string;
  dosageForm: string;
}): Promise<WarehouseStock | null> {
  const exact = await prisma.warehouseStock.findUnique({ where: { genericKey: product.genericKey } });
  if (exact) return exact;

  const ingredientKey = canonicalizeIngredient(product.activeIngredient);
  const synonymTerms = await expandIngredientTerms(ingredientKey);
  const alternateKeys = [
    ...new Set(
      synonymTerms
        .map((term) =>
          normalizeText(
            [canonicalizeIngredient(term), product.concentration, product.concentrationUnit, product.dosageForm].join(
              " ",
            ),
          ),
        )
        .filter((key) => key !== product.genericKey),
    ),
  ];
  if (alternateKeys.length === 0) return null;

  return prisma.warehouseStock.findFirst({ where: { genericKey: { in: alternateKeys } } });
}
