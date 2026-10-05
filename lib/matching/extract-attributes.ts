import { stripAccents } from "@/lib/matching/normalize";
import { isSealedUnitForm } from "@/lib/pricing/measured-forms";
import type { ExtractedAttributes } from "@/lib/matching/types";

/**
 * Los Excel de proveedores usan la convención colombiana: "." separa miles,
 * "," separa decimales (al revés de lo que JS espera) -- mismo criterio que
 * ya usa `detectPriceFormat` en lib/excel/normalizer.ts para precios. Sin
 * esto, "1.000MG" (mil miligramos) se leía como "1.000" = 1 (JS interpreta
 * el punto como decimal) -- un error de 1000x confirmado en datos reales de
 * producción (Acetaminofeno inyectable de Ramédicas). Un "." seguido de
 * EXACTAMENTE 3 dígitos se asume agrupador de miles, nunca un decimal real:
 * ninguna concentración real en estos datos necesita 3 cifras decimales
 * exactas (las que sí son decimales genuinos usan 1 o 2, p. ej. "12,5MG").
 * La parte entera nunca puede ser "0": nadie agrupa miles escribiendo "0.625"
 * para decir "625" (lo escribiría directo) -- un "0" inicial es la señal
 * segura de que es un decimal real menor a 1 (p. ej. "0.625MG/G"), no miles.
 */
function parseColombianNumber(raw: string): string {
  if (raw.includes(",")) {
    return raw.replace(/\./g, "").replace(",", ".");
  }
  const thousandsMatch = /^([1-9]\d{0,2})\.(\d{3})$/.exec(raw);
  return thousandsMatch ? thousandsMatch[1] + thousandsMatch[2] : raw;
}

// El signo "%" (peso/volumen, la convención real usada en gotas oftálmicas
// y otras soluciones: p. ej. "Carboximetilcelulosa 0.5%" = 5MG/ML, el mismo
// producto que el catálogo guarda como "5MG") no lleva un límite de palabra
// (\b) detrás como las demás unidades, porque casi siempre le sigue un
// paréntesis o el final del texto — ninguno de los dos es un límite de
// palabra válido en regex (ambos son caracteres "no palabra"), así que \b
// nunca coincidiría ahí.
// "GR" (abreviatura real de "gramos" en datos colombianos, p. ej. "1 GR
// CJ*10") y "MEQ" (miliequivalentes, unidad real y distinta de MG para
// electrolitos como Cloruro de Potasio/Sodio) -- confirmados en datos reales
// de producción (Cefazolina, Meropenem, Cloruro de Potasio): sin
// reconocerlas, la concentración no se encontraba en absoluto, o el regex
// terminaba agarrando por error otro número del texto (p. ej. el volumen del
// envase) como si fuera la concentración.
// "EMQ" es un typo real y recurrente de un cliente por "MEQ" (letras
// invertidas) -- confirmado en producción (2026-10-05): "CLORURO DE POTASIO
// 2EMQ/ML" se repitió igual en varias solicitudes distintas, siempre con las
// mismas dos letras cambiadas de orden.
const CONCENTRATION_RE = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s*(MG\b|MCG\b|UI\b|MEQ\b|EMQ\b|GR\b|G\b|ML\b|%)/i;
// El símbolo de multiplicación varía por proveedor: "X100" (Ramédicas) o
// "*30"/"C*1" (Disfarma). Cubre tanto conteos discretos ("X100" -> 100
// tabletas) como volumen/peso por envase pegado a la unidad, sin espacio
// ("X 30ML", "*400G", "X 1.5L"). Con bandera global: cuando el texto trae
// varias coincidencias (p. ej. "C*1 FCO X 240ML"), se prefiere la que
// especifica volumen/peso sobre un conteo de envases genérico.
const PRESENTATION_QTY_RE = /[X*]\s*(\d+(?:[.,]\d+)?)\s*(ML|L|G)?\b/gi;
// Envases de una sola unidad donde el proveedor no escribe "X1" (p. ej.
// biológicos/oncológicos vendidos como "CAJA X VIAL"): se asume cantidad 1.
const SINGLE_UNIT_CONTAINER_RE = /[X*]\s*(VIAL|AMPOLLA|AMPOLLAS|JERINGA|FRASCO|TUBO|SOBRE)\b/i;
// Cuando el tamaño real del envase va SUELTO, sin "X"/"*" pegado ("Tarro 400
// G X 1" -- el "X 1" del final es cuántos tarros trae la caja, no el tamaño
// del tarro), PRESENTATION_QTY_RE nunca lo encuentra porque exige X/* justo
// antes del número. Solo se usa como respaldo cuando no hay ningún candidato
// "X<numero><unidad>" ya encontrado (ver más abajo) -- bug real (2026-09-29):
// un Tarro de 400g de Ofimedicas quedaba guardado como presentación "1 ml"
// (tomando el "X1" final) en vez de "400 g".
const BARE_MEASURE_RE = /(\d+(?:[.,]\d+)?)\s*(ML|L|G)\b/gi;
// Una dosis adicional de un combinado, pegada con "+" justo después de la
// anterior ("...5MG+60MG..."): cada principio activo trae su propia unidad
// repetida, a diferencia del formato de razón fija ("500/125 MG") que
// CONCENTRATION_RE ya captura como un solo valor.
const EXTRA_DOSE_RE = /^\s*\+\s*(\d+(?:[.,]\d+)?)\s*(MG|MCG|UI|MEQ|EMQ|GR|G|ML|%)\b/i;

// "GR" es solo una forma distinta de escribir "G" (gramos), no una unidad
// distinta -- se normaliza para que "1GR" y "1G" terminen en la misma clave
// genérica. "EMQ" es el mismo typo de "MEQ" explicado arriba. "MEQ" sí es una
// unidad real y distinta (miliequivalentes), no se normaliza a nada más.
function normalizeConcentrationUnit(unit: string): string {
  if (unit === "GR") return "G";
  if (unit === "EMQ") return "MEQ";
  return unit;
}

interface DosePart {
  value: string;
  unit: string;
}

/**
 * A partir de la primera coincidencia de CONCENTRATION_RE, sigue buscando
 * dosis adicionales unidas con "+" inmediatamente después ("5MG+60MG",
 * o hasta tres partes: "4G+4G+0.4G"). Si no hay ninguna, devuelve solo la
 * primera parte -- comportamiento idéntico al anterior.
 */
function extractDoseParts(upper: string, firstMatch: RegExpMatchArray): { parts: DosePart[]; end: number } {
  const parts: DosePart[] = [
    { value: parseColombianNumber(firstMatch[1]), unit: normalizeConcentrationUnit(firstMatch[2].toUpperCase()) },
  ];
  let end = (firstMatch.index ?? 0) + firstMatch[0].length;
  for (;;) {
    const next = EXTRA_DOSE_RE.exec(upper.slice(end));
    if (!next) break;
    parts.push({ value: parseColombianNumber(next[1]), unit: normalizeConcentrationUnit(next[2].toUpperCase()) });
    end += next[0].length;
  }
  return { parts, end };
}

