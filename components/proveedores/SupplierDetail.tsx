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
  isMeasureUnit: boolean;
  purchaseQuantity: number;
  purchaseUnit: string;
  laboratoryName: string | null;
  supplierProductCode: string | null;
  price: number;
  unitPrice: number;
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

type SortKey = "product" | "laboratory" | "unitPrice" | "availability";
type SortDir = "asc" | "desc";

const dateFormat = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });
const priceFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
// El precio unitario suele quedar en centavos de peso (precio de empaque
// dividido entre las unidades que trae) -- con 0 decimales redondeaba a "$0"
// y parecía un error, igual que en Solicitudes (lib/pricing/format.ts).
const unitPriceFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });

const AVAILABILITY_LABEL: Record<string, string> = {
  AVAILABLE: "Disponible",
  UNAVAILABLE: "Sin disponibilidad",
  UNKNOWN: "Sin confirmar",
};

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "product", label: "Producto" },
  { key: "laboratory", label: "Laboratorio" },
  { key: "unitPrice", label: "Precio unitario" },
  { key: "availability", label: "Disponibilidad" },
];

export function SupplierDetail({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<OffersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>("product");
  const [dir, setDir] = useState<SortDir>("asc");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), sort, dir });
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
  }, [supplierId, query, page, sort, dir]);

  function toggleSort(key: SortKey) {
    setPage(1);
    if (key === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDir("asc");
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="flex-1 bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="mx-auto max-w-6xl space-y-6">
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
          <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className="px-4 py-2 font-medium">
                    <button
                      onClick={() => toggleSort(col.key)}
                      className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-50"
                    >
                      {col.label}
                      {sort === col.key && <span>{dir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  </th>
                ))}
                <th className="whitespace-nowrap px-4 py-2 font-medium">Código</th>
                <th className="whitespace-nowrap px-4 py-2 font-medium">No. unidades</th>
                <th className="whitespace-nowrap px-4 py-2 font-medium">Precio empaque</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data?.offers.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{o.productName}</p>
                    <p className="text-xs text-zinc-500">
                      {o.dosageForm} — {o.concentration}
                      {o.concentrationUnit}
                      {/* La columna "No. unidades" nunca muestra una medida (ml/g), solo
                          unidades comprables -- el volumen/peso real sigue siendo dato
                          útil para no confundir, p. ej., un frasco de 30ml con uno de
                          120ml, así que se muestra aquí junto al nombre. */}
                      {o.isMeasureUnit && o.presentationQuantity > 1
                        ? ` — ${o.presentationQuantity} ${o.presentationUnit}`
                        : ""}
                    </p>
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{o.laboratoryName ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                    {unitPriceFormat.format(o.unitPrice)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {AVAILABILITY_LABEL[o.availability] ?? o.availability}
                    {o.stockQuantity !== null ? ` (${o.stockQuantity})` : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">{o.supplierProductCode ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {o.purchaseQuantity} {o.purchaseUnit}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">{priceFormat.format(o.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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
