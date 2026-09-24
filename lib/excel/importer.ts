import { prisma } from "@/lib/db/client";
import { detectColumns, detectHeaderRowIndex } from "@/lib/excel/detector";
import { detectPriceFormat, normalizeAvailability, normalizeExpirationLabel, parsePrice } from "@/lib/excel/normalizer";
import { parseWorkbook } from "@/lib/excel/parser";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";
import { extractProductAttributes, normalizeDosageForm } from "@/lib/matching/extract-attributes";
import { isMeasureUnit, isSealedUnitForm } from "@/lib/pricing/measured-forms";
import { hashBuffer } from "@/lib/excel/storage";
import type {
  AnalyzeResult,
  ColumnMapping,
  ColumnTarget,
  ImportReport,
  ParsedOfferRow,
  PriceFormat,
  RawRow,
  RowIssue,
} from "@/lib/excel/types";
import { detectDuplicates } from "@/lib/excel/duplicate-detector";
import { validateParsedRow } from "@/lib/excel/validator";
import { findSupplierProfile, isZeroStockValue, resolveFixedMapping } from "@/lib/excel/supplier-profiles";

const PREVIEW_ROW_COUNT = 10;
const BATCH_SIZE = 100;
const TRANSACTION_TIMEOUT_MS = 30000;

