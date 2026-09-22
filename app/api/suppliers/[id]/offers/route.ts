import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";
import { getLatestFilesBySupplier } from "@/lib/pricing/current-offers";
import { isExpiringSoon } from "@/lib/pricing/expiration";
import { isSealedUnitForm } from "@/lib/pricing/measured-forms";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type SortKey = "product" | "laboratory" | "unitPrice" | "availability";
const SORT_KEYS: SortKey[] = ["product", "laboratory", "unitPrice", "availability"];

// Unidades de MEDIDA (volumen/peso), nunca de conteo -- confirmado con el
// cliente (2026-09-21): "No. unidades" no debe mostrar ninguna medida (ni
// "30 ml" ni "120 g"), solo cuántas unidades comprables trae el empaque.
// Coincide con las unidades que PRESENTATION_UNIT_BY_FORM (extract-attributes.ts)
// asigna a formas líquidas/semisólidas (jarabe, solución, crema, loción...).
const MEASURE_UNITS = new Set(["ml", "g"]);

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
  const sortParam = searchParams.get("sort") ?? "product";
  const sort: SortKey = SORT_KEYS.includes(sortParam as SortKey) ? (sortParam as SortKey) : "product";
  const dir: "asc" | "desc" = searchParams.get("dir") === "desc" ? "desc" : "asc";

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

  // El precio unitario se calcula igual que en el motor de precios (mismo
  // criterio de ampollas/viales, ver lib/pricing/measured-forms.ts) y no es
  // una columna real de la base de datos, así que no se puede ordenar por
  // ella con un ORDER BY -- se trae todo lo que ya filtró la búsqueda,
  // se ordena en memoria y ahí sí se pagina. Los catálogos por proveedor son
  // manejables (cientos a pocos miles de filas), así que no es un problema.
  const matches = await prisma.supplierOffer.findMany({
    where,
    select: {
      id: true,
      price: true,
      unitPriceAsImported: true,
      availability: true,
      stockQuantity: true,
      supplierProductCode: true,
      expirationDate: true,
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
  });

  const offers = matches.map((o) => {
    const packagePrice = Number(o.price);
    const packageSize = o.product.presentationQuantity;
    const isSealedUnit = isSealedUnitForm(o.product.dosageForm);
    // El precio unitario NUNCA se calcula cuando el proveedor ya lo reportó
    // tal cual en su archivo (confirmado con el cliente, 2026-09-22) -- se
    // usa ese valor exacto, sin ninguna división. Solo se deriva por
    // división para proveedores sin ese dato propio (detección genérica),
    // como respaldo.
    const unitPrice =
      o.unitPriceAsImported !== null
        ? Number(o.unitPriceAsImported)
        : isSealedUnit
          ? packagePrice
          : packagePrice / packageSize;
    const isMeasureUnit = MEASURE_UNITS.has(o.product.presentationUnit);
    return {
      id: o.id,
      productName: o.product.standardName,
      dosageForm: o.product.dosageForm,
      concentration: o.product.concentration,
      concentrationUnit: o.product.concentrationUnit,
      // presentationQuantity/Unit se conservan sin tocar (así siguen
      // distinguiendo, por ejemplo, un frasco de 30ml de uno de 120ml como
      // productos distintos); purchaseQuantity/Unit son lo que debe
      // mostrarse como "cuántas unidades trae el empaque" -- nunca una
      // medida (ml/g), siempre una cantidad de unidades comprables.
      presentationQuantity: o.product.presentationQuantity,
      presentationUnit: o.product.presentationUnit,
      isMeasureUnit,
      purchaseQuantity: isMeasureUnit ? 1 : o.product.presentationQuantity,
      purchaseUnit: isMeasureUnit ? "unidad" : o.product.presentationUnit,
      laboratoryName: o.product.laboratory?.name ?? null,
      supplierProductCode: o.supplierProductCode,
      price: packagePrice,
      unitPrice,
      availability: o.availability,
      stockQuantity: o.stockQuantity,
      expirationDate: o.expirationDate,
      expiresSoon: isExpiringSoon(o.expirationDate),
      updatedAt: o.updatedAt,
    };
  });

  const collator = new Intl.Collator("es", { sensitivity: "base" });
  const sign = dir === "asc" ? 1 : -1;
  offers.sort((a, b) => {
    switch (sort) {
      case "unitPrice":
        return (a.unitPrice - b.unitPrice) * sign;
      case "laboratory":
        return collator.compare(a.laboratoryName ?? "", b.laboratoryName ?? "") * sign;
      case "availability":
        return collator.compare(a.availability, b.availability) * sign;
      case "product":
      default:
        return collator.compare(a.productName, b.productName) * sign;
    }
  });

  const total = offers.length;
  const paged = offers.slice((page - 1) * limit, (page - 1) * limit + limit);

  return Response.json({
    supplier,
    lastFile,
    total,
    page,
    limit,
    sort,
    dir,
    offers: paged,
  });
}
