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

/**
 * Presentaciones medidas en ml/g (jarabe, solución, crema, loción...) no
 * tienen un conteo de "unidades" real -- "240ML" es el volumen del único
 * frasco, no una cantidad de envases a multiplicar. Confirmado con el
 * cliente (2026-09-24): cuando el proveedor no nombra unidades aparte (p.
 * ej. "CAJA X 10 FRASCOS"), el precio unitario que reporta YA es el precio
 * del frasco completo, así que el precio de empaque no se multiplica por el
 * volumen -- se deja igual al precio unitario, igual que ya se hacía para
 * mostrar "No. unidades" (siempre 1 para estas presentaciones, nunca el
 * volumen crudo). Coincide con las unidades que PRESENTATION_UNIT_BY_FORM
 * (extract-attributes.ts) asigna a esas formas líquidas/semisólidas.
 */
const MEASURE_UNITS = new Set(["ml", "g"]);

export function isMeasureUnit(presentationUnit: string): boolean {
  return MEASURE_UNITS.has(presentationUnit);
}