const DOSAGE_FORM_MAP: Record<string, string> = {
  TAB: "Tableta",
  TABLETA: "Tableta",
  TABLETAS: "Tableta",
  COMPRIMIDO: "Tableta",
  COMPRIMIDOS: "Tableta",
  CAP: "Cápsula",
  CAPS: "Cápsula",
  CAPSULA: "Cápsula",
  CAPSULAS: "Cápsula",
  JBE: "Jarabe",
  JARABE: "Jarabe",
  SUSP: "Suspensión",
  SUSPENSION: "Suspensión",
  SOL: "Solución",
  SOLUCION: "Solución",
  CREMA: "Crema",
  CREM: "Crema",
  GEL: "Gel",
  UNG: "Ungüento",
  UNGUENTO: "Ungüento",
  POMADA: "Ungüento",
  // "AMP"/"AMPOLLA" describen el ENVASE (una ampolla), no una forma
  // farmacéutica aparte de "Inyectable" -- el propio código ya las trata
  // como lo mismo para precios (isSealedUnitForm incluía ambas como unidad
  // sellada). Mantenerlas separadas solo causaba que el mismo medicamento
  // quedara con genericKey distinto según si el texto decía "SOLUCION
  // INYECTABLE" o solo "AMPOLLA"/"AMP" (bug real, 2026-09-29: bodega
  // registraba "DICLOFENACO 75MG/3ML C*100 AMP X 3ML" y nunca coincidía con
  // el "DICLOFENACO 75MG/3ML SOLUCION INYECTABLE" del catálogo). Además,
  // "AMP" es una abreviatura muy ambigua (también aparece truncando otras
  // palabras, p. ej. "amp espectro" por "amplio espectro" en un producto
  // real) -- confirmado revisando el catálogo completo: los únicos 2
  // productos que quedaban como "Ampolla" estaban mal clasificados.
  AMPOLLA: "Inyectable",
  AMP: "Inyectable",
  INY: "Inyectable",
  INYECTABLE: "Inyectable",
  // "Gotas" no existe como forma farmacéutica propia en ningún producto real
  // del catálogo (0 coincidencias): los proveedores siempre lo normalizan
  // como "Solución" (p. ej. "SOL OFT GTS" = Solución Oftálmica en Gotas).
  // Antes mapeaba a una categoría "Gotas" separada que ningún producto real
  // usaba, así que un cliente que escribía "gotas" (forma coloquial de
  // referirse a un colirio) nunca podía coincidir con nada — bug real
  // reportado por el cliente (Carboximetilcelulosa).
  GOTAS: "Solución",
  // "Colirio" es la forma coloquial real de referirse a una solución
  // oftálmica (igual que "Gotas" arriba) -- mismo criterio, mismo bucket.
  COLIRIO: "Solución",
  GRAGEA: "Tableta",
  GRAGEAS: "Tableta",
  SUPOS: "Supositorio",
  SUPOSITORIO: "Supositorio",
  SUPOSITORIOS: "Supositorio",
  OVULO: "Óvulo",
  OVULOS: "Óvulo",
  OVUL: "Óvulo",
  SHAMP: "Shampoo",
  SHAMPOO: "Shampoo",
  INHALADOR: "Aerosol inhalador",
  // Confirmado en datos reales de producción (2026-10-05): "Implante"
  // (Goserelina, Levonorgestrel, Dexametasona intravítreo) no tenía ninguna
  // categoría propia, así que quedaba sin forma farmacéutica reconocida.
  IMPLANTE: "Implante",
  IMPLANTES: "Implante",
  JALEA: "Jalea",
  ESPUMA: "Espuma",
};

/**
 * Algunas formas farmacéuticas solo se distinguen correctamente con la vía de
 * administración (una crema vaginal y una crema tópica no son intercambiables,
 * ni un aerosol para inhalar oral y uno nasal), pero DOSAGE_FORM_MAP solo mira
 * una palabra a la vez y pararía en la primera que reconozca, perdiendo la que
 * viene después. Se revisan frases completas ANTES que palabras sueltas para no
 * perder esa distinción.
 *
 * Es un ARRAY (no un objeto) porque el orden importa: las frases más largas y
 * específicas deben revisarse antes que las más cortas que están contenidas
 * dentro de ellas (p. ej. "POL INH BUC" antes que "INH BUC" a secas, o
 * "AEROSOL INH BUC" nunca se confundiría con "INH BUC" si "INH BUC" se
 * revisara primero por error).
 *
 * Cada entrada viene de datos reales encontrados en los archivos de Disfarma
 * o Ramédicas durante esta sesión, nunca inventada.
 */
const COMPOUND_DOSAGE_FORM_MAP: [string, string][] = [
  // "Solución/Suspensión inyectable" son ampollas/viales sellados de un solo
  // uso, no un líquido a granel del que se sirven dosis parciales (como un
  // jarabe): no son intercambiables entre tamaños de ampolla igual que una
  // caja de tabletas. Sin esta regla, DOSAGE_FORM_MAP encuentra "SOLUCION"
  // (palabra suelta) antes que "INYECTABLE" porque aparece primero en el
  // texto, y el producto queda clasificado como "Solución" a secas -- mismo
  // grupo que un jarabe o una solución oral, con el mismo bug real
  // reportado por el cliente (Furosemida, Beta-metildigoxina): el sistema
  // ofrecía una ampolla de 100ml como si fuera intercambiable con una de
  // 2ml para la misma cantidad de "unidades" pedidas.
  ["SOLUCION INYECTABLE", "Inyectable"],
  ["SUSPENSION INYECTABLE", "Inyectable"],
  ["SOL INY", "Inyectable"],
  ["SUSP INY", "Inyectable"],
  // Crema vaginal vs tópica (reportado por el cliente).
  ["CREMA VAGINAL", "Crema vaginal"],
  ["CREM VAG", "Crema vaginal"],
  // Aerosol/polvo/solución para inhalar, oral vs nasal (reportado por el cliente: Beclometasona).
  ["AEROSOL INH BUC", "Aerosol inhalador"],
  ["AEROSOL INH NAS", "Aerosol nasal"],
  ["AEROSOL TOP", "Aerosol"],
  ["POL INH BUC", "Polvo inhalado"],
  ["SOL INH BUC", "Solución inhalada"],
  ["POLVO PARA INHALACION", "Polvo inhalado"],
  ["POL INH", "Polvo inhalado"],
  ["INH BUC", "Aerosol inhalador"],
  ["SOLUCION PARA INHALACION NASAL", "Solución nasal"],
  ["SOLUCION PARA INHALACION", "Solución inhalada"],
  ["SUSPENSION PARA INHALACION", "Suspensión inhalada"],
  // Mismo caso, sin el "PARA" -- forma real en que un cliente lo escribe
  // (confirmado 2026-10-05: "IPRATROPIO BROMURO SOLUCION INHALACION 20MCG"
  // caía en la palabra suelta "SOLUCION" a secas, perdiendo la distinción de
  // vía y nunca coincidiendo con el mismo producto del catálogo).
  ["SOLUCION INHALACION", "Solución inhalada"],
  ["SUSPENSION INHALACION", "Suspensión inhalada"],
  ["SUSP NAS", "Suspensión nasal"],
  ["SUSPENSION NASAL", "Suspensión nasal"],
  // Vías tópica/oftálmica que igual se pierden si solo se mira la primera palabra.
  ["EMULSION TOPICA - SHAMPOO", "Shampoo"],
  ["EMULSION TOPICA", "Emulsión"],
  ["EMUL TOP", "Emulsión"],
  ["EMULSION OFTALMICA", "Emulsión oftálmica"],
  ["EMUL OFT", "Emulsión oftálmica"],
  ["LOCION TOPICA", "Loción"],
  ["LOC TOP", "Loción"],
  ["LOCION CAPILAR", "Loción"],
  ["POMADA TOPICA", "Ungüento"],
  ["PARCHE TRANSDERMICO", "Parche transdérmico"],
  ["SIST TRANSD", "Parche transdérmico"],
  ["OVULO VAGINAL", "Óvulo"],
  ["OVUL VAG", "Óvulo"],
  ["SUPOSITORIO RECTAL", "Supositorio"],
  ["POL GRAN PRO", "Polvo"],
  ["POL GRAN", "Polvo"],
  ["POL ORL", "Polvo"],
];

