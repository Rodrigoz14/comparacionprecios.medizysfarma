import { describe, expect, it } from "vitest";
import { extractProductAttributes, normalizeDosageForm } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName } from "@/lib/matching/normalize";

describe("extractProductAttributes", () => {
  it("extrae atributos de 'ACETAMINOFEN TAB 500MG X100'", () => {
    const result = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    expect(result).not.toBeNull();
    expect(result?.attributes).toMatchObject({
      activeIngredient: "ACETAMINOFEN",
      concentration: "500",
      concentrationUnit: "MG",
      dosageForm: "Tableta",
      presentationQuantity: 100,
    });
  });

  it("extrae atributos de 'PARACETAMOL 500 MG TABLETAS CAJA X 100'", () => {
    const result = extractProductAttributes("PARACETAMOL 500 MG TABLETAS CAJA X 100");
    expect(result).not.toBeNull();
    expect(result?.attributes).toMatchObject({
      activeIngredient: "PARACETAMOL",
      concentration: "500",
      concentrationUnit: "MG",
      dosageForm: "Tableta",
      presentationType: "Caja",
      presentationQuantity: 100,
    });
  });

  it("extrae la concentracion compuesta de 'AMOXICILINA + CLAVULANATO 500/125 MG X21'", () => {
    const result = extractProductAttributes("AMOXICILINA + CLAVULANATO 500/125 MG X21");
    expect(result).not.toBeNull();
    expect(result?.attributes.concentration).toBe("500/125");
    expect(result?.attributes.presentationQuantity).toBe(21);
  });

  // Casos tomados de un archivo real de Ramedicas (.xlsm), donde la presentacion
  // suele venir en su propia columna, separada del nombre del producto.
  describe("presentaciones por volumen/peso (columna separada, sin espacio antes de la unidad)", () => {
    it("convierte litros a mililitros", () => {
      const result = extractProductAttributes("LOSARTAN 50MG SOLUCION ORAL FRASCO X 1.5L");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(1500);
      expect(result?.attributes.presentationUnit).toBe("ml");
    });

    it("reconoce mililitros pegados a la unidad (X 30ML)", () => {
      const result = extractProductAttributes(
        "RISPERIDONA 1MG/ML (0,1%) SOLUCION ORAL CAJA CON FRASCO X 30ML",
      );
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(30);
      expect(result?.attributes.presentationUnit).toBe("ml");
    });

    it("reconoce gramos pegados a la unidad (X 400G)", () => {
      const result = extractProductAttributes(
        "APME EN POLVO FORMULA POLIMERICA PARA NINOS LATA X 400G",
      );
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(400);
      expect(result?.attributes.presentationUnit).toBe("g");
    });
  });

  it("asume cantidad 1 para envases de una sola unidad sin numero explicito (CAJA X VIAL)", () => {
    const result = extractProductAttributes(
      "TOXINA BOTULINICA TIPO A 100UI POLVO A SOLUCION INYECTABLE CAJA X VIAL",
    );
    expect(result).not.toBeNull();
    expect(result?.attributes.presentationQuantity).toBe(1);
    expect(result?.warnings.some((w) => w.includes("se asumió 1"))).toBe(true);
  });

  it("quita el prefijo de canal EPS- del ingrediente activo (dato real Disfarma)", () => {
    const conPrefijo = extractProductAttributes("EPS-ZOPICLONA 7.5MG C*30 TAB - RECIPE");
    const sinPrefijo = extractProductAttributes("ZOPICLONA 7.5MG C*30 TAB - RECIPE");
    expect(conPrefijo).not.toBeNull();
    expect(conPrefijo?.attributes.activeIngredient).toBe("ZOPICLONA");
    // Con o sin el prefijo del proveedor, debe quedar la misma clave generica
    // para que un cliente que escribe "Zopiclona" (sin EPS-) sí lo encuentre.
    expect(buildGenericKey(conPrefijo!.attributes)).toBe(buildGenericKey(sinPrefijo!.attributes));
  });

  // Casos tomados de un archivo real de Disfarma, que usa "*" en vez de "X"
  // como separador de cantidad.
  describe("separador de presentacion con asterisco (Disfarma)", () => {
    it("reconoce '*30' igual que 'X30'", () => {
      const result = extractProductAttributes("ABACAVIR 600MG FCO*30 TAB");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(30);
    });

    it("prefiere el volumen explicito sobre un conteo de envases cuando hay varias coincidencias", () => {
      // "C*1" (1 envase) aparece antes que "X 240ML" (el contenido real).
      const result = extractProductAttributes("ABACAVIR 20MG/ML SOL ORL C*1 FCO X 240ML");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(240);
      expect(result?.attributes.presentationUnit).toBe("ml");
    });

    it("asume cantidad 1 para 'FCO*1' sin unidad explicita, igual que con X", () => {
      const result = extractProductAttributes("PRODUCTO 100MG CAJA*VIAL");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(1);
    });
  });

  it("no confunde equipo medico sin concentracion farmacologica (correctamente null)", () => {
    // "UNIDAD" no tiene ni concentracion ni un patron de cantidad reconocible.
    expect(extractProductAttributes("LECTOR FRESTYLE LIBRE 2 UNIDAD")).toBeNull();
  });

  it("reconoce presentaciones distintas del mismo producto como el mismo generico (se comparan por unidad)", () => {
    const x100 = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const x20 = extractProductAttributes("ACETAMINOFEN TAB 500MG X20");
    expect(x100?.attributes.presentationQuantity).not.toBe(x20?.attributes.presentationQuantity);
    // La presentacion ya no forma parte de la clave generica: caja x100 y caja
    // x20 del mismo medicamento deben quedar bajo la misma clave para poder
    // compararse por precio unitario en el motor de precios.
    expect(buildGenericKey(x100!.attributes)).toBe(buildGenericKey(x20!.attributes));
    expect(buildNormalizedName(x100!.attributes, null)).not.toBe(buildNormalizedName(x20!.attributes, null));
  });

  it("devuelve null cuando no hay concentracion ni presentacion reconocibles", () => {
    expect(extractProductAttributes("PRODUCTO SIN DATOS CLAROS")).toBeNull();
  });

  it("devuelve null cuando falta la unidad de concentracion (evita adivinar)", () => {
    expect(extractProductAttributes("AMOXICILINA 500/125 X21")).toBeNull();
  });

  describe("requirePresentation: false (busqueda de cliente)", () => {
    it("sigue devolviendo null sin concentracion, con o sin presentacion", () => {
      expect(extractProductAttributes("PRODUCTO SIN DATOS CLAROS", { requirePresentation: false })).toBeNull();
    });

    it("no devuelve null cuando falta la presentacion; asume cantidad 1", () => {
      const result = extractProductAttributes("ACIDO VALPROICO 250MG CAPSULA", { requirePresentation: false });
      expect(result).not.toBeNull();
      expect(result?.attributes).toMatchObject({
        activeIngredient: "ACIDO VALPROICO",
        concentration: "250",
        concentrationUnit: "MG",
        dosageForm: "Cápsula",
        presentationQuantity: 1,
      });
    });

    it("sigue exigiendo presentacion por defecto (importacion de proveedores)", () => {
      expect(extractProductAttributes("ACIDO VALPROICO 250MG CAPSULA")).toBeNull();
    });
  });

  it("reconoce 'CAP' como abreviatura de capsula (visto en datos reales de Disfarma)", () => {
    const result = extractProductAttributes("ACIDO VALPROICO 250MG FCO*50 CAP");
    expect(result?.attributes.dosageForm).toBe("Cápsula");
  });

  it("reconoce 'crema vaginal' como forma distinta de 'crema' a secas, sin importar como venga escrito", () => {
    // Bug real: "Estrogenos Conjugados crema" no aparecia en la busqueda porque
    // Disfarma reporta la forma como "CREM VAG" (columna aparte, sin reconocer
    // antes de este fix -> se guardaba tal cual) y Ramedicas la escribe dentro
    // del nombre ("...CREMA VAGINAL"), pero el escaneo palabra por palabra se
    // quedaba en "CREMA" y nunca llegaba a leer "VAGINAL". Una crema vaginal y
    // una crema topica no son intercambiables, asi que deben quedar como formas
    // farmaceuticas distintas (no colapsar ambas a "Crema").
    const disfarma = extractProductAttributes("ESTROGENOS CONJUGADOS 0.625MG/G CREM VAG TUBX43G+APLIC CX1");
    const ramedicas = extractProductAttributes("ESTROGENOS CONJUGADOS 0,625MG/G CREMA VAGINAL X43G");
    expect(disfarma?.attributes.dosageForm).toBe("Crema vaginal");
    expect(ramedicas?.attributes.dosageForm).toBe("Crema vaginal");
    expect(buildGenericKey(disfarma!.attributes)).toBe(buildGenericKey(ramedicas!.attributes));

    // Una crema topica normal sigue siendo "Crema", no se mezcla con la vaginal.
    const topica = extractProductAttributes("KETOCONAZOL 2G/100G CREMA TOPICA TUBX30G");
    expect(topica?.attributes.dosageForm).toBe("Crema");
    expect(buildGenericKey(topica!.attributes)).not.toBe(buildGenericKey(ramedicas!.attributes));
  });

  it("reconoce 'CREM' y 'GEL' como abreviaturas (visto en datos reales de Disfarma: CREM TOP, GEL TOP)", () => {
    expect(extractProductAttributes("SULFADIAZINA PLATA 1G/100G CREM TOP TUB*30G")?.attributes.dosageForm).toBe("Crema");
    expect(extractProductAttributes("KETOPROFENO 2.5G/100G GEL TOP TUB*60G")?.attributes.dosageForm).toBe("Gel");
  });
});

