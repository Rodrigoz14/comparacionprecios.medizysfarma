import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/client";
import { isSealedUnitForm } from "@/lib/pricing/measured-forms";
import { calculateTotal, resolvePackagesNeeded } from "@/lib/pricing/price-calculator";

const CURRENCY_FORMAT = '"$"#,##0';

interface SupplierOrderLine {
  clientName: string;
  supplierName: string;
  supplierProductCode: string | null;
  productName: string;
  laboratoryName: string | null;
  packageSize: number;
  presentationUnit: string;
  packagesNeeded: number;
  packagePrice: number;
  totalCost: number;
  unitPrice: number;
}

/**
 * Arma el pedido a colocarle a cada proveedor a partir de las ofertas ya
 * seleccionadas (`PriceComparison.selected`) de una solicitud de cliente.
 * Solo entran ítems con `quantityToPurchase > 0`: lo cubierto por bodega no
 * genera pedido de compra. Devuelve null si no hay nada que comprar.
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

  const linesBySupplier = new Map<string, SupplierOrderLine[]>();

  for (const item of items) {
    const comparison = item.priceComparisons[0];
    if (!comparison || item.quantityToPurchase === null) continue;

    const packageSize = comparison.product.presentationQuantity;
    const isSealedUnit = isSealedUnitForm(comparison.product.dosageForm);
    // "Cantidad" es el número de empaques que pide el cliente, no unidades
    // sueltas -- mismo criterio que selection-engine.ts, para que el pedido a
    // proveedores coincida con lo que se mostró en pantalla al cotizar.
    const packagesNeeded = isSealedUnit
      ? item.quantityToPurchase
      : resolvePackagesNeeded(item.quantityToPurchase, item.requestedPresentationQuantity, packageSize, comparison.product.presentationUnit);
    const packagePrice = Number(comparison.price);
    // El precio unitario NUNCA se calcula cuando el proveedor ya lo reportó
    // tal cual en su archivo (confirmado con el cliente, 2026-09-22) -- se
    // usa ese valor exacto. Solo se deriva por división como respaldo (y,
    // para ampollas/viales, nunca se divide: el precio ya es por unidad
    // sellada, mismo criterio que selection-engine.ts).
    const unitPriceAsImported = comparison.supplierOffer.unitPriceAsImported;
    const unitPrice =
      unitPriceAsImported !== null
        ? Number(unitPriceAsImported)
        : isSealedUnit
          ? packagePrice
          : packagePrice / packageSize;

    const line: SupplierOrderLine = {
      // El Excel que sube el cliente puede traer varios clientes mezclados
      // en un mismo archivo (columna de cliente detectada automáticamente
      // por fila) -- si esta fila no traía esa columna, se usa el cliente
      // general de la solicitud.
      clientName: item.clientName ?? customerRequest.customerName,
      supplierName: comparison.supplier.name,
      supplierProductCode: comparison.supplierOffer.supplierProductCode,
      productName: comparison.product.standardName,
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

  if (linesBySupplier.size === 0) return null;

  const workbook = new ExcelJS.Workbook();

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
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `pedido-${safeCustomerName}-${dateStamp}.xlsx`;

  return { buffer: Buffer.from(arrayBuffer), fileName };
}
