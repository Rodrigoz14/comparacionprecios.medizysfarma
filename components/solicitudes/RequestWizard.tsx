"use client";

import { useEffect, useRef, useState } from "react";
import { parsePastedList } from "@/lib/solicitudes/parse-pasted-list";

interface ItemLine {
  text: string;
  quantity: number;
}

interface OfferOption {
  supplierOfferId: string;
  supplierId: string;
  supplierName: string;
  laboratoryName: string | null;
  packageSize: number;
  presentationUnit: string;
  packagePrice: number;
  unitPrice: number;
  packagesNeeded: number;
  totalCost: number;
  availability: string;
  eligible: boolean;
  discardReason: string | null;
}

interface MatchCandidate {
  product: {
    id: string;
    standardName: string;
    dosageForm: string;
    concentration: string;
    concentrationUnit: string;
  };
}

interface ItemResult {
  itemId: string;
  originalText: string;
  requestedQuantity: number;
  match: {
    decision: "MATCH" | "REVIEW" | "NO_MATCH";
    confidence: number;
    reasons: string[];
    candidates: MatchCandidate[];
  };
  pricing: {
    status: "SELECTED" | "REVIEW" | "NOT_FOUND" | "NO_STOCK" | "NO_VALID_OFFER" | "COVERED_BY_STOCK" | "EXCLUDED";
    warehouseStock: number | null;
    quantityToPurchase: number | null;
    selected: OfferOption | null;
    alternatives: OfferOption[];
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
  COVERED_BY_STOCK: "Cubierto por bodega",
  EXCLUDED: "Excluido — no se compra",
};

const STATUS_COLOR: Record<ItemResult["pricing"]["status"], string> = {
  SELECTED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  NOT_FOUND: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  NO_STOCK: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  NO_VALID_OFFER: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  COVERED_BY_STOCK: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  EXCLUDED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const formatCOP = (value: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

// El precio unitario es solo de referencia (no es lo que se paga, ni se
// compra por unidad) y suele quedar en centavos de peso -- con 0 decimales
// redondeaba a "$0" y parecía un error. Se usa solo donde se muestra ese
// precio de referencia, nunca para el total que sí se paga.
const formatUnitCOP = (value: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 }).format(value);

type InputMode = "manual" | "paste" | "file";

const CUSTOMERS = ["Salud Vital", "Clinica Chinita", "Hospital Las Nieves/Los Santos", "Salud Darien"];

interface ProductSuggestion {
  id: string;
  standardName: string;
  dosageForm: string;
  concentration: string;
  concentrationUnit: string;
  presentationQuantity: number | null;
  presentationUnit: string;
}

function ProductNameInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const skipNextSearch = useRef(true);

  useEffect(() => {
    // Al montar con un valor ya puesto (una fila que vino de "Subir Excel" o
    // "Pegar lista", no escrita a mano) no se busca automáticamente -- con un
    // archivo de muchas filas, cada campo disparaba su propia búsqueda al
    // mismo tiempo, inundando el catálogo con cientos de peticiones
    // simultáneas y tumbando la pestaña del navegador (bug real). Solo se
    // busca cuando el valor cambia por algo que el usuario efectivamente
    // escribió o eligió después de montado el campo.
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/products/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((data) => setSuggestions(data.products ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  function handleSelect(s: ProductSuggestion) {
    onChange(s.standardName);
    setOpen(false);
  }

  return (
    <div className="relative flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {open && value.trim().length >= 2 && (loading || suggestions.length > 0) && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded border border-zinc-300 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {loading && suggestions.length === 0 && (
            <li className="px-3 py-2 text-xs text-zinc-500">Buscando...</li>
          )}
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="block text-zinc-900 dark:text-zinc-50">{s.standardName}</span>
                <span className="block text-xs text-zinc-500">
                  {s.dosageForm} — {s.concentration}
                  {s.concentrationUnit}
                  {s.presentationQuantity ? ` x${s.presentationQuantity} ${s.presentationUnit}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RequestWizard() {
  const [customerName, setCustomerName] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([{ text: "", quantity: 1 }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ItemResult[] | null>(null);
  const [customerRequestId, setCustomerRequestId] = useState<string | null>(null);

  const [inputMode, setInputMode] = useState<InputMode>("manual");
  const [pasteText, setPasteText] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [selectingItemId, setSelectingItemId] = useState<string | null>(null);
  // Con una lista larga (Excel de muchas filas), dejar los campos de edición
  // renderizados a la vez que los resultados duplicaba el trabajo del
  // navegador (cientos de campos editables + cientos de tarjetas de
  // resultado al mismo tiempo) -- causa real de que la pestaña se cerrara
  // ("This page couldn't load") al comparar precios de un archivo grande.
  // Una vez hay resultados, se oculta el formulario; "Editar productos" lo
  // vuelve a mostrar sin perder lo ya cotizado.
  const [formCollapsed, setFormCollapsed] = useState(false);

  function updateLine(index: number, patch: Partial<ItemLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { text: "", quantity: 1 }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function handleParsePaste() {
    const parsed = parsePastedList(pasteText);
    if (parsed.length > 0) setLines(parsed);
  }

  async function handleFileUpload(file: File) {
    setFileLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/customer-requests/parse-file", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo leer el archivo.");
      const items = data.items as ItemLine[];
      if (items.length === 0) throw new Error("No se encontraron productos en el archivo.");
      setLines(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al leer el archivo.");
    } finally {
      setFileLoading(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setResults(null);
    setCustomerRequestId(null);
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
      setCustomerRequestId(data.customerRequestId as string);
      setFormCollapsed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectCandidate(itemId: string, productId: string) {
    setSelectingItemId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/customer-requests/items/${itemId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo confirmar el producto elegido.");
      // Se conserva la lista original de candidatos (el servidor la devuelve
      // vacía tras confirmar) para poder volver a elegir otro más adelante,
      // por si el usuario se equivocó de opción.
      setResults((prev) =>
        prev
          ? prev.map((r) =>
              r.itemId === itemId ? { ...r, match: { ...data.match, candidates: r.match.candidates }, pricing: data.pricing } : r,
            )
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al confirmar el producto.");
    } finally {
      setSelectingItemId(null);
    }
  }

  async function handleNoneOfAbove(itemId: string) {
    setSelectingItemId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/customer-requests/items/${itemId}/none-of-above`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo marcar el ítem.");
      setResults((prev) =>
        prev
          ? prev.map((r) =>
              r.itemId === itemId ? { ...r, match: { ...data.match, candidates: r.match.candidates }, pricing: data.pricing } : r,
            )
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al marcar el ítem.");
    } finally {
      setSelectingItemId(null);
    }
  }

  async function handleSelectOffer(itemId: string, supplierOfferId: string) {
    setSelectingItemId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/customer-requests/items/${itemId}/select-offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierOfferId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cambiar la oferta seleccionada.");
      setResults((prev) => (prev ? prev.map((r) => (r.itemId === itemId ? { ...r, pricing: data.pricing } : r)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al cambiar la oferta.");
    } finally {
      setSelectingItemId(null);
    }
  }

  async function handleExcludeOffer(itemId: string) {
    setSelectingItemId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/customer-requests/items/${itemId}/exclude-offer`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo excluir el ítem.");
      setResults((prev) => (prev ? prev.map((r) => (r.itemId === itemId ? { ...r, pricing: data.pricing } : r)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al excluir el ítem.");
    } finally {
      setSelectingItemId(null);
    }
  }

  const totalCotizado = results
    ? results.reduce((sum, r) => sum + (r.pricing.totalPrice ?? 0), 0)
    : 0;
  const totalAhorro = results ? results.reduce((sum, r) => sum + (r.pricing.savings ?? 0), 0) : 0;

  return (
    <div className="flex-1 bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Nueva solicitud de cliente</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Escribe los productos que pide el cliente, con la cantidad de cada uno.
        </p>
      </div>

      {formCollapsed && results ? (
        <section className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{customerName}</span> — {results.length}{" "}
            {results.length === 1 ? "producto cotizado" : "productos cotizados"}
          </p>
          <button
            onClick={() => setFormCollapsed(false)}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Editar productos
          </button>
        </section>
      ) : (
      <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente</label>
          <select
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona un cliente</option>
            {CUSTOMERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex gap-1 text-sm">
            {(
              [
                ["manual", "Uno por uno"],
                ["paste", "Pegar lista"],
                ["file", "Subir Excel"],
              ] as [InputMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setInputMode(mode)}
                className={`rounded-t px-3 py-1.5 font-medium ${
                  inputMode === mode
                    ? "border border-b-0 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {inputMode === "paste" && (
            <div className="space-y-2 rounded-b rounded-tr border border-zinc-300 p-3 dark:border-zinc-700">
              <p className="text-xs text-zinc-500">
                Pega la lista del cliente (una línea por producto). Reconoce la cantidad al inicio o al final de
                cada línea, o en una columna separada si pegas desde una tabla de Word o Excel.
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
                placeholder={"20 Acetaminofén 500mg x100\nLosartán 50mg x30 - 15\nOmeprazol 20mg x30"}
                className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                onClick={handleParsePaste}
                disabled={!pasteText.trim()}
                className="rounded bg-brand-blue px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-navy disabled:opacity-40"
              >
                Analizar lista
              </button>
            </div>
          )}

          {inputMode === "file" && (
            <div className="space-y-2 rounded-b rounded-tr border border-zinc-300 p-3 dark:border-zinc-700">
              <p className="text-xs text-zinc-500">
                Sube un archivo .xlsx, .xls o .csv con el producto en una columna y la cantidad en otra (con o sin
                encabezados).
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv"
                disabled={fileLoading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileUpload(file);
                  e.target.value = "";
                }}
                className="text-sm"
              />
              {fileLoading && <p className="text-xs text-zinc-500">Leyendo archivo...</p>}
            </div>
          )}
        </div>

        <p className="text-xs text-zinc-500">
          Revisa la lista antes de comparar — puedes corregir cualquier línea:
        </p>

        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex gap-2">
              <ProductNameInput
                value={line.text}
                onChange={(text) => updateLine(i, { text })}
                placeholder="Ej: Acetaminofén 500 mg x 100"
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
          className="text-sm font-medium text-zinc-600 hover:text-brand-blue dark:text-zinc-400 dark:hover:text-brand-blue"
        >
          + Agregar producto
        </button>

        <div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !customerName.trim() || lines.every((l) => !l.text.trim())}
            className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy disabled:opacity-40"
          >
            {submitting ? "Analizando..." : "Comparar precios"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>
      )}

      {results && (
        <section className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Total cotizado (precio de compra)</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-50">{formatCOP(totalCotizado)}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Ahorro estimado frente a la oferta más cara</span>
              <span className="font-semibold text-green-700 dark:text-green-400">{formatCOP(totalAhorro)}</span>
            </div>
            {customerRequestId && (
              <a
                href={`/api/customer-requests/${customerRequestId}/purchase-order`}
                className="mt-3 inline-block rounded bg-brand-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90"
              >
                Descargar pedido a proveedores (Excel)
              </a>
            )}
          </div>

          {results.map((r) => (
            <div key={r.itemId} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">{r.originalText}</p>
                  <p className="text-xs text-zinc-500">
                    Empaques solicitados: {r.requestedQuantity}
                  </p>
                </div>
                <span className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${STATUS_COLOR[r.pricing.status]}`}>
                  {STATUS_LABEL[r.pricing.status]}
                </span>
              </div>

              {r.pricing.warehouseStock !== null && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    En bodega: <span className="font-semibold text-zinc-900 dark:text-zinc-50">{r.pricing.warehouseStock}</span>
                    {" "}vs. solicitado: <span className="font-semibold text-zinc-900 dark:text-zinc-50">{r.requestedQuantity}</span>
                  </span>
                  <span
                    className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${
                      r.pricing.quantityToPurchase === 0
                        ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                        : r.pricing.warehouseStock > 0
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {r.pricing.quantityToPurchase === 0
                      ? "Cubre todo el pedido"
                      : r.pricing.warehouseStock > 0
                        ? `Faltan ${r.pricing.quantityToPurchase} por comprar`
                        : "Sin existencia en bodega"}
                  </span>
                </div>
              )}

              {r.pricing.selected && (
                <div className="mt-3 rounded bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                  <p>
                    <span className="font-medium">{r.pricing.selected.supplierName}</span>
                    {r.pricing.selected.laboratoryName ? ` (${r.pricing.selected.laboratoryName})` : ""} —{" "}
                    {r.pricing.selected.packagesNeeded} {r.pricing.selected.packagesNeeded === 1 ? "empaque" : "empaques"} x
                    {r.pricing.selected.packageSize} {r.pricing.selected.presentationUnit} a{" "}
                    {formatUnitCOP(r.pricing.selected.unitPrice)} c/u ={" "}
                    <span className="font-semibold">{formatCOP(r.pricing.totalPrice ?? 0)}</span>
                  </p>
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    Referencia: {formatUnitCOP(r.pricing.selected.unitPrice)} por {r.pricing.selected.presentationUnit}
                    {" "}(no es el precio del empaque completo, es solo para comparar entre presentaciones)
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">{r.pricing.reason}</p>
                </div>
              )}

              {!r.pricing.selected && r.pricing.status === "COVERED_BY_STOCK" && (
                <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <p>{r.pricing.reason}</p>
                </div>
              )}

              {!r.pricing.selected && r.pricing.status !== "COVERED_BY_STOCK" && (
                <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <p>{r.pricing.reason}</p>
                  {r.match.reasons.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                      {r.match.reasons.map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {r.match.candidates.length > 0 && (
                // Sin onToggle: con muchos resultados a la vez, el handler
                // (que guardaba el estado abierto/cerrado en expandedCandidates
                // leyendo e.currentTarget.open) terminaba leyendo un evento
                // "toggle" nativo ya invalidado por React, tirando "Cannot
                // read properties of null (reading 'open')" y tumbando toda
                // la página (bug real reportado por el cliente con un Excel
                // de varias filas). Nada más en el componente necesita leer
                // si está expandido, así que basta con el valor inicial: React
                // no lo vuelve a tocar mientras "open" no cambie entre
                // renders, dejando que el usuario lo abra/cierre libremente.
                <details
                  className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
                  open={!r.pricing.selected}
                >
                  <summary className="cursor-pointer text-xs font-medium text-amber-800 dark:text-amber-300">
                    {r.pricing.selected
                      ? "¿No es el producto correcto? Cambiarlo"
                      : "¿Cuál de estos es? Elige el correcto para cotizarlo:"}
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.match.candidates.map((c) => (
                      <button
                        key={c.product.id}
                        onClick={() => handleSelectCandidate(r.itemId, c.product.id)}
                        disabled={selectingItemId === r.itemId}
                        className="rounded border border-amber-300 bg-white px-3 py-1.5 text-left text-xs font-medium text-zinc-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-amber-950"
                      >
                        {c.product.dosageForm} — {c.product.concentration}
                        {c.product.concentrationUnit}
                        <span className="block text-[11px] font-normal text-zinc-500">{c.product.standardName}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleNoneOfAbove(r.itemId)}
                    disabled={selectingItemId === r.itemId}
                    className="mt-2 rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Ninguno de los anteriores
                  </button>
                  {selectingItemId === r.itemId && <p className="mt-2 text-xs text-amber-700">Confirmando...</p>}
                </details>
              )}

              {r.pricing.alternatives.length > 1 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-zinc-500">
                    Ver {r.pricing.alternatives.length} ofertas consideradas
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {r.pricing.alternatives.map((a) => {
                      const isSelected = a.supplierOfferId === r.pricing.selected?.supplierOfferId;
                      return (
                        <li key={a.supplierOfferId} className="flex items-center justify-between gap-2">
                          <span>
                            {isSelected ? "★" : a.eligible ? "✓" : "✗"} {a.supplierName}
                            {a.laboratoryName ? ` (${a.laboratoryName})` : ""} — {a.packagesNeeded} x{a.packageSize}{" "}
                            {a.presentationUnit} ={" "}
                            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                              {formatCOP(a.totalCost)}
                            </span>{" "}
                            <span className="text-zinc-400 dark:text-zinc-500">
                              ({formatUnitCOP(a.unitPrice)}/{a.presentationUnit})
                            </span>
                            {a.discardReason ? ` — ${a.discardReason}` : ""}
                          </span>
                          {!isSelected && (
                            <button
                              onClick={() => handleSelectOffer(r.itemId, a.supplierOfferId)}
                              disabled={selectingItemId === r.itemId}
                              className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              Usar esta
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    onClick={() => handleExcludeOffer(r.itemId)}
                    disabled={selectingItemId === r.itemId || r.pricing.status === "EXCLUDED"}
                    className="mt-2 rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Ninguna de las anteriores — no comprar este producto
                  </button>
                </details>
              )}
            </div>
          ))}
        </section>
      )}
      </div>
    </div>
  );
}
