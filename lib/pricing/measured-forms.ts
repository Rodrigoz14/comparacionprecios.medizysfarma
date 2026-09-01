/**
 * Formas que se dispensan a granel (se sirven dosis parciales de un mismo
 * envase abierto: jarabe, crema...), donde un envase de otro tamaño SÍ es
 * comparable por costo total cubriendo el mismo volumen/peso -- a
 * diferencia de una ampolla/vial sellado de un solo uso (dosageForm
 * "Inyectable"), que nunca se fracciona ni se agrega para llegar a un
 * volumen distinto (Sección: bug real -- Furosemida, Beta-metildigoxina).
 *
 * Se clasifica por dosageForm, no por presentationUnit ("ml"/"g"): una
 * ampolla también se mide en ml, pero no es intercambiable por tamaño igual
 * que un jarabe. Ver extract-attributes.ts: "SOLUCION INYECTABLE"/
 * "SUSPENSION INYECTABLE" se clasifican como "Inyectable", no "Solución"/
 * "Suspensión", justamente para que esta distinción sea correcta.
 */
const MEASURED_DOSAGE_FORMS = new Set([
  "Jarabe",
  "Suspensión",
  "Solución",
  "Crema",
  "Crema vaginal",
  "Gel",
  "Ungüento",
  "Loción",
  "Emulsión",
  "Emulsión oftálmica",
  "Shampoo",
]);

export function isMeasuredForm(dosageForm: string): boolean {
  return MEASURED_DOSAGE_FORMS.has(dosageForm);
}

/**
 * Ampollas/viales: el precio que reporta el proveedor es por UNA sola
 * unidad sellada, sin importar que el texto mencione una caja de varias
 * (p. ej. "C*10 AMP X 2ML" -- confirmado con el cliente, no es una
 * suposición: el precio es por ampolla individual, no por la caja). El
 * "2ML" que trae el texto es el contenido de una ampolla, no un multiplicador
 * de empaque -- a diferencia de una tableta, donde el tamaño de caja sí
 * multiplica cuántas unidades trae. Por eso presentationQuantity se ignora
 * para calcular cuántos empaques hacen falta: piden N ampollas, se compran
 * exactamente N al precio de cada una.
 */
const SEALED_UNIT_DOSAGE_FORMS = new Set(["Inyectable", "Ampolla"]);

export function isSealedUnitForm(dosageForm: string): boolean {
  return SEALED_UNIT_DOSAGE_FORMS.has(dosageForm);
}