const PRESENTATION_TYPE_MAP: Record<string, string> = {
  CAJA: "Caja",
  CAJAS: "Caja",
  FRASCO: "Frasco",
  FRASCOS: "Frasco",
  FCO: "Frasco",
  FCOS: "Frasco",
  BLISTER: "Blíster",
  BLISTERES: "Blíster",
  SOBRE: "Sobre",
  SOBRES: "Sobre",
  TUBO: "Tubo",
  TUBOS: "Tubo",
};

const PRESENTATION_UNIT_BY_FORM: Record<string, string> = {
  Tableta: "tabletas",
  Cápsula: "cápsulas",
  Jarabe: "ml",
  Suspensión: "ml",
  Solución: "ml",
  Crema: "g",
  "Crema vaginal": "g",
  Gel: "g",
  Ungüento: "g",
  Ampolla: "ampollas",
  Inyectable: "ampollas",
  Supositorio: "supositorios",
  Óvulo: "óvulos",
  Shampoo: "ml",
  Emulsión: "ml",
  "Emulsión oftálmica": "ml",
  Loción: "ml",
  "Aerosol inhalador": "dosis",
  "Aerosol nasal": "dosis",
  Aerosol: "dosis",
  "Polvo inhalado": "dosis",
  "Solución inhalada": "dosis",
  "Solución nasal": "dosis",
  "Suspensión inhalada": "dosis",
  "Suspensión nasal": "dosis",
  "Parche transdérmico": "parches",
};

/**
 * Busca una forma farmacéutica conocida dentro de un texto ya en mayúsculas:
 * primero frases compuestas (COMPOUND_DOSAGE_FORM_MAP, para no perder la vía de
 * administración), luego palabras sueltas (DOSAGE_FORM_MAP). Devuelve también
 * en qué posición del texto empieza la coincidencia, para poder cortar ahí el
 * nombre del producto y no confundir la forma con el principio activo.
 */
function matchDosageForm(upper: string): { dosageForm: string; index: number } | null {
  for (const [phrase, mapped] of COMPOUND_DOSAGE_FORM_MAP) {
    const index = upper.indexOf(phrase);
    if (index >= 0) return { dosageForm: mapped, index };
  }
  // "POLVO PARA RECONSTITUIR" sin decir a qué (oral vs inyectable) -- bug
  // real confirmado (2026-10-02): "AMPICILINA SODICA + SULBACTAM SODICO
  // POLVO PARA RECONSTITUIR 1.5G VIAL" (texto típico de un cliente) no traía
  // NINGÚN marcador de forma farmacéutica reconocido, así que la frase
  // completa quedaba pegada al principio activo, rompiendo la homologación
  // por completo. Cuando el texto NO menciona "ORAL" en ningún lado (si lo
  // menciona, ya lo resuelve correctamente la palabra "SOLUCION"/
  // "SUSPENSION" suelta más abajo), un polvo para reconstituir en estos
  // datos siempre es un antibiótico inyectable (vial/ampolla) que se
  // reconstituye antes de aplicar -- nunca otra vía.
  if (upper.includes("RECONSTITUIR") && !upper.includes("ORAL")) {
    const polvoIndex = upper.indexOf("POLVO");
    const reconstituirIndex = upper.indexOf("RECONSTITUIR");
    return { dosageForm: "Inyectable", index: polvoIndex >= 0 ? polvoIndex : reconstituirIndex };
  }
  const tokens = upper.split(/[^A-ZÁÉÍÓÚÑ]+/).filter(Boolean);
  for (const token of tokens) {
    const mapped = DOSAGE_FORM_MAP[token];
    if (mapped) return { dosageForm: mapped, index: upper.indexOf(token) };
  }
  return null;
}

/**
 * Busca una forma farmacéutica conocida dentro de un texto y la normaliza al
 * vocabulario controlado. Devuelve null si no reconoce nada.
 */
export function normalizeDosageForm(rawText: string): string | null {
  const upper = stripAccents(rawText).toUpperCase();
  return matchDosageForm(upper)?.dosageForm ?? null;
}

/**
 * Extrae principio activo, concentración, forma farmacéutica y presentación a partir
 * de una descripción de producto en texto libre (nombre de un proveedor o el texto
 * escrito por un cliente). Devuelve null si no se puede determinar la concentración
 * o la cantidad de presentación (los dos atributos críticos para no confundir
 * productos distintos): en ese caso debe marcarse para revisión, no completarse
 * con un valor adivinado.
 */
// Etiquetas de canal/categoría que algunos proveedores anteponen al nombre
// del producto (p. ej. Disfarma: "EPS-ABACAVIR..."). No son parte del
// principio activo: si no se quitan, "EPS-ZOPICLONA" nunca coincide con lo
// que un cliente escribe normalmente ("Zopiclona").
const CHANNEL_PREFIX_RE = /^(EPS|POS|NO[\s-]?POS|PBS)[\s-]+/i;

// Anestésicos locales (Bupivacaína, Lidocaína...) a veces aclaran "SIN
// EPINEFRINA"/"S/EPINEFRINA" aunque esa sea la presentación por defecto --
// cuando NINGÚN proveedor menciona epinefrina para esa misma concentración,
// es la misma presentación que uno que sí lo aclara explícitamente (bug real
// confirmado en producción: "BUPIVACAINA S/EPINEFRINA 50MG/10ML" nunca
// coincidía con "EPS-BUPIVACAINA 50MG/10ML" sin esa aclaración, mismo
// medicamento). Nunca se quita "CON"/"C/EPINEFRINA": ESA sí es una
// presentación real y distinta (con vasoconstrictor).
const WITHOUT_EPINEPHRINE_RE = /\s*(SIN\s+EPINEFRINA|S\/\s*EPINEFRINA)\b/i;

