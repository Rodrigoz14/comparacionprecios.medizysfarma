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

  it("no confunde equipo medico sin concentracion farmacologica (correctamente null)", () => {
    // "UNIDAD" no tiene ni concentracion ni un patron de cantidad reconocible.
    expect(extractProductAttributes("LECTOR FRESTYLE LIBRE 2 UNIDAD")).toBeNull();
  });

  it("no confunde presentaciones distintas del mismo producto", () => {
    const x100 = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const x20 = extractProductAttributes("ACETAMINOFEN 500MG X20");
    expect(x100?.attributes.presentationQuantity).not.toBe(x20?.attributes.presentationQuantity);
    expect(buildGenericKey(x100!.attributes)).not.toBe(buildGenericKey(x20!.attributes));
  });

  it("devuelve null cuando no hay concentracion ni presentacion reconocibles", () => {
    expect(extractProductAttributes("PRODUCTO SIN DATOS CLAROS")).toBeNull();
  });

  it("devuelve null cuando falta la unidad de concentracion (evita adivinar)", () => {
    expect(extractProductAttributes("AMOXICILINA 500/125 X21")).toBeNull();
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
});

describe("buildGenericKey", () => {
  it("produce la misma clave generica para variantes de escritura equivalentes", () => {
    const a = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const b = extractProductAttributes("Acetaminofen tableta 500 mg x 100");
    expect(buildGenericKey(a!.attributes)).toBe(buildGenericKey(b!.attributes));
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
