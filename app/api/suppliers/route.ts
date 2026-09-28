import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";
import { getLatestFilesBySupplier } from "@/lib/pricing/current-offers";
import { SECTOR_VALUES } from "@/lib/sectors";

export async function GET(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  // Filtro opcional por sector, para la barra de pestañas de Proveedores --
  // sin él, se listan todos (comportamiento de siempre).
  const { searchParams } = new URL(request.url);
  const sectorParam = searchParams.get("sector");
  const sector = SECTOR_VALUES.find((v) => v === sectorParam) ?? null;

  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE", ...(sector ? { sectors: { has: sector } } : {}) },
    select: { id: true, name: true, sectors: true },
    orderBy: { name: "asc" },
  });

  const supplierIds = suppliers.map((s) => s.id);
  const latestFilesBySupplier = await getLatestFilesBySupplier(supplierIds);
  const latestFileIds = [...latestFilesBySupplier.values()].map((f) => f.id);

  // El conteo "vigente" de cada proveedor son las ofertas de su último
  // archivo subido, más las que no vienen de ningún archivo (cargadas a
  // mano) -- mismo criterio que lib/pricing/current-offers.ts.
  const [currentCounts, manualCounts] = await Promise.all([
    prisma.supplierOffer.groupBy({
      by: ["supplierId"],
      where: { status: "ACTIVE", sourceFileId: { in: latestFileIds.length > 0 ? latestFileIds : ["__none__"] } },
      _count: { _all: true },
    }),
    prisma.supplierOffer.groupBy({
      by: ["supplierId"],
      where: { status: "ACTIVE", sourceFileId: null, supplierId: { in: supplierIds } },
      _count: { _all: true },
    }),
  ]);
  const currentCountBySupplier = new Map(currentCounts.map((c) => [c.supplierId, c._count._all]));
  const manualCountBySupplier = new Map(manualCounts.map((c) => [c.supplierId, c._count._all]));

  return Response.json({
    suppliers: suppliers.map((s) => {
      const lastFile = latestFilesBySupplier.get(s.id) ?? null;
      return {
        id: s.id,
        name: s.name,
        sectors: s.sectors,
        offerCount: (currentCountBySupplier.get(s.id) ?? 0) + (manualCountBySupplier.get(s.id) ?? 0),
        lastUploadAt: lastFile?.processedAt ?? null,
        lastUploadName: lastFile?.originalName ?? null,
      };
    }),
  });
}

const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "El nombre no puede estar vacío."),
  // Un proveedor puede vender en más de un sector a la vez (confirmado con
  // el cliente, 2026-09-28).
  sectors: z.array(z.enum(SECTOR_VALUES)).min(1, "Elige al menos un sector."),
});

export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Datos de proveedor inválidos." }, { status: 400 });
  }

  const { name, sectors } = parsed.data;
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (existing) {
    return Response.json({ error: `Ya existe un proveedor activo llamado "${existing.name}".` }, { status: 409 });
  }

  const supplier = await prisma.supplier.create({
    data: { name, sectors },
    select: { id: true, name: true, sectors: true },
  });
  return Response.json({ supplier }, { status: 201 });
}