// Adjetivos de sal (concuerdan en género con el principio que modifican:
// "Ampicilina SÓDICA", "Sulbactam SÓDICO", "Diclofenaco SÓDICO",
// "Pantoprazol MAGNÉSICO") -- la sal no cambia la identidad del medicamento
// para homologar en este catálogo (mismo criterio ya confirmado con
// "Dipirona"/"Dipirona Sódica"). Bug real confirmado (2026-10-02):
// "AMPICILINA SODICA + SULBACTAM SODICO..." de un cliente nunca coincidía
// con "AMPICILINA+SULBACTAM..." del catálogo porque "SODICA"/"SODICO"
// quedaban como parte del nombre del principio activo. No se quitan
// compuestos donde la palabra de sal SÍ es el núcleo del nombre ("Sulfato de
// Sodio", "Cloruro de Sodio" ya usan "SODIO", sustantivo con DE, nunca este
// adjetivo).
//
// A PROPÓSITO no incluye ésteres/sales orgánicas como CLORHIDRATO, TARTRATO,
// SUCCINATO, FUMARATO, PROPIONATO, FUROATO, etc. -- investigado en datos
// reales (2026-10-05): a diferencia de sódica/potásica/cálcica/magnésica
// (simples contraiones intercambiables), varias de estas SÍ distinguen
// formulaciones reales no intercambiables ("Metoprolol Tartrato" es de
// liberación inmediata, "Metoprolol Succinato" de liberación prolongada; un
// combinado real a veces lista el mismo corticoide en dos ésteres distintos
// a propósito, "Betametasona Dipropionato + Betametasona Fosfato", por su
// inicio/duración de acción diferente). Quitarlas fusionaría por error
// productos clínicamente distintos.
const SALT_FORM_ADJECTIVE_RE = /\b(SODICA|SODICO|POTASICA|POTASICO|CALCICA|CALCICO|MAGNESICA|MAGNESICO)\b/gi;

// Marca real de jeringa precargada ("JER PREX0.4ML", "JERPREX1.750ML" --
// "JER"+"PRE" a veces vienen pegados, a veces con espacio). Sirve para
// distinguir, en el tamaño de envase, un volumen PRECISO y chico (una
// jeringa real nunca pasa de un par de decenas de ml) de un volumen GRANDE
// expresado con "." como separador de miles (una bolsa o frasco de suero sí
// llega a cientos o miles de ml) -- ver JERINGA_PRELLENADA_RE más abajo.
const JERINGA_PRELLENADA_RE = /JER(?:INGA)?\s*PRE(?:LLENADA)?/i;

/**
 * Mismo problema de ambigüedad colombiana que `parseColombianNumber`, pero
 * para un VOLUMEN DE ENVASE (tamaño de presentación, o el denominador de una
 * razón dosis/volumen) en vez de una dosis -- y con la respuesta contraria
 * por defecto. Una dosis con 3 decimales exactos ("1.000MG") casi siempre es
 * miles; un volumen con 3 decimales exactos casi siempre es un tamaño grande
 * real expresado en miles también ("SOLUCION INYECTABLE X 1.000ML" = una
 * bolsa de 1 litro, "GALON X 3.800ML" = un galón real de 3800ml) --
 * confirmado en datos reales de producción, 2026-10-02. La ÚNICA excepción
 * confirmada es la jeringa precargada: ahí el mismo patrón de 3 decimales SÍ
 * es un volumen real y chico ("JERPREX1.750ML" = 1.75 ml, la dosis de una
 * jeringa de Paliperidona de depósito), nunca "1750 ml" (ninguna jeringa
 * precargada real mide litro y medio) -- el mismo "1.750" aparece tanto como
 * tamaño de envase como denominador de la razón de concentración en este
 * caso, así que ambos usos comparten esta misma función.
 */
function parsePresentationVolumeNumber(raw: string, upper: string): string {
  if (raw.includes(",")) {
    return raw.replace(/\./g, "").replace(",", ".");
  }
  if (JERINGA_PRELLENADA_RE.test(upper)) {
    return raw;
  }
  const thousandsMatch = /^([1-9]\d{0,2})\.(\d{3})$/.exec(raw);
  return thousandsMatch ? thousandsMatch[1] + thousandsMatch[2] : raw;
}

// Un cliente a veces omite por completo las unidades de una jeringa
// precargada o ampolla de un solo uso, escribiendo solo la razón desnuda
// ("40/0.4 JERINGA PRELLENADA", "60/0.6 AMPOLLAS") -- confirmado en datos
// reales de Enoxaparina (2026-10-05): "40/0.4" sin unidad es exactamente la
// MISMA dosis real que "40MG/0,4ML" del catálogo (40mg en 0.4ml), la única
// convención vista en estas presentaciones. Se reescribe el texto
// insertando "MG"/"ML" ANTES de que corra el resto de la extracción, para
// reutilizar toda la lógica de razón dosis/volumen ya probada (branch de
// formas selladas) en vez de duplicarla. Solo se activa cuando el número NO
// trae ya una unidad propia pegada (exige que justo después del "/" solo
// haya el segundo número, nunca letras).
const BARE_DOSE_VOLUME_RATIO_RE = new RegExp(
  `(\\d+(?:[.,]\\d+)?)\\s*\\/\\s*(\\d+(?:[.,]\\d+)?)(\\s*(?:${JERINGA_PRELLENADA_RE.source}|AMPOLLAS?|AMP)\\b)`,
  "i",
);

function insertImpliedDoseVolumeUnits(upper: string): string {
  return upper.replace(BARE_DOSE_VOLUME_RATIO_RE, (_match, dose, volume, suffix) => `${dose}MG/${volume}ML${suffix}`);
}

// Segunda forma real de escribir un combinado, distinta de "INGREDIENTE1 +
// INGREDIENTE2 DOSIS1+DOSIS2" (esa ya la maneja EXTRA_DOSE_RE más abajo):
// aquí cada principio activo trae SU PROPIA dosis pegada antes del "+"
// siguiente -- "Ampicilina 1 g + Sulbactam 0.5 g" (visto en datos reales de
// Ofimédicas). Sin esto, todo lo que viene después del primer "+" se perdía
// por completo: "Ampicilina 1 g + Sulbactam 0.5 g..." quedaba como Ampicilina
// sola, sin Sulbactam, y nunca coincidía con el mismo combinado escrito en el
// formato "Ampicilina + Sulbactam 1g+0.5g". Anclado al inicio del texto para
// no disparar con un "+" suelto en cualquier otra parte.
const INTERLEAVED_COMBO_RE =
  /^([A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+)*?)\s+(\d+(?:[.,]\d+)?)\s*(MG|MCG|UI|MEQ|GR|G|ML|%)\s*\+\s*([A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+)*?)\s+(\d+(?:[.,]\d+)?)\s*(MG|MCG|UI|MEQ|GR|G|ML|%)\b/i;

// Tercera forma real de escribir un combinado: varios números separados por
// "+" que comparten UNA sola unidad al final, en vez de que cada uno traiga
// la suya repetida ("4G+4G+0,4G") -- "4+4+0.4 G/100ML" (Hidróxido de Aluminio
// + Hidróxido de Magnesio + Simeticona), "0.25+0.5 MG/ML" (Ipratropio +
// Fenoterol), "0.02+2.5 G/ML" (Hioscina N-Butil Bromuro + Dipirona): los tres
// confirmados en texto real de clientes (2026-10-05). Sin esto,
// CONCENTRATION_RE nunca encuentra unidad pegada al PRIMER número (la unidad
// está después del ÚLTIMO), así que termina agarrando solo el último valor
// ("0.5 MG") y PERDIENDO el resto del combinado por completo -- mucho peor
// que solo no reducir la razón: el producto quedaba irreconocible. Debe
// probarse ANTES que el camino normal, por ser más específico (2 a 4 dosis).
const SHARED_UNIT_MULTI_DOSE_RE =
  /(\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?){1,3})\s*(MG|MCG|UI|MEQ|GR|G|ML|%)\b/i;

