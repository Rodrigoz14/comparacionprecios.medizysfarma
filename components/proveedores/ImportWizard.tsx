"use client";

import { useEffect, useState } from "react";
import type { AnalyzeResult, ColumnMapping, ColumnTarget, ImportReport, PriceFormat } from "@/lib/excel/types";

interface Supplier {
  id: string;
  name: string;
}

const TARGET_LABELS: Record<ColumnTarget | "none", string> = {
  none: "(no usar)",
  supplierProductCode: "Código del proveedor",
  productName: "Nombre del producto",
  presentation: "Presentación",
  dosageForm: "Forma farmacéutica",
  laboratory: "Laboratorio",
  price: "Precio",
  tax: "IVA",
  availability: "Disponibilidad",
  stock: "Stock",
};

const TARGET_OPTIONS: (ColumnTarget | "none")[] = [
  "none",
  "productName",
  "presentation",
  "dosageForm",
  "price",
  "supplierProductCode",
  "laboratory",
  "availability",
  "stock",
  "tax",
];

const PRICE_FORMAT_OPTIONS: { label: string; value: PriceFormat }[] = [
  { label: "Colombia: $10.500,00 (miles con punto, decimales con coma)", value: { thousands: ".", decimal: "," } },
  { label: "Internacional: 10,500.00 (miles con coma, decimales con punto)", value: { thousands: ",", decimal: "." } },
  { label: "Sin miles: 10500.00", value: { thousands: "none", decimal: "." } },
];

function samePriceFormat(a: PriceFormat, b: PriceFormat) {
  return a.thousands === b.thousands && a.decimal === b.decimal;
}

export function ImportWizard() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);

  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [priceFormat, setPriceFormat] = useState<PriceFormat>({ thousands: ".", decimal: "," });
  const [force, setForce] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  useEffect(() => {
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((data) => setSuppliers(data.suppliers ?? []));
  }, []);

  async function handleAnalyze() {
    if (!file || !supplierId) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setReport(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("supplierId", supplierId);
      const res = await fetch("/api/suppliers/import/analyze", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al analizar el archivo.");

      const result = data as AnalyzeResult;
      setAnalysis(result);
      const initialMapping: ColumnMapping = {};
      for (const col of result.columns) {
        if (col.proposedTarget) initialMapping[col.proposedTarget] = col.index;
      }
      setMapping(initialMapping);
      setPriceFormat(result.proposedPriceFormat);
      setForce(false);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleColumnTargetChange(columnIndex: number, target: ColumnTarget | "none") {
    setMapping((prev) => {
      const next: ColumnMapping = {};
      for (const [key, value] of Object.entries(prev)) {
        if (value !== columnIndex) next[key] = value;
      }
      if (target !== "none") next[target] = columnIndex;
      return next;
    });
  }

  async function handleConfirm() {
    if (!analysis) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await fetch("/api/suppliers/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileToken: analysis.fileToken,
          supplierId,
          sheetName: analysis.selectedSheet,
          headerRowIndex: analysis.headerRowIndex,
          mapping,
          priceFormat,
          force,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al importar.");
      setReport(data as ImportReport);
      setAnalysis(null);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Importar lista de proveedor</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Sube un archivo .xlsx o .csv con los precios del proveedor.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Proveedor</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona un proveedor</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Archivo</label>
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={!file || !supplierId || analyzing}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {analyzing ? "Analizando..." : "Analizar archivo"}
        </button>

        {analyzeError && <p className="text-sm text-red-600">{analyzeError}</p>}
      </section>

      {analysis && (
        <section className="space-y-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          {analysis.alreadyImported && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <p>
                Este archivo ya fue importado el{" "}
                {new Date(analysis.alreadyImported.receivedAt).toLocaleString()}.
              </p>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Reprocesar de todas formas
              </label>
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Hoja: {analysis.selectedSheet}
            </h2>
            <p className="text-xs text-zinc-500">
              Encabezados detectados en la fila {analysis.headerRowIndex + 1}.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Mapeo de columnas</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="pb-1">Columna del archivo</th>
                  <th className="pb-1">Campo</th>
                </tr>
              </thead>
              <tbody>
                {analysis.columns.map((col) => {
                  const currentTarget =
                    (Object.entries(mapping).find(([, idx]) => idx === col.index)?.[0] as ColumnTarget | undefined) ??
                    "none";
                  return (
                    <tr key={col.index} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1 pr-4">{col.header || `(columna ${col.index + 1})`}</td>
                      <td className="py-1">
                        <select
                          value={currentTarget}
                          onChange={(e) =>
                            handleColumnTargetChange(col.index, e.target.value as ColumnTarget | "none")
                          }
                          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          {TARGET_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {TARGET_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Formato de precio</label>
            <select
              value={PRICE_FORMAT_OPTIONS.findIndex((o) => samePriceFormat(o.value, priceFormat))}
              onChange={(e) => setPriceFormat(PRICE_FORMAT_OPTIONS[Number(e.target.value)].value)}
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {PRICE_FORMAT_OPTIONS.map((o, i) => (
                <option key={o.label} value={i}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Vista previa ({analysis.previewRows.length} filas)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  {analysis.previewRows.map((row, i) => (
                    <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                      {analysis.columns.map((col) => (
                        <td key={col.index} className="whitespace-nowrap px-2 py-1">
                          {String(row[col.index] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button
            onClick={handleConfirm}
            disabled={confirming || (Boolean(analysis.alreadyImported) && !force)}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {confirming ? "Importando..." : "Confirmar importación"}
          </button>
          {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
        </section>
      )}

      {report && (
        <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Importación completada</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Stat label="Filas encontradas" value={report.totalRows} />
            <Stat label="Filas importadas" value={report.importedRows} />
            <Stat label="Productos nuevos" value={report.newProducts} />
            <Stat label="Ofertas actualizadas" value={report.updatedOffers} />
            <Stat label="Errores" value={report.errorRows} />
            <Stat label="Advertencias" value={report.warningRows} />
          </dl>

          {report.errors.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-red-700 dark:text-red-400">Errores</h3>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
                {report.errors.map((e, i) => (
                  <li key={i}>
                    Fila {e.rowNumber}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.warnings.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-amber-700 dark:text-amber-400">Advertencias</h3>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
                {report.warnings.map((w, i) => (
                  <li key={i}>
                    Fila {w.rowNumber}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}
