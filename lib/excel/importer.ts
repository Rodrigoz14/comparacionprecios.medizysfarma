import { prisma } from "@/lib/db/client";
import { detectColumns, detectHeaderRowIndex } from "@/lib/excel/detector";
import { detectPriceFormat, normalizeAvailability, parsePrice } from "@/lib/excel/normalizer";
import { parseWorkbook } from "@/lib/excel/parser";
import { buildGenericKey, buildNormalizedName, normalizeText } from "@/lib/matching/normalize";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import {
  hashBuffer,
  persistSupplierFile,
  readTemporaryUpload,
  saveTemporaryUpload,
} from "@/lib/excel/storage";
import type {
  AnalyzeResult,
  ColumnMapping,
  ImportReport,
  ParsedOfferRow,
  PriceFormat,
  RawRow,
  RowIssue,
} from "@/lib/excel/types";
import { detectDuplicates } from "@/lib/excel/duplicate-detector";
import { validateParsedRow } from "@/lib/excel/validator";

const PREVIEW_ROW_COUNT = 10;
const BATCH_SIZE = 200;

export async function analyzeSupplierFile(
  buffer: Buffer,
  originalName: string,
  supplierId: string,
): Promise<AnalyzeResult> {
  const workbook = await parseWorkbook(buffer, originalName);
  if (workbook.sheets.length === 0) {
    throw new Error("El archivo no contiene hojas legibles.");
  }
  const selectedSheet = workbook.sheets[0].name;
  const rows = workbook.getRows(selectedSheet);

  const headerRowIndex = detectHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] ?? {};
  const columns = detectColumns(headerRow);

  const priceColumn = columns.find((c) => c.proposedTarget === "price");
  const dataRows = rows.slice(headerRowIndex + 1);
  const priceSamples = priceColumn
    ? dataRows.slice(0, 30).map((r) => r[priceColumn.index])
    : [];
  const proposedPriceFormat = detectPriceFormat(priceSamples);

  const mapping: ColumnMapping = {};
  for (const col of columns) {
    if (col.proposedTarget) mapping[col.proposedTarget] = col.index;
  }

  const previewRows = dataRows.slice(0, PREVIEW_ROW_COUNT);

  const fileHash = hashBuffer(buffer);
  const existingFile = await prisma.supplierFile.findUnique({
    where: { supplierId_fileHash: { supplierId, fileHash } },
  });

  const fileToken = await saveTemporaryUpload(buffer, originalName);

  return {
    sheets: workbook.sheets,
    selectedSheet,
    headerRowIndex,
    columns,
    proposedPriceFormat,
    previewRows,
    fileToken,
    alreadyImported: existingFile
      ? {
          supplierFileId: existingFile.id,
          processedAt: existingFile.processedAt,
          receivedAt: existingFile.receivedAt,
        }
      : null,
  };
}

function readMappedRow(
  row: RawRow,
  mapping: ColumnMapping,
  priceFormat: PriceFormat,
  rowNumber: number,
): { row: ParsedOfferRow | null; error: string | null; warnings: string[] } {
  const productNameRaw = mapping.productName !== undefined ? row[mapping.productName] : null;
  const originalProductName = productNameRaw === null || productNameRaw === undefined ? "" : String(productNameRaw).trim();

  if (!originalProductName) {
    return { row: null, error: "Fila sin nombre de producto.", warnings: [] };
  }

  const extraction = extractProductAttributes(originalProductName);
  if (!extraction) {
    return {
      row: null,
      error: `No se pudo determinar la concentración y/o presentación de "${originalProductName}".`,
      warnings: [],
    };
  }

  const priceRaw = mapping.price !== undefined ? row[mapping.price] : null;
  const price = parsePrice(priceRaw, priceFormat);
  if (price === null) {
    return { row: null, error: `Precio inválido para "${originalProductName}": "${priceRaw}".`, warnings: [] };
  }

  const validation = validateParsedRow({ originalProductName, price, tax: null });
  if (!validation.valid) {
    return { row: null, error: validation.message, warnings: [] };
  }

  const taxRaw = mapping.tax !== undefined ? row[mapping.tax] : null;
  const tax = taxRaw !== null ? parsePrice(taxRaw, priceFormat) : null;

  const availabilityRaw = mapping.availability !== undefined ? row[mapping.availability] : null;
  const stockRaw = mapping.stock !== undefined ? row[mapping.stock] : availabilityRaw;
  const { availability, stock } = normalizeAvailability(stockRaw ?? availabilityRaw);

  const supplierProductCodeRaw = mapping.supplierProductCode !== undefined ? row[mapping.supplierProductCode] : null;
  const supplierProductCode =
    supplierProductCodeRaw === null || supplierProductCodeRaw === undefined ? null : String(supplierProductCodeRaw).trim();

  const laboratoryRaw = mapping.laboratory !== undefined ? row[mapping.laboratory] : null;
  const laboratoryNameRaw = laboratoryRaw === null || laboratoryRaw === undefined ? null : String(laboratoryRaw).trim();
  const laboratoryName = laboratoryNameRaw || null;
  const laboratoryNormalizedName = laboratoryName ? normalizeText(laboratoryName) : null;

  return {
    row: {
      rowNumber,
      supplierProductCode,
      originalProductName,
      normalizedName: buildNormalizedName(extraction.attributes, laboratoryNormalizedName),
      genericKey: buildGenericKey(extraction.attributes),
      attributes: extraction.attributes,
      attributeWarnings: extraction.warnings,
      laboratoryName,
      price,
      tax,
      availability,
      stock,
    },
    error: null,
    warnings: extraction.warnings,
  };
}