export async function analyzeSupplierFile(
  buffer: Buffer,
  originalName: string,
  supplierId: string,
): Promise<AnalyzeResult> {
  const supplier = await prisma.supplier.findUniqueOrThrow({
    where: { id: supplierId },
    select: { name: true },
  });
  const profile = findSupplierProfile(supplier.name);

  const workbook = await parseWorkbook(buffer, originalName);
  if (workbook.sheets.length === 0) {
    throw new Error("El archivo no contiene hojas legibles.");
  }
  const selectedSheet = workbook.sheets[0].name;
  const rows = workbook.getRows(selectedSheet);

  const headerRowIndex = detectHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] ?? {};
  const columns = detectColumns(headerRow);
  const dataRows = rows.slice(headerRowIndex + 1);

  let fixedProfileResult: AnalyzeResult["fixedProfile"] = null;

  if (profile) {
    // Proveedor con formato de columnas conocido: se ignora la detección
    // genérica por alias y se buscan las columnas por su nombre exacto
    // (Sección: lib/excel/supplier-profiles.ts). Las columnas que no forman
    // parte del perfil quedan sin mapear a propósito ("las demás columnas
    // no se van a tomar").
    const { mapping: fixedMapping, missingColumns } = resolveFixedMapping(profile, headerRow);
    for (const col of columns) {
      const target = (Object.entries(fixedMapping) as [ColumnTarget, number][]).find(
        ([, index]) => index === col.index,
      )?.[0];
      col.proposedTarget = target ?? null;
      col.confidence = target ? 1 : 0;
    }
    fixedProfileResult = { key: profile.key, missingColumns, previewLabels: profile.previewLabels };
  }

  const priceColumn = columns.find((c) => c.proposedTarget === "price");
  const priceSamples = priceColumn
    ? dataRows.slice(0, 30).map((r) => r[priceColumn.index])
    : [];
  const proposedPriceFormat = detectPriceFormat(priceSamples);

  // El nombre de la columna no basta para confiar en ella: en un archivo real de
  // Disfarma, "VLR_TOPE_REG" (un techo regulatorio, casi siempre 0 o distinto al
  // precio real) coincidió por contener "vlr" y se propuso como precio en vez de
  // "Ger_EPS" (el precio real, sin ningún alias reconocible en su nombre) — miles
  // de filas terminaron sin importarse (precio 0 rechazado) o con precio
  // equivocado. Si la mayoría de la muestra es cero, no se propone la columna:
  // mejor obligar a elegir a mano que corromper el catálogo en silencio. No
  // aplica cuando el proveedor tiene un perfil fijo: ahí la columna se
  // localizó por su nombre exacto, no por adivinar, así que no hay nada que
  // desconfiar.
  if (priceColumn && !profile) {
    const parsedSamples = priceSamples
      .map((v) => parsePrice(v, proposedPriceFormat))
      .filter((v): v is number => v !== null);
    const zeroCount = parsedSamples.filter((v) => v <= 0).length;
    if (parsedSamples.length > 0 && zeroCount / parsedSamples.length > 0.3) {
      priceColumn.proposedTarget = null;
      priceColumn.confidence = 0;
    }
  }

  const mapping: ColumnMapping = {};
  for (const col of columns) {
    if (col.proposedTarget) mapping[col.proposedTarget] = col.index;
  }

  // Las filas sin existencia (stock/cantidad <= 0) no deben ni verse en la
  // previsualización cuando el perfil del proveedor así lo pide (confirmado
  // con el cliente) -- mismo criterio que se aplica luego al importar de verdad.
  const stockColumnIndex = mapping.stock;
  const visibleDataRows =
    profile?.excludeZeroStock && stockColumnIndex !== undefined
      ? dataRows.filter((r) => !isZeroStockValue(r[stockColumnIndex]))
      : dataRows;

  const previewRows = visibleDataRows.slice(0, PREVIEW_ROW_COUNT);

  const fileHash = hashBuffer(buffer);
  const existingFile = await prisma.supplierFile.findUnique({
    where: { supplierId_fileHash: { supplierId, fileHash } },
  });

  return {
    sheets: workbook.sheets,
    selectedSheet,
    headerRowIndex,
    columns,
    proposedPriceFormat,
    previewRows,
    fixedProfile: fixedProfileResult,
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
  priceIsPerUnit: boolean,
): { row: ParsedOfferRow | null; error: string | null; warnings: string[] } {
  const productNameRaw = mapping.productName !== undefined ? row[mapping.productName] : null;
  const originalProductName = productNameRaw === null || productNameRaw === undefined ? "" : String(productNameRaw).trim();

  if (!originalProductName) {
    return { row: null, error: "Fila sin nombre de producto.", warnings: [] };
  }

  // Algunos proveedores (p. ej. Ramédicas) reportan la presentación en su propia
  // columna ("CAJA X 10 AMPOLLAS X 3ML") en vez de incluirla en la descripción del
  // producto. Se concatena para que el extractor encuentre la cantidad ("X10").
  const presentationRaw = mapping.presentation !== undefined ? row[mapping.presentation] : null;
  const presentationText = presentationRaw === null || presentationRaw === undefined ? "" : String(presentationRaw).trim();
  const extractionInput = presentationText ? `${originalProductName} ${presentationText}` : originalProductName;

  // Cuando el proveedor reporta precio POR UNIDAD (priceIsPerUnit), no hace
  // falta rechazar la fila si no se encuentra un conteo de empaque explícito
  // (ni en el nombre ni en la columna de presentación): el precio de empaque
  // simplemente se calcula como 1 x precio unidad -- confirmado con el
  // cliente (2026-09-24), antes esas filas se descartaban del todo. Para
  // proveedores que reportan precio de EMPAQUE (priceIsPerUnit=false) sigue
  // exigiéndose el conteo, porque ahí sí se usa para derivar el precio por
  // unidad (división) en otras partes del motor de precios, y asumir 1
  // silenciosamente distorsionaría ese cálculo.
  const extraction = extractProductAttributes(extractionInput, { requirePresentation: !priceIsPerUnit });
  if (!extraction) {
    return {
      row: null,
      error: `No se pudo determinar la concentración y/o presentación de "${originalProductName}".`,
      warnings: [],
    };
  }

  // Si el proveedor reporta la forma farmacéutica en su propia columna, es más
  // confiable que adivinarla por palabras clave del nombre — pero igual hay que
  // normalizarla al mismo vocabulario controlado (DOSAGE_FORM_MAP), o dos
  // productos del mismo genérico dejan de coincidir por comparar texto crudo
  // ("SOLUCION INYECTABLE") contra el valor normalizado ("Solución").
  const dosageFormRaw = mapping.dosageForm !== undefined ? row[mapping.dosageForm] : null;
  const dosageFormText = dosageFormRaw === null || dosageFormRaw === undefined ? "" : String(dosageFormRaw).trim();
  if (dosageFormText) {
    const normalizedDosageForm = normalizeDosageForm(dosageFormText);
    extraction.attributes.dosageForm = normalizedDosageForm ?? dosageFormText;
    extraction.warnings = extraction.warnings.filter((w) => !w.includes("forma farmacéutica"));
    if (!normalizedDosageForm) {
      extraction.warnings.push(
        `Forma farmacéutica de la columna ("${dosageFormText}") no reconocida en el vocabulario controlado; se usó tal cual.`,
      );
    }
  }

  const priceRaw = mapping.price !== undefined ? row[mapping.price] : null;
  const unitOrPackagePrice = parsePrice(priceRaw, priceFormat);
  if (unitOrPackagePrice === null) {
    return { row: null, error: `Precio inválido para "${originalProductName}": "${priceRaw}".`, warnings: [] };
  }

  // Algunos proveedores solo reportan el precio de UNA unidad suelta, no del
  // empaque completo (confirmado con el cliente, 2026-09-22) -- se
  // multiplica por las unidades del empaque para calcular el precio de
  // empaque completo, como el resto del motor de precios espera. No aplica
  // a ampollas/viales: esos siempre se compran como 1 unidad sellada, sin
  // importar su volumen (mismo criterio que selection-engine.ts). Tampoco
  // aplica a presentaciones medidas en ml/g (jarabe, solución, crema...)
  // cuando no se nombran unidades aparte: ahí "240ML" es el volumen del
  // único frasco, no una cantidad de envases -- el precio reportado YA es
  // el del frasco completo (confirmado con el cliente, 2026-09-24), no se
  // multiplica por el volumen. El precio por unidad tal como vino en el
  // archivo se conserva sin tocar (nunca se vuelve a derivar por división
  // al mostrarlo) -- confirmado con el cliente: "el precio unitario no se
  // debe calcular, ya viene en el excel".
  const unitPriceAsImported = priceIsPerUnit ? unitOrPackagePrice : null;
  const price =
    priceIsPerUnit &&
    !isSealedUnitForm(extraction.attributes.dosageForm) &&
    !isMeasureUnit(extraction.attributes.presentationUnit)
      ? Math.round(unitOrPackagePrice * extraction.attributes.presentationQuantity * 100) / 100
      : unitOrPackagePrice;

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

  const expirationLabelRaw = mapping.expirationDate !== undefined ? row[mapping.expirationDate] : null;
  const expirationLabel = normalizeExpirationLabel(expirationLabelRaw);

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
      unitPriceAsImported,
      tax,
      availability,
      stock,
      expirationLabel,
    },
    error: null,
    warnings: extraction.warnings,
  };
}

