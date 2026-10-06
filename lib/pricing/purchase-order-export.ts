import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/client";
import { formatAvailabilityLabel } from "@/lib/pricing/availability";
import { isPricedPerContainer } from "@/lib/pricing/measured-forms";
import { calculateTotal, resolvePackagesNeeded, resolveUnitPrice } from "@/lib/pricing/price-calculator";

const CURRENCY_FORMAT = '"$"#,##0';

interface SupplierOrderLine {
  clientName: string;
  supplierName: string;
  supplierProductCode: string | null;
  productName: string;
  availabilityLabel: string;
  warehouseCovered: number;
  laboratoryName: string | null;
  packageSize: number;
  presentationUnit: string;
  packagesNeeded: number;
  packagePrice: number;
  totalCost: number;
  unitPrice: number;
}

interface WarehouseCoveredLine {
  clientName: string;
  productName: string;
  requestedQuantity: number;
  coveredByWarehouse: number;
  pendingToPurchase: number;
}

/**
 * Producto donde NINGÚN proveedor tenía disponibilidad suficiente para lo
 * que faltaba por comprar (`SelectionResult.status === "NO_STOCK"`) -- a
 * pedido del cliente (2026-10-05): antes de este cambio, estos productos no
 * aparecían en NINGÚN lado del Excel (la hoja de cada proveedor solo lista
 * ítems con una oferta `selected`, y aquí nunca se llega a seleccionar
 * ninguna). Una fila por cada alternativa real que se comparó, para que el
 * cliente vea cuánto le faltó a cada proveedor y pueda decidir manualmente.
 */
interface UnavailableLine {
  clientName: string;
  productName: string;
  supplierName: string;
  availabilityLabel: string;
  packagePrice: number;
  warehouseCovered: number;
  pendingToPurchase: number;
}

/**
 * Arma el pedido a colocarle a cada proveedor a partir de las ofertas ya
 * seleccionadas (`PriceComparison.selected`) de una solicitud de cliente.
 * Solo entran ítems con `quantityToPurchase > 0`: lo cubierto por bodega no
 * genera pedido de compra, pero sí aparece en la pestaña "Bodega" (ver más
 * abajo). Devuelve null si no hay nada que comprar NI nada cubierto por
 * bodega para mostrar.
 */