// Una "/" real entre dos principios activos combinados siempre separa
// NOMBRES completos (3 letras o más a cada lado) -- nunca una abreviatura
// corta como "C/EPINEFRINA" ("con epinefrina", 14 productos reales de
// Lidocaína/Bupivacaína en el catálogo) o "Y/O" (conjunción, en nombres de
// fórmulas infantiles). Si cualquier lado tiene menos de 3 letras, no se
// toca: así "PIPERACILINA/TAZOBACTAM" o "IPRATROPIO BROMURO/FENOTEROL"
// (formas reales en que un cliente escribe un combinado, confirmadas
// 2026-10-05) se convierten a "+" y quedan identificados como combinado --
// sin esto, la "/" quedaba pegada a una de las dos palabras (al no haber
// espacio alrededor) y canonicalizeIngredient nunca las separaba, rompiendo
// tanto la búsqueda por ingrediente como la clave genérica final.
function normalizeIngredientSeparators(activeIngredient: string): string {
  if (!activeIngredient.includes("/")) return activeIngredient;
  const segments = activeIngredient.split("/").map((s) => s.trim());
  // Se revisa solo la palabra ADYACENTE a cada "/" (última del segmento de
  // la izquierda, primera del de la derecha) -- no el segmento completo.
  // "LIDOCAINA C/EPINEFRINA" tiene un segmento izquierdo largo ("LIDOCAINA
  // C"), pero la palabra pegada a la "/" es solo "C": mirar el segmento
  // entero lo dejaba pasar por error (bug encontrado en pruebas,
  // 2026-10-05) y partía el nombre real del catálogo en dos.
  for (let i = 0; i < segments.length - 1; i++) {
    const before = segments[i].split(/\s+/).pop() ?? "";
    const after = segments[i + 1].split(/\s+/)[0] ?? "";
    const beforeLetters = before.replace(/[^A-ZÁÉÍÓÚÑ]/gi, "").length;
    const afterLetters = after.replace(/[^A-ZÁÉÍÓÚÑ]/gi, "").length;
    if (beforeLetters < 3 || afterLetters < 3) return activeIngredient;
  }
  return segments.join(" + ");
}

export interface ExtractOptions {
  /**
   * Si es false, no exigir una cantidad de presentación explícita en el texto:
   * se asume 1 en vez de descartar la fila. Sirve para lo que escribe un
   * cliente ("Ácido Valproico 250mg", la cantidad va en un campo aparte), no
   * para archivos de proveedor, donde la presentación es un dato real que no
   * se debe adivinar (Sección 6: el precio por unidad depende de acertarla).
   * Por defecto true, para no cambiar el comportamiento de la importación.
   */
  requirePresentation?: boolean;
}

/**
 * Última red antes de rendirse: cuando el cliente escribe solo el nombre del
 * medicamento sin concentración (p. ej. "Ácido Valproico", sin decir cuál),
 * extractProductAttributes() devuelve null porque no hay suficiente para
 * identificar un producto exacto. En vez de terminar ahí en NO_MATCH, esto
 * devuelve una mejor suposición del ingrediente para poder mostrarle al
 * cliente qué concentraciones existen y que elija — nunca se adivina cuál es
 * la correcta, solo se ayuda a encontrar las opciones.
 *
 * Deliberadamente conservador: si el texto trae algún dígito, es más probable
 * que la concentración esté mal escrita que que no exista, y adivinar el
 * ingrediente ahí sería más arriesgado que útil — se prefiere no intentarlo.
 * Excepción: una cantidad de presentación al final ("X 360 ML", "CAJA X 10")
 * sí se tolera, porque es un patrón reconocido de tamaño de envase, no una
 * concentración mal escrita (bug real: "Hidroxido de aluminio + Simeticona
 * suspensión X 360 ml" no debía descartarse solo por el "360").
 */
export function extractIngredientGuess(rawText: string): string | null {
  const upper = stripAccents(rawText)
    .toUpperCase()
    .replace(CHANNEL_PREFIX_RE, "")
    .replace(WITHOUT_EPINEPHRINE_RE, "")
    .replace(SALT_FORM_ADJECTIVE_RE, "")
    .trim();
  if (!upper) return null;

  const withoutPresentation = upper.replace(PRESENTATION_QTY_RE, " ").trim();
  if (/\d/.test(withoutPresentation)) return null;

  const formMatch = matchDosageForm(withoutPresentation);
  // Una palabra de empaque ("sobres", "frascos"...) no es una forma
  // farmacéutica, pero igual marca dónde termina el nombre del ingrediente:
  // sin esto, "Polietilenglicol sobres" quedaba como ingrediente completo
  // ("POLIETILENGLICOL SOBRES"), sin coincidir con la clave real del
  // catálogo ("polietilenglicol" a secas) — bug real reportado por el cliente.
  const packagingTokens = withoutPresentation.split(/[^A-ZÁÉÍÓÚÑ]+/).filter(Boolean);
  let packagingIndex = -1;
  for (const token of packagingTokens) {
    if (PRESENTATION_TYPE_MAP[token]) {
      packagingIndex = withoutPresentation.indexOf(token);
      break;
    }
  }

  const candidateIndexes = [formMatch?.index, packagingIndex >= 0 ? packagingIndex : undefined].filter(
    (i): i is number => i !== undefined,
  );
  const cutIndex = candidateIndexes.length > 0 ? Math.min(...candidateIndexes) : -1;
  const ingredient = (cutIndex >= 0 ? withoutPresentation.slice(0, cutIndex) : withoutPresentation).trim();
  return ingredient || null;
}

