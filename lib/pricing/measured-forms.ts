/**
 * Ampollas/viales: el precio que reporta el proveedor es por UNA sola
 * unidad sellada, sin importar que el texto mencione una caja de varias
 * (p. ej. "C*10 AMP X 2ML" -- confirmado con el cliente, no es una
 * suposición: el precio es por ampolla individual, no por la caja). A
 * diferencia de cualquier otra presentación (caja de tabletas, frasco de
 * jarabe...), donde "Cantidad" son empaques del tamaño que el cliente
 * mencionó y un empaque de otro tamaño se compara por unidades totales
 * equivalentes (Sección: bug real del jarabe 30ml vs 15ml), una ampolla
 * nunca se fracciona ni se agrega para llegar a un volumen distinto
 * (Sección: bug real -- Furosemida, Beta-metildigoxina): se compran
 * exactamente las ampollas pedidas, sin conversión.
 *
 * Se clasifica por dosageForm, no por presentationUnit ("ml"/"g"): una
 * ampolla también se mide en ml, pero no es intercambiable por tamaño igual
 * que un jarabe. Ver extract-attributes.ts: "SOLUCION INYECTABLE"/
 * "SUSPENSION INYECTABLE" se clasifican como "Inyectable", no "Solución"/
 * "Suspensión", justamente para que esta distinción sea correcta.
 */
const SEALED_UNIT_DOSAGE_FORMS = new Set(["Inyectable", "Ampolla"]);

export function isSealedUnitForm(dosageForm: string): boolean {
  return SEALED_UNIT_DOSAGE_FORMS.has(dosageForm);
}
