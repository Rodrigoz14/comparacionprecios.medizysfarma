import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/client";
import { calculatePackagesNeeded, calculateTotal } from "@/lib/pricing/price-calculator";

const CURRENCY_FORMAT = '"$"#,##0';

interface SupplierOrderLine {
  supplierName: string;
  supplierProductCode: string | null;
  productName: string;
  laboratoryName: string | null;
  packageSize: number;
  presentationUnit: string;
  packagesNeeded: number;
  packagePrice: number;
  totalCost: number;
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
    const packagesNeeded = calculatePackagesNeeded(item.quantityToPurchase, packageSize);
    const packagePrice = Number(comparison.price);

    const line: SupplierOrderLine = {
      supplierName: comparison.supplier.name,
      supplierProductCode: comparison.supplierOffer.supplierProductCode,
      productName: comparison.product.standardName,
      laboratoryName: comparison.product.laboratory?.name ?? null,
      packageSize,
      presentationUnit: comparison.product.presentationUnit,
      packagesNeeded,
      packagePrice,
      totalCost: calculateTotal(packagePrice, packagesNeeded),
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
      { header: "Código proveedor", key: "code", width: 18 },
      { header: "Producto", key: "product", width: 45 },
      { header: "Laboratorio", key: "lab", width: 20 },
      { header: "Presentación", key: "presentation", width: 18 },
      { header: "Empaques a pedir", key: "packages", width: 16 },
      { header: "Precio empaque", key: "packagePrice", width: 16 },
      { header: "Total", key: "total", width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const line of lines) {
      sheet.addRow({
        code: line.supplierProductCode ?? "",
        product: line.productName,
        lab: line.laboratoryName ?? "",
        presentation: `x${line.packageSize} ${line.presentationUnit}`,
        packages: line.packagesNeeded,
        packagePrice: line.packagePrice,
        total: line.totalCost,
      });
    }
    sheet.getColumn("packagePrice").numFmt = CURRENCY_FORMAT;
    sheet.getColumn("total").numFmt = CURRENCY_FORMAT;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const safeCustomerName = customerRequest.customerName.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "cliente";
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `pedido-${safeCustomerName}-${dateStamp}.xlsx`;

  return { buffer: Buffer.from(arrayBuffer), fileName };
}