export interface ConfirmImportInput {
  buffer: Buffer;
  originalName: string;
  /// URL del archivo en Vercel Blob (almacenamiento real, persistente y
  /// accesible desde cualquier instancia) -- reemplaza la copia local en
  /// disco de antes, que no sobrevivía entre peticiones en un entorno
  /// serverless. Puede ser null si el archivo se subió por otra vía.
  storagePath: string | null;
  supplierId: string;
  sheetName: string;
  headerRowIndex: number;
  mapping: ColumnMapping;
  priceFormat: PriceFormat;
  force?: boolean;
}

export async function confirmSupplierImport(input: ConfirmImportInput): Promise<ImportReport> {
  const { buffer, originalName } = input;
  const fileHash = hashBuffer(buffer);

  const existingFile = await prisma.supplierFile.findUnique({
    where: { supplierId_fileHash: { supplierId: input.supplierId, fileHash } },
  });
  if (existingFile && !input.force) {
    throw new Error(
      `Este archivo ya fue importado el ${existingFile.receivedAt.toISOString()}. Usa force=true para reprocesarlo.`,
    );
  }

  const supplier = await prisma.supplier.findUniqueOrThrow({
    where: { id: input.supplierId },
    select: { name: true },
  });
  const profile = findSupplierProfile(supplier.name);
  const stockColumnIndex = input.mapping.stock;

  const workbook = await parseWorkbook(buffer, originalName);
  // Ni ExcelJS ni SheetJS distinguen filas ocultas por un filtro de las
  // demás (el `eachRow`/`sheet_to_json` de ambos recorre toda la hoja tal
  // como está guardada) -- un filtro activo en el archivo no oculta ninguna
  // fila de la importación, ya se analiza el documento completo.
  const allRows = workbook.getRows(input.sheetName);
  const dataRows = allRows.slice(input.headerRowIndex + 1);

  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const parsedRows: ParsedOfferRow[] = [];
  let excludedRows = 0;

  dataRows.forEach((row, i) => {
    const rowNumber = input.headerRowIndex + 2 + i; // +1 header, +1 for 1-based display

    // Filas sin existencia (stock/cantidad <= 0): se excluyen del todo, no
    // se guardan ni cuentan como error (confirmado con el cliente,
    // 2026-09-22, mismo criterio que Bodega para existencias en 0).
    if (profile?.excludeZeroStock && stockColumnIndex !== undefined && isZeroStockValue(row[stockColumnIndex])) {
      excludedRows += 1;
      return;
    }

    const result = readMappedRow(row, input.mapping, input.priceFormat, rowNumber, profile?.priceIsPerUnit ?? false);
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
      storagePath: input.storagePath,
      fileHash,
      status: "PROCESSING",
      totalRows: dataRows.length,
    },
  });

  // Resolver laboratorios una sola vez antes de procesar filas: con miles de
  // filas repitiendo el mismo laboratorio, hacer upsert() por cada fila dentro
  // de una transaccion por lotes provoca fallos intermitentes del motor de
  // consultas de Prisma ("No record was found for an upsert").
  const uniqueLabNames = [...new Set(unique.map((r) => r.laboratoryName).filter((n): n is string => Boolean(n)))];
  const laboratoryIdByNormalizedName = new Map<string, string>();
  for (const labName of uniqueLabNames) {
    const normalizedLab = normalizeText(labName);
    const laboratory = await prisma.laboratory.upsert({
      where: { normalizedName: normalizedLab },
      update: {},
      create: { name: labName, normalizedName: normalizedLab },
    });
    laboratoryIdByNormalizedName.set(normalizedLab, laboratory.id);
  }

  let newProducts = 0;
  let updatedOffers = 0;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(async (tx) => {
      for (const row of batch) {
        const laboratoryId = row.laboratoryName
          ? laboratoryIdByNormalizedName.get(normalizeText(row.laboratoryName))
          : undefined;

        // normalizedName ya codifica ingrediente+concentracion+forma+presentacion+lab,
        // asi que dos filas que coincidan en esa clave necesariamente coinciden en
        // estos atributos: actualizarlos en cada reimportacion es seguro (idempotente)
        // y corrige datos si una version anterior del archivo tenia un error.
        const productAttributes = {
          standardName: row.originalProductName,
          activeIngredient: row.attributes.activeIngredient,
          ingredientKey: canonicalizeIngredient(row.attributes.activeIngredient),
          concentration: row.attributes.concentration,
          concentrationUnit: row.attributes.concentrationUnit,
          dosageForm: row.attributes.dosageForm,
          presentationType: row.attributes.presentationType,
          presentationQuantity: row.attributes.presentationQuantity,
          presentationUnit: row.attributes.presentationUnit,
          presentationDescription: row.originalProductName,
          laboratoryId,
        };

        const product = await tx.product.upsert({
          where: { normalizedName: row.normalizedName },
          update: productAttributes,
          create: {
            normalizedName: row.normalizedName,
            genericKey: row.genericKey,
            ...productAttributes,
          },
        });

        // La identidad real de una oferta es (proveedor, producto, código,
        // vigencia) -- un mismo proveedor puede reportar más de una oferta
        // para el mismo producto homologado, con un código propio distinto
        // O el mismo código pero distinto lote/vigencia (confirmado con el
        // cliente, 2026-09-23: dos filas con el mismo código y "SUPERIOR A
        // 12 MESES" vs "FECHA CORTA MARZO" son lotes reales distintos, no
        // duplicadas a descartar). Sin ninguno de los dos datos, se sigue
        // agrupando solo por producto, igual que antes.
        const existingOffer = await tx.supplierOffer.findFirst({
          where: {
            supplierId: input.supplierId,
            productId: product.id,
            supplierProductCode: row.supplierProductCode,
            expirationLabel: row.expirationLabel,
          },
        });

        if (!existingOffer) {
          newProducts += 1;
          const offer = await tx.supplierOffer.create({
            data: {
              supplierId: input.supplierId,
              productId: product.id,
              supplierProductCode: row.supplierProductCode,
              price: row.price,
              unitPriceAsImported: row.unitPriceAsImported,
              tax: row.tax,
              availability: row.availability,
              stockQuantity: row.stock,
              expirationLabel: row.expirationLabel,
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
              unitPriceAsImported: row.unitPriceAsImported,
              tax: row.tax,
              availability: row.availability,
              stockQuantity: row.stock,
              expirationLabel: row.expirationLabel,
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
    }, { timeout: TRANSACTION_TIMEOUT_MS });
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
    excludedRows,
    errors,
    warnings,
  };
}
