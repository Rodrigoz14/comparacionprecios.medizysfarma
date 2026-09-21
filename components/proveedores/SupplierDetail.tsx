"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface OfferRow {
  id: string;
  productName: string;
  dosageForm: string;
  concentration: string;
  concentrationUnit: string;
  presentationQuantity: number;
  presentationUnit: string;
  laboratoryName: string | null;
  supplierProductCode: string | null;
  price: number;
  availability: string;
  stockQuantity: number | null;
}

interface OffersResponse {
  supplier: { id: string; name: string };
  lastFile: { id: string; originalName: string; processedAt: string | null; totalRows: number | null } | null;
  total: number;
  page: number;
  limit: number;
  offers: OfferRow[];
}

const dateFormat = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });
const priceFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const AVAILABILITY_LABEL: Record<string, string> = {
  AVAILABLE: "Disponible",
  UNAVAILABLE: "Sin disponibilidad",
  UNKNOWN: "Sin confirmar",
};

export function SupplierDetail({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<OffersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page) });
      if (query.trim()) params.set("q", query.trim());
      fetch(`/api/suppliers/${supplierId}/offers?${params}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((json) => setData(json as OffersResponse))
        .catch((err) => {
          if (err.name !== "AbortError") setError("No se pudo cargar el catálogo de este proveedor.");
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [supplierId, query, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="flex-1 bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <Link href="/proveedores" className="text-sm text-zinc-500 hover:text-brand-blue">
            ← Proveedores
          </Link>
          <div className="mt-1 flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {data?.supplier.name ?? "Cargando..."}
            </h1>
            <Link
              href="/proveedores/importar"
              className="whitespace-nowrap rounded bg-brand-blue px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy"
            >
              Subir Excel
            </Link>
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {data?.lastFile
              ? `Mostrando el último archivo subido: "${data.lastFile.originalName}" — ${
                  data.lastFile.processedAt ? dateFormat.format(new Date(data.lastFile.processedAt)) : ""
                }`
              : "Este proveedor todavía no tiene ningún archivo procesado."}
          </p>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por producto, ingrediente activo o código..."
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 font-medium">Laboratorio</th>
                <th className="px-4 py-2 font-medium">Código</th>
                <th className="px-4 py-2 font-medium">Precio</th>
                <th className="px-4 py-2 font-medium">Disponibilidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data?.offers.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{o.productName}</p>
                    <p className="text-xs text-zinc-500">
                      {o.dosageForm} — {o.concentration}
                      {o.concentrationUnit} — x{o.presentationQuantity} {o.presentationUnit}
                    </p>
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{o.laboratoryName ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{o.supplierProductCode ?? "—"}</td>
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{priceFormat.format(o.price)}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {AVAILABILITY_LABEL[o.availability] ?? o.availability}
                    {o.stockQuantity !== null ? ` (${o.stockQuantity})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="px-4 py-3 text-xs text-zinc-500">Cargando...</p>}
          {!loading && data && data.offers.length === 0 && (
            <p className="px-4 py-3 text-sm text-zinc-500">
              {query.trim() ? "Ningún producto coincide con la búsqueda." : "Este proveedor no tiene productos vigentes."}
            </p>
          )}
        </div>

        {data && data.total > data.limit && (
          <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages} ({data.total} productos)
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
