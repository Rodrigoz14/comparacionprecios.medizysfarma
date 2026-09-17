// Mismo formato que usa el frontend (components/solicitudes/RequestWizard.tsx:
// formatCOP/formatUnitCOP) -- se usa aquí para que los textos de "razón" que
// arma el backend (mostrados tal cual en pantalla) no muestren números crudos
// sin separador de miles ni coma decimal, algo que hacía ver precios reales
// como cifras enormes e ilegibles (bug real reportado por el cliente).
export function formatCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(
    value,
  );
}

// El precio unitario es de referencia y suele tener decimales (centavos de
// peso); con 0 decimales redondeaba a "$0" para precios bajos.
export function formatUnitCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 }).format(
    value,
  );
}