export interface ConfirmImportInput {
  fileToken: string;
  supplierId: string;
  sheetName: string;
  headerRowIndex: number;
  mapping: ColumnMapping;
  priceFormat: PriceFormat;
  force?: boolean;
}

export async function confirmSupplierImport(input: ConfirmImportInput): Promise<ImportReport> {
  const { buffer, originalName } = await readTemporaryUpload(input.fileToken);
  const fileHash = hashBuffer(buffer);

  const existingFile = await prisma.supplierFile.findUnique({
    where: { supplierId_fileHash: { supplierId: input.supplierId, fileHash } },
  });
  if (existingFile && !input.force) {
    throw new Error(
      `Este archivo ya fue importado el ${existingFile.receivedAt.toISOString()}. Usa force=true para reprocesarlo.`,
    );
  }

  const workbook = await parseWorkbook(buffer, originalName);
  const allRows = workbook.getRows(input.sheetName);
  const dataRows = allRows.slice(input.headerRowIndex + 1);

  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const parsedRows: ParsedOfferRow[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = input.headerRowIndex + 2 + i; // +1 header, +1 for 1-based display
    const result = readMappedRow(row, input.mapping, input.priceFormat, rowNumber);
    if (result.error) {
      errors.push({ rowNumber, message: result.error });
      return;
    }
    if (result.row) {
      parsedRows.push(result.row);
      for (const w of result.warnings) {
        warnings.push({ rowNumber, message: w });
      }
    }
  });

  const { unique, duplicateGroups } = detectDuplicates(parsedRows);
  for (const group of duplicateGroups) {
    warnings.push({
      rowNumber: group.kept.rowNumber,
      message: `Producto duplicado en el archivo ("${group.kept.originalProductName}"): se conservó la última aparición${
        group.priceConflict ? " (los precios entre duplicados no coincidían)" : ""
      }.`,
    });
  }

  const storagePath = await persistSupplierFile(buffer, input.supplierId, fileHash, originalName);

  const supplierFile = await prisma.supplierFile.upsert({
    where: { supplierId_fileHash: { supplierId: input.supplierId, fileHash } },
    update: {
      status: "PROCESSING",
      totalRows: dataRows.length,
      processedAt: null,
    },
    create: {
      supplierId: input.supplierId,
      originalName,
      fileType: originalName.split(".").pop() ?? "unknown",
      storagePath,
      fileHash,
      status: "PROCESSING",
      totalRows: dataRows.length,
    },
  });

  let newProducts = 0;
  let updatedOffers = 0;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(async (tx) => {
      for (const row of batch) {
        let laboratoryId: string | undefined;
        if (row.laboratoryName) {
          const normalizedLab = normalizeText(row.laboratoryName);
          const laboratory = await tx.laboratory.upsert({
            where: { normalizedName: normalizedLab },
            update: {},
            create: { name: row.laboratoryName, normalizedName: normalizedLab },
          });
          laboratoryId = laboratory.id;
        }

        const product = await tx.product.upsert({
          where: { normalizedName: row.normalizedName },
          update: {},
          create: {
            standardName: row.originalProductName,
            normalizedName: row.normalizedName,
            genericKey: row.genericKey,
            activeIngredient: row.attributes.activeIngredient,
            concentration: row.attributes.concentration,
            concentrationUnit: row.attributes.concentrationUnit,
            dosageForm: row.attributes.dosageForm,
            presentationType: row.attributes.presentationType,
            presentationQuantity: row.attributes.presentationQuantity,
            presentationUnit: row.attributes.presentationUnit,
            presentationDescription: row.originalProductName,
            laboratoryId,
          },
        });

        const existingOffer = await tx.supplierOffer.findUnique({
          where: { supplierId_productId: { supplierId: input.supplierId, productId: product.id } },
        });

        if (!existingOffer) {
          newProducts += 1;
          const offer = await tx.supplierOffer.create({
            data: {
              supplierId: input.supplierId,
              productId: product.id,
              supplierProductCode: row.supplierProductCode,
              price: row.price,
              tax: row.tax,
              availability: row.availability,
              stockQuantity: row.stock,
              sourceFileId: supplierFile.id,
            },
          });
          await tx.priceHistory.create({
            data: { supplierOfferId: offer.id, price: row.price, sourceFileId: supplierFile.id },
          });
        } else {
          updatedOffers += 1;
          const priceChanged = Number(existingOffer.price) !== row.price;
          await tx.supplierOffer.update({
            where: { id: existingOffer.id },
            data: {
              supplierProductCode: row.supplierProductCode,
              price: row.price,
              tax: row.tax,
              availability: row.availability,
              stockQuantity: row.stock,
              sourceFileId: supplierFile.id,
            },
          });
          if (priceChanged) {
            await tx.priceHistory.create({
              data: { supplierOfferId: existingOffer.id, price: row.price, sourceFileId: supplierFile.id },
            });
          }
        }
      }
    });
  }

  await prisma.supplierFile.update({
    where: { id: supplierFile.id },
    data: {
      status: "PROCESSED",
      successRows: unique.length,
      errorRows: errors.length,
      processedAt: new Date(),
    },
  });

  return {
    supplierFileId: supplierFile.id,
    totalRows: dataRows.length,
    importedRows: unique.length,
    newProducts,
    updatedOffers,
    errorRows: errors.length,
    warningRows: warnings.length,
    errors,
    warnings,
  };
}