describe("normalizeDosageForm", () => {
  it("normaliza una forma compuesta reportada por columna al vocabulario controlado", () => {
    expect(normalizeDosageForm("SOLUCION INYECTABLE")).toBe("Solución");
    expect(normalizeDosageForm("TABLETA RECUBIERTA")).toBe("Tableta");
  });

  it("devuelve null cuando no reconoce ninguna palabra clave", () => {
    expect(normalizeDosageForm("DISPOSITIVO INTRAUTERINO")).toBeNull();
  });

  it("produce el mismo valor que la extraccion por texto libre (evita romper genericKey)", () => {
    // Un importador que reciba "SOLUCION INYECTABLE" en una columna aparte debe
    // normalizarla igual que si viniera escrita dentro del nombre del producto,
    // o dos filas del mismo generico terminan con genericKey distinto.
    const fromText = extractProductAttributes("DICLOFENACO 75MG SOLUCION INYECTABLE X10");
    expect(normalizeDosageForm("SOLUCION INYECTABLE")).toBe(fromText?.attributes.dosageForm);
  });

  it("prioriza la frase completa sobre la primera palabra suelta (crema vaginal vs crema)", () => {
    // Dato real de la columna FORMA_FARMACEUTICA de Disfarma.
    expect(normalizeDosageForm("CREM VAG")).toBe("Crema vaginal");
    expect(normalizeDosageForm("CREMA VAGINAL")).toBe("Crema vaginal");
    expect(normalizeDosageForm("CREMA")).toBe("Crema");
  });
});

