"use client";

import { useEffect, useState } from "react";

interface StockItem {
  genericKey: string;
  quantity: number;
  updatedAt: string;
  productName: string;
}

interface ImportReport {
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  distinctProducts: number;
  errors: { text: string; quantity: number; reason: string }[];
}

export function WarehouseStockManager() {
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  function fetchStock(): Promise<StockItem[]> {
    return fetch("/api/warehouse")
      .then((res) => res.json())
      .then((data) => data.items ?? []);
  }

  useEffect(() => {
    fetchStock()
      .then((data) => setItems(data))
      .catch(() => setError("No se pudo cargar el inventario actual."))
      .finally(() => setLoading(false));
  }, []);

  async function handleFileUpload(file: File) {
    setUploading(true);
    setError(null);
    setReport(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/warehouse/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo importar el archivo.");
      setReport(data as ImportReport);
      setItems(await fetchStock());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al importar el archivo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex-1 bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Inventario de bodega</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Sube un Excel con lo que hay en bodega (producto y cantidad). Al comparar precios de una solicitud, lo
            que ya tengas en bodega se descuenta automáticamente — si cubre todo el pedido, ese producto no se
            cotiza; si cubre parte, solo se cotiza lo que falta.
          </p>
        </div>

        <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Subir un archivo nuevo reemplaza por completo el inventario actual (es una foto del inventario de hoy,
            no una suma sobre lo anterior).
          </p>
          <p className="text-xs text-zinc-500">
            El archivo debe tener el producto en una columna y la cantidad disponible en otra (con o sin
            encabezados).
          </p>
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file);
              e.target.value = "";
            }}
            className="text-sm"
          />
          {uploading && <p className="text-xs text-zinc-500">Importando y homologando productos...</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>

        {report && (
          <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Importación completada: {report.matchedRows} de {report.totalRows} filas identificadas (
              {report.distinctProducts} productos distintos en bodega).
            </p>
            {report.errors.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-amber-700 dark:text-amber-400">
                  {report.errors.length} fila(s) no se pudieron identificar y no quedaron en el inventario
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {report.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-medium">{e.text}</span> (cantidad {e.quantity}) — {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Inventario actual</h2>
          {loading && <p className="mt-2 text-xs text-zinc-500">Cargando...</p>}
          {!loading && items && items.length === 0 && (
            <p className="mt-2 text-xs text-zinc-500">Todavía no se ha subido ningún inventario de bodega.</p>
          )}
          {!loading && items && items.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              {items.map((item) => (
                <li key={item.genericKey} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">{item.productName}</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{item.quantity} unidades</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
