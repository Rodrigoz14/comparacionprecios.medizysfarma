import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";
import { getLatestFilesBySupplier } from "@/lib/pricing/current-offers";

export async function GET() {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
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
        offerCount: (currentCountBySupplier.get(s.id) ?? 0) + (manualCountBySupplier.get(s.id) ?? 0),
        lastUploadAt: lastFile?.processedAt ?? null,
        lastUploadName: lastFile?.originalName ?? null,
      };
    }),
  });
}

const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "El nombre no puede estar vacío."),
});

export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Nombre de proveedor inválido." }, { status: 400 });
  }

  const { name } = parsed.data;
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (existing) {
    return Response.json({ error: `Ya existe un proveedor activo llamado "${existing.name}".` }, { status: 409 });
  }

  const supplier = await prisma.supplier.create({
    data: { name },
    select: { id: true, name: true },
  });
  return Response.json({ supplier }, { status: 201 });
}