export function extractProductAttributes(
  rawName: string,
  options: ExtractOptions = {},
): { attributes: ExtractedAttributes; warnings: string[]; presentationSpecified: boolean } | null {
  const requirePresentation = options.requirePresentation ?? true;
  const upper = insertImpliedDoseVolumeUnits(
    stripAccents(rawName)
      .toUpperCase()
      .replace(CHANNEL_PREFIX_RE, "")
      .replace(WITHOUT_EPINEPHRINE_RE, "")
      .replace(SALT_FORM_ADJECTIVE_RE, ""),
  );
  const warnings: string[] = [];

  // Un volumen (ML/L) escrito justo despues de "X"/"*" es SIEMPRE tamaño de
  // envase ("FRASCO X 360ML"), nunca la concentracion del medicamento -- una
  // concentracion real nunca se introduce con ese prefijo. Sin este filtro,
  // una busqueda sin concentracion real (p. ej. "Hidroxido de aluminio +
  // Simeticona suspension X 360 ML") tomaba el volumen del frasco como si
  // fuera la concentracion (360ML), y como ningun producto real tiene esa
  // "concentracion", la busqueda nunca encontraba nada (bug real reportado
  // por el cliente). No aplica a G (peso): ahí sigue el comportamiento
  // anterior, porque hay productos reales (formulas/suplementos) sin
  // concentracion farmacologica propia donde el peso del envase es el unico
  // dato disponible para construir la clave generica.
  const sharedUnitMatch = SHARED_UNIT_MULTI_DOSE_RE.exec(upper);
  const concentrationCandidates = sharedUnitMatch
    ? [sharedUnitMatch]
    : [...upper.matchAll(new RegExp(CONCENTRATION_RE.source, "gi"))];
  const concentrationMatch = sharedUnitMatch
    ? sharedUnitMatch
    : (concentrationCandidates.find((m) => {
        const unit = m[2]?.toUpperCase();
        if (unit !== "ML" && unit !== "L") return true;
        return !/[X*]\s*$/.test(upper.slice(0, m.index));
      }) ?? null);
  // Cuando alguien escribe "Esomeprazol x 40 mg" usando "x" como separador
  // antes de la dosis (no como multiplicador de empaque), PRESENTATION_QTY_RE
  // igual encuentra "X 40" ahí mismo, sin unidad propia (MG no es ML/L/G),
  // porque el número de la concentración también le sirve de cantidad. Ese
  // conteo sin unidad se descarta cuando cae justo sobre la concentración,
  // dejando un "X" pegado al principio activo ("ESOMEPRAZOL X") y rompiendo
  // la búsqueda. No se aplica a coincidencias CON unidad propia (p. ej. "LATA
  // X 400G" de una fórmula infantil), donde el mismo número sí describe
  // legítimamente tanto la "concentración" como el peso del envase.
  const concentrationStart = concentrationMatch?.index ?? -1;
  // Si el combinado trae más dosis pegadas con "+" ("5MG+60MG"), el final
  // real de la concentración se corre hasta el final de la ÚLTIMA parte,
  // no solo la primera -- necesario para que lo que venga después (forma
  // farmacéutica, presentación) no se confunda con parte de la dosis. Un
  // combinado de unidad compartida (SHARED_UNIT_MULTI_DOSE_RE) ya trae todas
  // sus dosis en el propio match, así que se arma el mismo objeto DosePart[]
  // directamente en vez de volver a buscar con EXTRA_DOSE_RE (que exige una
  // unidad propia por cada número, justo lo que este formato no tiene).
  const doseParts = sharedUnitMatch
    ? {
        parts: sharedUnitMatch[1].split("+").map((n) => ({
          value: parseColombianNumber(n.trim()),
          unit: normalizeConcentrationUnit(sharedUnitMatch[2].toUpperCase()),
        })),
        end: sharedUnitMatch.index + sharedUnitMatch[0].length,
      }
    : concentrationMatch
      ? extractDoseParts(upper, concentrationMatch)
      : null;
  const concentrationEnd = doseParts ? doseParts.end : -1;
  const presentationCandidates = [...upper.matchAll(PRESENTATION_QTY_RE)].filter((m) => {
    if (m[2]) return true;
    const start = m.index;
    const end = start + m[0].length;
    return end <= concentrationStart || start >= concentrationEnd;
  });
  // "100MG/5ML" -- el "/5ML" es la base por volumen de la propia
  // concentración (dosis por cada 5ml), no un tamaño de envase aparte.
  // CONCENTRATION_RE nunca lo incluyó en concentrationEnd (su razón interna
  // solo cubre "500/125", mismas unidades a ambos lados), así que se extiende
  // aparte, solo para que el respaldo de tamaño suelto no lo confunda con una
  // presentación real (bug real: "JARABETEST 100MG/5ML JBE" sin tamaño de
  // frasco mencionado tomaba el "5ML" como si el cliente hubiera pedido
  // frascos de 5ml).
  // El denominador es opcional ("10MG/ML" implica "10MG/1ML", tan válido
  // como escribirlo explícito) -- confirmado con el cliente (2026-09-30):
  // "50MG/5ML" y "10MG/ML" son la misma concentración real, y ambas formas
  // aparecen en datos reales.
  const concentrationRatioSuffix = /^\s*\/\s*(\d+(?:[.,]\d+)?)?\s*(ML|L|G)\b/i.exec(upper.slice(concentrationEnd));
  const bareMeasureExclusionEnd = concentrationRatioSuffix
    ? concentrationEnd + concentrationRatioSuffix[0].length
    : concentrationEnd;
  // Respaldo para cuando el tamaño real ("400 G") va suelto en vez de pegado
  // a una "X" (ver BARE_MEASURE_RE) -- solo se activa si ningún candidato
  // "X<numero><unidad>" ya trae unidad propia, para no interferir con el
  // caso normal (que siempre gana si existe). Se descarta cualquier
  // coincidencia que repita el mismo número y unidad de alguna dosis ya
  // extraída (p. ej. "AMPICILINA 1G INYECTABLE AMP 1G X10" -- el "1G" de
  // "AMP 1G" solo repite la dosis, no describe un tamaño de envase distinto;
  // sin este descarte, se perdía el conteo real de ampollas del "X10").
  const doseValues = new Set((doseParts?.parts ?? []).map((p) => `${p.value}\u0000${p.unit}`));
  const bareMeasureCandidates = presentationCandidates.some((m) => m[2])
    ? []
    : [...upper.matchAll(BARE_MEASURE_RE)].filter((m) => {
        const start = m.index;
        const end = start + m[0].length;
        if (doseValues.has(`${parseColombianNumber(m[1])}\u0000${m[2].toUpperCase()}`)) return false;
        return end <= concentrationStart || start >= bareMeasureExclusionEnd;
      });
  const allPresentationCandidates = [...presentationCandidates, ...bareMeasureCandidates];
  // Cuando hay varias coincidencias (p. ej. "C*1 FCO X 240ML"), se prefiere
  // la que trae volumen/peso explícito sobre un conteo de envases genérico.
  // Si ninguna trae unidad (p. ej. "C*1 FCO X 60 TAB"), se prefiere la
  // cantidad MÁS GRANDE: el conteo de envases ("C*1") casi siempre es un
  // número pequeño y poco interesante, mientras que el contenido real del
  // envase (60 tabletas) es el dato que importa para el precio por unidad
  // -- bug real (2026-09-22): se quedaba con "C*1" por aparecer primero en
  // el texto, y el precio de empaque terminaba calculado como si el frasco
  // trajera 1 sola tableta en vez de 60.
  const presentationMatch =
    allPresentationCandidates.find((m) => m[2]) ??
    allPresentationCandidates.reduce<RegExpMatchArray | null>((best, candidate) => {
      if (!best) return candidate;
      const bestQty = Number.parseFloat(parseColombianNumber(best[1]));
      const candidateQty = Number.parseFloat(parseColombianNumber(candidate[1]));
      return candidateQty > bestQty ? candidate : best;
    }, null);
  const singleUnitMatch = presentationMatch ? null : SINGLE_UNIT_CONTAINER_RE.exec(upper);

  if (!concentrationMatch || !doseParts) {
    return null;
  }
  if (!presentationMatch && !singleUnitMatch && requirePresentation) {
    return null;
  }

  if (singleUnitMatch) {
    warnings.push(
      `No se encontró una cantidad explícita de presentación; se asumió 1 (envase "${singleUnitMatch[1]}").`,
    );
  } else if (!presentationMatch && !requirePresentation) {
    warnings.push("No se especificó presentación; no afecta la homologación (se compara por unidad).");
  }

  const tokens = upper.split(/[^A-ZÁÉÍÓÚÑ]+/).filter(Boolean);

  const formMatch = matchDosageForm(upper);
  let dosageForm = formMatch?.dosageForm ?? null;
  const dosageFormTokenIndex = formMatch?.index ?? -1;
  if (!dosageForm) {
    dosageForm = "No especificada";
    warnings.push("No se pudo determinar la forma farmacéutica; se dejó 'No especificada'.");
  }

  let presentationType: string | null = null;
  for (const token of tokens) {
    const mapped = PRESENTATION_TYPE_MAP[token];
    if (mapped) {
      presentationType = mapped;
      break;
    }
  }
  if (!presentationType) {
    presentationType = "Caja";
    warnings.push("No se pudo determinar el tipo de empaque; se asumió 'Caja'.");
  }

  const cutIndex =
    dosageFormTokenIndex >= 0
      ? Math.min(dosageFormTokenIndex, concentrationMatch.index)
      : concentrationMatch.index;
  // Cuando la concentración combinada de varios principios activos viene entre
  // paréntesis ("...SIMETICONA (4G+4G+0.4G)/100ML..."), cortar justo antes del
  // primer número dentro del paréntesis deja un "(" colgando al final. Se
  // recorta esa puntuación suelta para no arrastrarla como si fuera parte del
  // nombre del ingrediente (confirmado en datos reales de varios combinados).
  // Además, cuando alguien escribe "Esomeprazol x 40 mg" usando "x" como
  // separador antes de la dosis (no como multiplicador de empaque), ese "X"
  // suelto queda pegado justo antes del corte; ningún principio activo real
  // termina en una "X" o "*" aislada, así que se recorta igual que la
  // puntuación (dato real: búsquedas de clientes con Esomeprazol).
  let activeIngredient = upper
    .slice(0, cutIndex)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[+(),./-]+$/, "")
    .replace(/\s[X*]$/, "")
    .trim();

  // "ACETAMINOFEN (PARACETAMOL) 1.000MG/100ML..." -- el alias entre
  // paréntesis queda ANTES de la concentración, así que el recorte de
  // puntuación de arriba se come el ")" de cierre pero deja el "(" de
  // apertura colgando ("ACETAMINOFEN (PARACETAMOL"). Un "(" sin su pareja es
  // la señal de que esto pasó: se descarta desde ese "(" en adelante -- el
  // alias entre paréntesis no aporta nada a la identidad del genérico, y
  // dejarlo a medias rompía tanto canonicalizeIngredient como cualquier
  // comparación contra el mismo principio activo escrito sin el alias (bug
  // real confirmado en producción: el Acetaminofén de Ramédicas nunca se
  // comparaba contra el de Disfarma/Ofimédicas por esto).
  const openParens = (activeIngredient.match(/\(/g) ?? []).length;
  const closeParens = (activeIngredient.match(/\)/g) ?? []).length;
  if (openParens > closeParens) {
    activeIngredient = activeIngredient.slice(0, activeIngredient.lastIndexOf("(")).trim();
  }

  if (!activeIngredient) {
    return null;
  }

  // Un combinado a veces se escribe con "/" entre los nombres de los
  // principios ("PIPERACILINA/TAZOBACTAM", "IPRATROPIO BROMURO/FENOTEROL")
  // en vez de "+" -- se normaliza a "+" aquí, antes del reordenamiento de
  // abajo, para que tanto canonicalizeIngredient como el reparto de dosis
  // por principio (más abajo) lo traten exactamente igual que el formato
  // "+" ya soportado (ver normalizeIngredientSeparators).
  activeIngredient = normalizeIngredientSeparators(activeIngredient);

  // Cuando el combinado trae varias dosis ("5MG+60MG"), el proveedor puede
  // listar los principios en cualquier orden -- confirmado con el cliente
  // (2026-09-24): "HIDROCORTISONA+LIDOCAINA 5MG+60MG" y "LIDOCAINA +
  // HIDROCORTISONA 60MG+5MG" son el mismo medicamento, pero antes no se
  // reconocían como tal (la ordenación por palabras de canonicalizeIngredient
  // no sirve de nada si la DOSIS de cada principio también quedó
  // intercambiada). Se reordenan nombre y dosis EN PAREJA, alfabéticamente
  // por principio, para que el orden del texto no cambie la identidad del
  // producto. Solo se aplica cuando hay tantos principios separados por "+"
  // como dosis encontradas; si no coinciden, se deja tal cual -- más
  // conservador que adivinar la asociación. Se unen con "/" (como el
  // formato de razón fija "500/125" que ya se aceptaba) y no con "+": un
  // genericKey nunca debe llevar "+" ni "(" (ver test de buildGenericKey).
  let finalActiveIngredient = activeIngredient;
  let finalConcentration = doseParts.parts[0].value;
  let finalConcentrationUnit = doseParts.parts[0].unit;
  if (doseParts.parts.length > 1) {
    const ingredientSegments = activeIngredient
      .split(/\s*\+\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ingredientSegments.length === doseParts.parts.length) {
      const paired = ingredientSegments
        .map((name, i) => ({ name, ...doseParts.parts[i] }))
        .sort((a, b) => a.name.localeCompare(b.name));
      finalActiveIngredient = paired.map((p) => p.name).join(" + ");
      finalConcentration = paired.map((p) => p.value).join("/");
      finalConcentrationUnit = paired[0].unit;
    }
  }

  // Cuando el mismo texto trae la concentración expresada de más de una forma
  // equivalente (p. ej. "2G/10ML (0,2G/ML) (20%)" -- las tres describen la
  // misma dosis), se prefiere la que viene en "%": es la única forma que no
  // depende de cómo cada proveedor eligió expresar la razón masa/volumen, así
  // que dos proveedores con la MISMA concentración real siempre terminan con
  // la misma clave genérica -- bug real confirmado (2026-09-29): el Sulfato
  // de Magnesio de Ramédicas ("2G/10ML...(20%)") y el de Disfarma ("20% SOL
  // INY") quedaban con concentración "2 G" y "20 %" respectivamente, en
  // genericKey distinto, y nunca se comparaban entre sí; lo mismo le pasaba a
  // la Nitrofurazona ("0,2G/100G (0,2%)" vs cómo la escribe un cliente,
  // "0.2%", directo). Solo aplica a principio activo único (los combinados ya
  // quedaron resueltos arriba) y solo si el propio texto trae un "%" en algún
  // lado -- nunca se convierte una unidad a otra por cuenta propia.
  if (doseParts.parts.length === 1) {
    const percentMatch = concentrationCandidates.find((m) => m[2]?.toUpperCase() === "%");
    if (percentMatch) {
      finalConcentration = parseColombianNumber(percentMatch[1]);
      finalConcentrationUnit = "%";
    } else if (concentrationRatioSuffix && !isSealedUnitForm(dosageForm)) {
      // "50MG/5ML" y "10MG/1ML" (o "10MG/ML", denominador 1 implícito) son
      // la MISMA concentración real (10mg por cada ml) -- confirmado con el
      // cliente (2026-09-30): sin reducir la razón a "por 1 unidad de
      // volumen/peso", dos ofertas idénticas descritas con un volumen de
      // referencia distinto (5ml vs 1ml) quedaban con concentración "50" y
      // "10" respectivamente, genericKey distinto, y nunca se comparaban ni
      // se homologaban entre sí al buscar por texto de cliente.
      //
      // Nunca se aplica a formas selladas (ampolla/inyectable): ahí el
      // envase NO se fracciona (ver isSealedUnitForm, lib/pricing/
      // measured-forms.ts) -- el volumen escrito es el contenido TOTAL de esa
      // presentación puntual, no una tasa que se puede medir en cualquier
      // cantidad. Bug real confirmado (2026-09-30): "40MG/0.4ML",
      // "60MG/0.6ML" y "80MG/0.8ML" de Enoxaparina son TRES presentaciones
      // reales distintas (jeringas precargadas de dosis distinta), pero las
      // tres reducen a la misma concentración "100MG/ML" -- reducir la razón
      // las fusionaba en una sola, como si fueran la misma jeringa.
      const denominatorValue = concentrationRatioSuffix[1] ? Number.parseFloat(parsePresentationVolumeNumber(concentrationRatioSuffix[1], upper)) : 1;
      const numeratorValue = Number.parseFloat(finalConcentration);
      if (denominatorValue > 0 && Number.isFinite(numeratorValue)) {
        finalConcentration = String(Math.round((numeratorValue / denominatorValue) * 10000) / 10000);
        finalConcentrationUnit = `${finalConcentrationUnit}/${concentrationRatioSuffix[2].toUpperCase()}`;
      }
    } else if (concentrationRatioSuffix && concentrationRatioSuffix[1] && isSealedUnitForm(dosageForm)) {
      // Para formas SELLADAS sí importa el volumen total de ESA presentación
      // puntual, cuando el texto lo dice explícitamente con un número
      // distinto de 1 -- confirmado en datos reales de producción
      // (2026-10-02): "BACLOFENO 10MG/20ML" (0,5mg/ml) y "BACLOFENO 10MG/5ML"
      // (2mg/ml) son DOS presentaciones reales con la misma dosis total pero
      // concentración/volumen distintos (igual pasa con Docetaxel,
      // Dexmedetomidina, Citarabina...) -- antes quedaban fusionadas en una
      // sola clave genérica, como si fueran intercambiables.
      //
      // Solo se agrega el volumen cuando el texto trae un NÚMERO explícito
      // ahí Y ese número no es 1: un denominador implícito ("20MG/ML", sin
      // dígito) o literal "/1ML" no agrega nada real -- es la forma más común
      // de expresar "por mililitro" y NO debe quedar separada de un proveedor
      // que simplemente omite el "/ML" (bug real: esto rompía la Hioscina N-
      // Butil Bromuro, cuyo envase SIEMPRE es de 1ml, entre un proveedor que
      // escribe "20MG/ML" y otro que solo pone "20MG").
      const denominatorValue = Number.parseFloat(parsePresentationVolumeNumber(concentrationRatioSuffix[1], upper));
      if (Number.isFinite(denominatorValue) && denominatorValue !== 1) {
        const formattedDenominator = String(Math.round(denominatorValue * 10000) / 10000);
        finalConcentration = `${finalConcentration}/${formattedDenominator}`;
        finalConcentrationUnit = `${finalConcentrationUnit}/${concentrationRatioSuffix[2].toUpperCase()}`;
      }
    } else {
      // "Ampicilina 1 g + Sulbactam 0.5 g" -- cada principio con su propia
      // dosis pegada antes del "+" (ver INTERLEAVED_COMBO_RE). Se revisa solo
      // cuando ninguno de los casos anteriores (razón %, razón MG/ML) ya
      // resolvió la concentración, igual que esos, solo para principio activo
      // único (un combinado real de 3+ principios en este formato no se
      // intenta -- más conservador que adivinar mal la asociación).
      const interleaved = INTERLEAVED_COMBO_RE.exec(upper);
      // Si un TERCER principio sigue con el mismo patrón ("+ INGREDIENTE3
      // DOSIS3"), esto es una fórmula de 3+ principios (p. ej. complejos
      // vitamínicos) -- no se intenta: quedarse solo con los primeros dos
      // fusionaría por error fórmulas distintas que comparten sus primeros
      // dos componentes pero difieren en el resto (bug real detectado antes
      // de desplegar: "Ácido Ascórbico + Ácido Fólico + Fumarato Ferroso +
      // Vitamina B12" perdía los últimos dos principios).
      const hasThirdSegment =
        interleaved &&
        /^\s*\+\s*[A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+)*?\s+\d+(?:[.,]\d+)?\s*(MG|MCG|UI|MEQ|GR|G|ML|%)\b/i.test(
          upper.slice(interleaved.index + interleaved[0].length),
        );
      if (interleaved && !hasThirdSegment) {
        const pair = [
          { name: interleaved[1].trim(), value: parseColombianNumber(interleaved[2]), unit: normalizeConcentrationUnit(interleaved[3].toUpperCase()) },
          { name: interleaved[4].trim(), value: parseColombianNumber(interleaved[5]), unit: normalizeConcentrationUnit(interleaved[6].toUpperCase()) },
        ].sort((a, b) => a.name.localeCompare(b.name));
        finalActiveIngredient = pair.map((p) => p.name).join(" + ");
        finalConcentration = pair.map((p) => p.value).join("/");
        finalConcentrationUnit = pair[0].unit;
      }
    }
  }

  let presentationQuantity: number;
  let presentationUnit: string;
  if (presentationMatch) {
    // Ver parsePresentationVolumeNumber: a diferencia de la dosis, un tamaño
    // de envase con 3 decimales exactos ("X 1.000ML") normalmente SÍ es
    // miles (bolsas/frascos de suero de 1 litro) -- excepto en una jeringa
    // precargada, donde ese mismo patrón es un volumen real y chico.
    const rawQuantity = Number.parseFloat(parsePresentationVolumeNumber(presentationMatch[1], upper));
    const volumeUnit = presentationMatch[2]?.toUpperCase();
    if (volumeUnit === "L") {
      presentationQuantity = Math.round(rawQuantity * 1000);
      presentationUnit = "ml";
    } else if (volumeUnit === "ML") {
      presentationQuantity = Math.round(rawQuantity);
      presentationUnit = "ml";
    } else if (volumeUnit === "G") {
      presentationQuantity = Math.round(rawQuantity);
      presentationUnit = "g";
    } else {
      presentationQuantity = Math.round(rawQuantity);
      presentationUnit = PRESENTATION_UNIT_BY_FORM[dosageForm] ?? "unidades";
    }
  } else {
    presentationQuantity = 1;
    presentationUnit = PRESENTATION_UNIT_BY_FORM[dosageForm] ?? "unidades";
  }

  return {
    attributes: {
      activeIngredient: finalActiveIngredient,
      concentration: finalConcentration,
      concentrationUnit: finalConcentrationUnit,
      dosageForm,
      presentationType,
      presentationQuantity,
      presentationUnit,
    },
    warnings,
    // true solo si el texto realmente traía un tamaño de envase explícito
    // (p. ej. "X30ML"), no cuando se asumió 1 por defecto (envase de una sola
    // unidad o cantidad no exigida). Distingue "el cliente pidió un tamaño
    // específico" de "no dijo ningún tamaño" -- necesario para saber si un
    // envase de otro tamaño puede compararse por costo total o si hay que
    // respetar el tamaño pedido (Sección: formas medidas/líquidas).
    presentationSpecified: presentationMatch !== null,
  };
}
