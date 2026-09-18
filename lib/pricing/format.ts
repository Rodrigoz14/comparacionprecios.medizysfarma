// Mismo formato que usa el frontend (components/solicitudes/RequestWizard.tsx:
// formatCOP/formatUnitCOP) -- se usa aquí para que los textos de "razón" que
// arma el backend (mostrados tal cual en pantalla) tengan coma decimal, sin
// separador de miles (pedido explícito del cliente: sin puntos de miles).
export function formatCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    useGrouping: false,
  }).format(value);
}

// El precio unitario es de referencia y suele tener decimales (centavos de
// peso); con 0 decimales redondeaba a "$0" para precios bajos.
export function formatUnitCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}
