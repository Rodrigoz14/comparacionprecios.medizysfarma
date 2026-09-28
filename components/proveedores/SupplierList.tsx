"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Sector } from "@/lib/generated/prisma/client";
import { SECTOR_LABELS, SECTOR_OPTIONS } from "@/lib/sectors";

interface Supplier {
  id: string;
  name: string;
  sectors: Sector[];
  offerCount: number;
  lastUploadAt: string | null;
  lastUploadName: string | null;
}

const dateFormat = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

export function SupplierList() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sectorFilter, setSectorFilter] = useState<Sector | "todos">("todos");

  useEffect(() => {
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((data) => setSuppliers(data.suppliers ?? []))
      .catch(() => setError("No se pudo cargar la lista de proveedores."));
  }, []);

  const filtered =
    suppliers
      ?.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
      .filter((s) => sectorFilter === "todos" || s.sectors.includes(sectorFilter)) ?? null;

  return (
    <div className="flex-1 bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Proveedores</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Consulta los productos y precios vigentes de cada proveedor (según el último Excel que subiste).
            </p>
          </div>
          <Link
            href="/proveedores/importar"
            className="whitespace-nowrap rounded bg-brand-blue px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy"
          >
            Subir Excel
          </Link>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar proveedor..."
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />

        <nav className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {[{ value: "todos" as const, label: "Todos" }, ...SECTOR_OPTIONS].map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setSectorFilter(o.value)}
              aria-current={sectorFilter === o.value ? "page" : undefined}
              className={`-mb-px rounded-t px-3 py-2 text-sm font-medium transition-colors ${
                sectorFilter === o.value
                  ? "border-b-2 border-brand-blue text-brand-blue"
                  : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </nav>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && suppliers === null && <p className="text-sm text-zinc-500">Cargando...</p>}
        {filtered && filtered.length === 0 && (
          <p className="text-sm text-zinc-500">
            {suppliers && suppliers.length === 0
              ? "Todavía no hay proveedores. Sube un Excel para crear el primero."
              : "Ningún proveedor coincide con la búsqueda."}
          </p>
        )}

        {filtered && filtered.length > 0 && (
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {filtered.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/proveedores/${s.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{s.name}</p>
                      {s.sectors.map((sec) => (
                        <span
                          key={sec}
                          className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[11px] font-medium text-brand-blue"
                        >
                          {SECTOR_LABELS[sec]}
                        </span>
                      ))}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {s.lastUploadAt
                        ? `Último archivo: ${s.lastUploadName} — ${dateFormat.format(new Date(s.lastUploadAt))}`
                        : "Sin archivos subidos todavía"}
                    </p>
                  </div>
                  <span className="whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {s.offerCount} producto{s.offerCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