describe("buildGenericKey", () => {
  it("produce la misma clave generica para variantes de escritura equivalentes", () => {
    const a = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const b = extractProductAttributes("Acetaminofen tableta 500 mg x 100");
    expect(buildGenericKey(a!.attributes)).toBe(buildGenericKey(b!.attributes));
  });

  it("ignora el orden de las palabras del ingrediente activo (Ramedicas vs Disfarma)", () => {
    // Caso real: Ramedicas escribe "VALPROICO ACIDO" (alfabetizado) y Disfarma
    // "ACIDO VALPROICO" (orden natural) para la misma sustancia — sin esto,
    // nunca se comparaban entre proveedores ni se encontraban por busqueda.
    const disfarma = extractProductAttributes("ACIDO VALPROICO 250MG JARABE X120ML");
    const ramedicas = extractProductAttributes("VALPROICO ACIDO 250MG JARABE X120ML");
    expect(buildGenericKey(disfarma!.attributes)).toBe(buildGenericKey(ramedicas!.attributes));
  });
});

describe("buildNormalizedName", () => {
  it("distingue el mismo generico ofrecido por laboratorios distintos", () => {
    const attrs = extractProductAttributes("ACETAMINOFEN TAB 500MG X100")!.attributes;
    const genfar = buildNormalizedName(attrs, "genfar");
    const pfizer = buildNormalizedName(attrs, "pfizer");
    expect(genfar).not.toBe(pfizer);
    expect(buildGenericKey(attrs)).toBe(buildGenericKey(attrs)); // misma clave generica
  });

  it("usa un sufijo estable cuando no se conoce el laboratorio", () => {
    const attrs = extractProductAttributes("ACETAMINOFEN TAB 500MG X100")!.attributes;
    expect(buildNormalizedName(attrs, null)).toBe(buildNormalizedName(attrs, null));
    expect(buildNormalizedName(attrs, null)).not.toBe(buildNormalizedName(attrs, "genfar"));
  });
});
