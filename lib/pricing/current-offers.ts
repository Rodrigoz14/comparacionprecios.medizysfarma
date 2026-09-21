import { prisma } from "@/lib/db/client";

/**
 * Un proveedor puede resubir su lista de precios sin que un producto vuelva a
 * aparecer (ya no lo vende, o simplemente no vino en ese Excel). Esa oferta
 * vieja se queda en la base para no perder el historial de precios, pero deja
 * de contar como vigente: solo se considera "actual" la oferta que vino en el
 * último archivo que ese proveedor subió — confirmado con el cliente
 * (2026-09-21): si un producto no viene en el último Excel de un proveedor,
 * ya no debe mostrarse ni contar para comparar precios en Solicitudes.
 *
 * Devuelve el último SupplierFile procesado por proveedor (el más reciente
 * por processedAt). Un proveedor sin ningún archivo procesado no aparece en
 * el mapa devuelto.
 */
export interface LatestSupplierFile {
  id: string;
  originalName: string;
  processedAt: Date | null;
  totalRows: number | null;
}

export async function getLatestFilesBySupplier(supplierIds: string[]): Promise<Map<string, LatestSupplierFile>> {
  const latestFileBySupplier = new Map<string, LatestSupplierFile>();
  if (supplierIds.length === 0) return latestFileBySupplier;

  const files = await prisma.supplierFile.findMany({
    where: { supplierId: { in: supplierIds }, status: "PROCESSED" },
    orderBy: { processedAt: "desc" },
    select: { id: true, supplierId: true, originalName: true, processedAt: true, totalRows: true },
  });
  for (const file of files) {
    if (!latestFileBySupplier.has(file.supplierId)) {
      latestFileBySupplier.set(file.supplierId, file);
    }
  }
  return latestFileBySupplier;
}

export async function getLatestFileIdBySupplier(supplierIds: string[]): Promise<Map<string, string>> {
  const latestFiles = await getLatestFilesBySupplier(supplierIds);
  const latestFileIdBySupplier = new Map<string, string>();
  for (const [supplierId, file] of latestFiles) {
    latestFileIdBySupplier.set(supplierId, file.id);
  }
  return latestFileIdBySupplier;
}

/**
 * Filtra una lista de ofertas dejando solo las "vigentes" (ver arriba). Una
 * oferta sin sourceFileId (por ejemplo datos de prueba/carga manual, sin
 * archivo de origen) no tiene forma de quedar desactualizada por un archivo
 * nuevo, así que se conserva siempre.
 */
export async function filterCurrentOffers<T extends { supplierId: string; sourceFileId: string | null }>(
  offers: T[],
): Promise<T[]> {
  const supplierIds = [...new Set(offers.map((o) => o.supplierId))];
  const latestFileIdBySupplier = await getLatestFileIdBySupplier(supplierIds);

  return offers.filter((o) => {
    if (o.sourceFileId === null) return true;
    const latestFileId = latestFileIdBySupplier.get(o.supplierId);
    if (!latestFileId) return true;
    return o.sourceFileId === latestFileId;
  });
}
