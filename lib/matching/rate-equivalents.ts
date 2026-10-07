import { prisma } from "@/lib/db/client";
import type { Sector } from "@/lib/generated/prisma/client";
import { computeRate } from "@/lib/matching/compare-attributes";

/**
 * Productos del mismo ingrediente y forma farmacéutica, pero con una clave
 * genérica DISTINTA, cuya concentración es matemáticamente la MISMA tasa
 * (ver `computeRate`) -- p. ej. "2 MEQ" (denominador implícito) y
 * "20/10 MEQ/ML" (razón explícita de otro proveedor) son la misma dosis
 * real, pero quedan en genericKey distinto porque cada proveedor la
 * escribió diferente.
 *
 * Se usa en DOS puntos que de otro modo nunca se enteran de esta
 * equivalencia porque cortan antes de llegar a `compareAttributes`:
 * - matching-service.ts: el camino de "coincidencia exacta de genericKey"
 *   devuelve de inmediato sin buscar la familia más amplia.
 * - selection-engine.ts: arma las ofertas a comparar por el genericKey del
 *   producto YA homologado, nunca por ingrediente+forma.
 * Bug real confirmado 2026-10-07: Disfarma ("2 MEQ", texto exacto) ganaba
 * siempre aunque Ramédicas/Ofimédicas ("20/10 MEQ/ML") tuvieran la MISMA
 * tasa real hasta 30 veces más barata -- nunca llegaban a compararse.
 */
export async function findRateEquivalentProductIds(params: {
  ingredientKey: string;
  concentration: string;
  concentrationUnit: string;
  dosageForm: string;
  excludeGenericKey: string;
  sector?: Sector;
}): Promise<string[]> {
  const rate = computeRate(params.concentration, params.concentrationUnit);
  if (!rate) return [];
  const family = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      ingredientKey: params.ingredientKey,
      dosageForm: params.dosageForm,
      genericKey: { not: params.excludeGenericKey },
      ...(params.sector ? { sector: params.sector } : {}),
    },
    select: { id: true, concentration: true, concentrationUnit: true },
  });
  return family
    .filter((p) => {
      const pRate = computeRate(p.concentration, p.concentrationUnit);
      return pRate !== null && pRate.base === rate.base && Math.abs(pRate.rate - rate.rate) < 0.001;
    })
    .map((p) => p.id);
}
