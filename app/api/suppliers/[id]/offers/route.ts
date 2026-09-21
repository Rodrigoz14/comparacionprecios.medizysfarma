import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";
import { getLatestFilesBySupplier } from "@/lib/pricing/current-offers";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const { id: supplierId } = await params;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true },
  });
  if (!supplier) {
    return Response.json({ error: "Proveedor no encontrado." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get("limit") ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT));

  const latestFilesBySupplier = await getLatestFilesBySupplier([supplierId]);
  const lastFile = latestFilesBySupplier.get(supplierId) ?? null;
  const latestFileId = lastFile?.id ?? null;

  // Solo se muestra lo "vigente": lo que vino en el último archivo subido
  // para este proveedor (o sin archivo de origen, para datos cargados a
  // mano) -- confirmado con el cliente, ver lib/pricing/current-offers.ts.
  const currentFileFilter = latestFileId
    ? { OR: [{ sourceFileId: latestFileId }, { sourceFileId: null }] }
    : { sourceFileId: null };

  const searchFilter = q
    ? {
        OR: [
          { product: { standardName: { contains: q, mode: "insensitive" as const } } },
          { product: { activeIngredient: { contains: q, mode: "insensitive" as const } } },
          { supplierProductCode: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const where = {
    supplierId,
    status: "ACTIVE" as const,
    AND: [currentFileFilter, searchFilter],
  };

  const [total, offers] = await Promise.all([
    prisma.supplierOffer.count({ where }),
    prisma.supplierOffer.findMany({
      where,
      orderBy: { product: { standardName: "asc" } },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        price: true,
        availability: true,
        stockQuantity: true,
        supplierProductCode: true,
        updatedAt: true,
        product: {
          select: {
            standardName: true,
            dosageForm: true,
            concentration: true,
            concentrationUnit: true,
            presentationQuantity: true,
            presentationUnit: true,
            laboratory: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  return Response.json({
    supplier,
    lastFile,
    total,
    page,
    limit,
    offers: offers.map((o) => ({
      id: o.id,
      productName: o.product.standardName,
      dosageForm: o.product.dosageForm,
      concentration: o.product.concentration,
      concentrationUnit: o.product.concentrationUnit,
      presentationQuantity: o.product.presentationQuantity,
      presentationUnit: o.product.presentationUnit,
      laboratoryName: o.product.laboratory?.name ?? null,
      supplierProductCode: o.supplierProductCode,
      price: Number(o.price),
      availability: o.availability,
      stockQuantity: o.stockQuantity,
      updatedAt: o.updatedAt,
    })),
  });
}
