"use client";

import { useState } from "react";

interface ItemLine {
  text: string;
  quantity: number;
}

interface OfferOption {
  supplierOfferId: string;
  supplierId: string;
  supplierName: string;
  laboratoryName: string | null;
  unitPrice: number;
  availability: string;
  eligible: boolean;
  discardReason: string | null;
}

interface ItemResult {
  itemId: string;
  originalText: string;
  requestedQuantity: number;
  match: {
    decision: "MATCH" | "REVIEW" | "NO_MATCH";
    confidence: number;
    reasons: string[];
  };
  pricing: {
    status: "SELECTED" | "REVIEW" | "NOT_FOUND" | "NO_STOCK" | "NO_VALID_OFFER";
    selected: OfferOption | null;
    alternatives: OfferOption[];
    unitPrice: number | null;
    totalPrice: number | null;
    savings: number | null;
    reason: string;
  };
}

const STATUS_LABEL: Record<ItemResult["pricing"]["status"], string> = {
  SELECTED: "Seleccionado",
  REVIEW: "Requiere revisión",
  NOT_FOUND: "No encontrado",
  NO_STOCK: "Sin disponibilidad",
  NO_VALID_OFFER: "Sin oferta válida",
};

const STATUS_COLOR: Record<ItemResult["pricing"]["status"], string> = {
  SELECTED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  NOT_FOUND: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  NO_STOCK: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  NO_VALID_OFFER: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const formatCOP = (value: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

export function RequestWizard() {
  const [customerName, setCustomerName] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([{ text: "", quantity: 1 }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ItemResult[] | null>(null);

  function updateLine(index: number, patch: Partial<ItemLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { text: "", quantity: 1 }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setResults(null);
    try {
      const items = lines.filter((l) => l.text.trim() !== "");
      const res = await fetch("/api/customer-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al procesar la solicitud.");
      setResults(data.items as ItemResult[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setSubmitting(false);
    }
  }

  const totalCotizado = results
    ? results.reduce((sum, r) => sum + (r.pricing.totalPrice ?? 0), 0)
    : 0;
  const totalAhorro = results ? results.reduce((sum, r) => sum + (r.pricing.savings ?? 0), 0) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Nueva solicitud de cliente</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Escribe los productos que pide el cliente, con la cantidad de cada uno.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente</label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Nombre del cliente"
            className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={line.text}
                onChange={(e) => updateLine(i, { text: e.target.value })}
                placeholder="Ej: Acetaminofén 500 mg x 100"
                className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                className="w-24 rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
                className="rounded border border-zinc-300 px-3 text-sm text-zinc-500 disabled:opacity-30 dark:border-zinc-700"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addLine}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          + Agregar producto
        </button>

        <div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !customerName.trim() || lines.every((l) => !l.text.trim())}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {submitting ? "Analizando..." : "Comparar precios"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {results && (
        <section className="space-y-4">
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Total cotizado (precio de compra)</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-50">{formatCOP(totalCotizado)}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Ahorro estimado frente a la oferta más cara</span>
              <span className="font-semibold text-green-700 dark:text-green-400">{formatCOP(totalAhorro)}</span>
            </div>
          </div>

          {results.map((r) => (
            <div key={r.itemId} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">{r.originalText}</p>
                  <p className="text-xs text-zinc-500">Cantidad solicitada: {r.requestedQuantity}</p>
                </div>
                <span className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${STATUS_COLOR[r.pricing.status]}`}>
                  {STATUS_LABEL[r.pricing.status]}
                </span>
              </div>

              {r.pricing.selected && (
                <div className="mt-3 rounded bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                  <p>
                    <span className="font-medium">{r.pricing.selected.supplierName}</span>
                    {r.pricing.selected.laboratoryName ? ` (${r.pricing.selected.laboratoryName})` : ""} —{" "}
                    {formatCOP(r.pricing.selected.unitPrice)} c/u ={" "}
                    <span className="font-semibold">{formatCOP(r.pricing.totalPrice ?? 0)}</span>
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">{r.pricing.reason}</p>
                </div>
              )}

              {!r.pricing.selected && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{r.pricing.reason}</p>}

              {r.pricing.alternatives.length > 1 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-zinc-500">
                    Ver {r.pricing.alternatives.length} ofertas consideradas
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {r.pricing.alternatives.map((a) => (
                      <li key={a.supplierOfferId}>
                        {a.eligible ? "✓" : "✗"} {a.supplierName}
                        {a.laboratoryName ? ` (${a.laboratoryName})` : ""} — {formatCOP(a.unitPrice)}
                        {a.discardReason ? ` — ${a.discardReason}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