export async function buildPurchaseOrderWorkbook(
  customerRequestId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const customerRequest = await prisma.customerRequest.findUnique({ where: { id: customerRequestId } });
  if (!customerRequest) return null;

  const items = await prisma.customerRequestItem.findMany({
    where: { customerRequestId, quantityToPurchase: { gt: 0 } },
    include: {
      priceComparisons: {
        where: { selected: true },
        include: {
          supplier: true,
          product: { include: { laboratory: true } },
          supplierOffer: true,
        },
      },
    },
  });

  // Ítems con existencia en bodega al momento de cotizar (cubiertos del todo
  // o en parte) -- se muestran aparte para que quede claro qué no hubo que
  // comprarle a ningún proveedor, sin importar si `quantityToPurchase` quedó
  // en 0 (cobertura total, ni siquiera entra en el query de arriba) o mayor
  // a 0 (cobertura parcial, el resto sí aparece en la pestaña del proveedor).
  const warehouseCoveredItems = await prisma.customerRequestItem.findMany({
    where: { customerRequestId, warehouseStock: { gt: 0 } },
    include: { matchedProduct: true },
  });
  const warehouseLines: WarehouseCoveredLine[] = warehouseCoveredItems.map((item) => ({
    clientName: item.clientName ?? customerRequest.customerName,
    productName: item.matchedProduct?.standardName ?? item.originalText,
    requestedQuantity: item.requestedQuantity,
    coveredByWarehouse: Math.min(item.requestedQuantity, item.warehouseStock!),
    pendingToPurchase: item.quantityToPurchase ?? 0,
  }));

  // Ítems con disponibilidad insuficiente en TODOS los proveedores
  // comparados (`status: "NO_STOCK"` en selection-engine.ts, ninguna
  // comparación quedó `selected`). Se filtra `priceComparisons.length > 0`
  // en código, no en el `where`, para no depender de combinar `some`/`none`
  // sobre la misma relación -- así se distingue de un ítem que de verdad no
  // tiene ninguna oferta de proveedor registrada (problema distinto, sin
  // datos de precio en absoluto, no de disponibilidad).
  const noSelectionItems = await prisma.customerRequestItem.findMany({
    where: { customerRequestId, quantityToPurchase: { gt: 0 }, priceComparisons: { none: { selected: true } } },
    include: {
      matchedProduct: true,
      priceComparisons: {
        include: { supplier: true, supplierOffer: true },
      },
    },
  });
  const unavailableLines: UnavailableLine[] = noSelectionItems
    .filter((item) => item.priceComparisons.length > 0)
    .flatMap((item) =>
      [...item.priceComparisons]
        .sort((a, b) => (b.supplierOffer.stockQuantity ?? -1) - (a.supplierOffer.stockQuantity ?? -1))
        .map((comparison) => ({
          clientName: item.clientName ?? customerRequest.customerName,
          productName: item.matchedProduct?.standardName ?? item.originalText,
          supplierName: comparison.supplier.name,
          availabilityLabel:
            comparison.discardReason ?? formatAvailabilityLabel(comparison.availability, comparison.supplierOffer.stockQuantity),
          packagePrice: Number(comparison.price),
          warehouseCovered: item.warehouseStock ?? 0,
          pendingToPurchase: item.quantityToPurchase ?? 0,
        })),
    );

  const linesBySupplier = new Map<string, SupplierOrderLine[]>();

  for (const item of items) {
    const comparison = item.priceComparisons[0];
    if (!comparison || item.quantityToPurchase === null) continue;

    const packageSize = comparison.product.presentationQuantity;
    const perContainer = isPricedPerContainer(comparison.product.dosageForm, comparison.product.presentationUnit);
    // "Cantidad" es el número de empaques que pide el cliente, no unidades
    // sueltas -- mismo criterio que selection-engine.ts, para que el pedido a
    // proveedores coincida con lo que se mostró en pantalla al cotizar.
    const packagesNeeded = perContainer
      ? item.quantityToPurchase
      : resolvePackagesNeeded(item.quantityToPurchase, item.requestedPresentationQuantity, packageSize, comparison.product.presentationUnit);
    const packagePrice = Number(comparison.price);
    const unitPriceAsImported = comparison.supplierOffer.unitPriceAsImported;
    const unitPrice = resolveUnitPrice(
      packagePrice,
      packageSize,
      perContainer,
      unitPriceAsImported !== null ? Number(unitPriceAsImported) : null,
    );

    const line: SupplierOrderLine = {
      // El Excel que sube el cliente puede traer varios clientes mezclados
      // en un mismo archivo (columna de cliente detectada automáticamente
      // por fila) -- si esta fila no traía esa columna, se usa el cliente
      // general de la solicitud.
      clientName: item.clientName ?? customerRequest.customerName,
      supplierName: comparison.supplier.name,
      supplierProductCode: comparison.supplierOffer.supplierProductCode,
      productName: comparison.product.standardName,
      availabilityLabel: formatAvailabilityLabel(comparison.availability, comparison.supplierOffer.stockQuantity),
      warehouseCovered: item.warehouseStock ?? 0,
      laboratoryName: comparison.product.laboratory?.name ?? null,
      packageSize,
      presentationUnit: comparison.product.presentationUnit,
      packagesNeeded,
      packagePrice,
      totalCost: calculateTotal(packagePrice, packagesNeeded),
      unitPrice,
    };

    const list = linesBySupplier.get(comparison.supplier.name) ?? [];
    list.push(line);
    linesBySupplier.set(comparison.supplier.name, list);
  }

  if (linesBySupplier.size === 0 && warehouseLines.length === 0 && unavailableLines.length === 0) return null;

  const workbook = new ExcelJS.Workbook();

  if (warehouseLines.length > 0) {
    const warehouseSheet = workbook.addWorksheet("Bodega");
    warehouseSheet.columns = [
      { header: "Cliente", key: "client", width: 20 },
      { header: "Producto", key: "product", width: 45 },
      { header: "Cantidad pedida", key: "requested", width: 16 },
      { header: "Cubierto por bodega", key: "covered", width: 18 },
      { header: "Pendiente por comprar", key: "pending", width: 20 },
    ];
    warehouseSheet.getRow(1).font = { bold: true };
    for (const line of warehouseLines) {
      warehouseSheet.addRow({
        client: line.clientName,
        product: line.productName,
        requested: line.requestedQuantity,
        covered: line.coveredByWarehouse,
        pending: line.pendingToPurchase,
      });
    }
  }

  if (unavailableLines.length > 0) {
    const unavailableSheet = workbook.addWorksheet("Sin disponibilidad");
    unavailableSheet.columns = [
      { header: "Cliente", key: "client", width: 20 },
      { header: "Producto", key: "product", width: 45 },
      { header: "Proveedor", key: "supplier", width: 22 },
      { header: "Disponibilidad", key: "availability", width: 42 },
      { header: "Precio empaque", key: "packagePrice", width: 16 },
      { header: "Cubierto por bodega", key: "warehouseCovered", width: 18 },
      { header: "Pendiente por comprar", key: "pending", width: 20 },
    ];
    unavailableSheet.getRow(1).font = { bold: true };
    for (const line of unavailableLines) {
      unavailableSheet.addRow({
        client: line.clientName,
        product: line.productName,
        supplier: line.supplierName,
        availability: line.availabilityLabel,
        packagePrice: line.packagePrice,
        warehouseCovered: line.warehouseCovered,
        pending: line.pendingToPurchase,
      });
    }
    unavailableSheet.getColumn("packagePrice").numFmt = CURRENCY_FORMAT;
  }

  const summary = workbook.addWorksheet("Resumen");
  summary.columns = [
    { header: "Proveedor", key: "supplier", width: 30 },
    { header: "Productos", key: "count", width: 14 },
    { header: "Total a pagar", key: "total", width: 18 },
  ];
  for (const [supplierName, lines] of linesBySupplier) {
    summary.addRow({
      supplier: supplierName,
      count: lines.length,
      total: lines.reduce((sum, l) => sum + l.totalCost, 0),
    });
  }
  summary.getColumn("total").numFmt = CURRENCY_FORMAT;
  summary.getRow(1).font = { bold: true };

  for (const [supplierName, lines] of linesBySupplier) {
    // Los nombres de hoja de Excel no admiten ciertos caracteres ni más de 31 caracteres.
    const sheetName = supplierName.replace(/[*?:/\\[\]]/g, "").slice(0, 31) || "Proveedor";
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = [
      { header: "Cliente", key: "client", width: 20 },
      { header: "Código proveedor", key: "code", width: 18 },
      { header: "Producto", key: "product", width: 45 },
      { header: "Disponibilidad", key: "availability", width: 28 },
      { header: "Cubierto por bodega", key: "warehouseCovered", width: 18 },
      { header: "Laboratorio", key: "lab", width: 20 },
      { header: "Presentación", key: "presentation", width: 18 },
      { header: "Empaques a pedir", key: "packages", width: 16 },
      { header: "Precio empaque", key: "packagePrice", width: 16 },
      { header: "Total", key: "total", width: 16 },
      { header: "Precio unitario (ref.)", key: "unitPrice", width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const line of lines) {
      const row = sheet.addRow({
        client: line.clientName,
        code: line.supplierProductCode ?? "",
        product: line.productName,
        availability: line.availabilityLabel,
        warehouseCovered: line.warehouseCovered,
        lab: line.laboratoryName ?? "",
        presentation: `x${line.packageSize} ${line.presentationUnit}`,
        packages: line.packagesNeeded,
        packagePrice: line.packagePrice,
        total: line.totalCost,
        unitPrice: line.unitPrice,
      });
      // Lo que se paga es el total del empaque, no el precio unitario -- se
      // resalta el Total y se deja el precio unitario en letra chica y gris,
      // como referencia para comparar presentaciones, no como precio a pagar.
      row.getCell("total").font = { bold: true };
      row.getCell("unitPrice").font = { size: 9, italic: true, color: { argb: "FF808080" } };
    }
    sheet.getColumn("packagePrice").numFmt = CURRENCY_FORMAT;
    sheet.getColumn("total").numFmt = CURRENCY_FORMAT;
    sheet.getColumn("unitPrice").numFmt = '"$"#,##0.00';
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const safeCustomerName = customerRequest.customerName.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "cliente";
  const now = new Date();
  // Formato pedido por el cliente: DD/MM/AAAA -- pero "/" no es válido en un
  // nombre de archivo (Windows y la mayoría de navegadores lo tratan como
  // separador de carpeta), así que se usa "-" entre los números manteniendo
  // el mismo orden día-mes-año.
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dateStamp = `${dd}-${mm}-${now.getFullYear()}`;
  const fileName = `Pedido_${safeCustomerName}_${dateStamp}.xlsx`;

  return { buffer: Buffer.from(arrayBuffer), fileName };
}
