import { describe, expect, it } from "vitest";
import { parsePastedList } from "@/lib/solicitudes/parse-pasted-list";

describe("parsePastedList", () => {
  it("interpreta cantidad al inicio de la linea", () => {
    const result = parsePastedList("20 Acetaminofén 500mg x100");
    expect(result).toEqual([{ text: "Acetaminofén 500mg x100", quantity: 20 }]);
  });

  it("interpreta cantidad al final con guion", () => {
    const result = parsePastedList("Acetaminofén 500mg x100 - 20");
    expect(result).toEqual([{ text: "Acetaminofén 500mg x100", quantity: 20 }]);
  });

  it("interpreta cantidad al final con doble espacio (pegado de tabla)", () => {
    const result = parsePastedList("Acetaminofén 500mg x100  20");
    expect(result).toEqual([{ text: "Acetaminofén 500mg x100", quantity: 20 }]);
  });

  it("interpreta cantidad al final con la palabra unidades", () => {
    const result = parsePastedList("Losartán 50mg x30 (15 unidades)");
    expect(result).toEqual([{ text: "Losartán 50mg x30", quantity: 15 }]);
  });

  it("NUNCA confunde la presentacion del producto (x100) con la cantidad", () => {
    // Sin cantidad explicita: el "x100" es parte del nombre, no una cantidad.
    const result = parsePastedList("Acetaminofén 500mg x100");
    expect(result).toEqual([{ text: "Acetaminofén 500mg x100", quantity: 1 }]);
  });

  it("interpreta columnas separadas por tabulacion (pegado desde Excel/Word)", () => {
    const result = parsePastedList("Acetaminofén 500mg x100\t20");
    expect(result).toEqual([{ text: "Acetaminofén 500mg x100", quantity: 20 }]);
  });

  it("procesa varias lineas a la vez", () => {
    const result = parsePastedList(
      "20 Acetaminofén 500mg x100\nLosartán 50mg x30 - 15\nOmeprazol 20mg x30",
    );
    expect(result).toEqual([
      { text: "Acetaminofén 500mg x100", quantity: 20 },
      { text: "Losartán 50mg x30", quantity: 15 },
      { text: "Omeprazol 20mg x30", quantity: 1 },
    ]);
  });

  it("ignora lineas vacias", () => {
    const result = parsePastedList("20 Acetaminofén 500mg x100\n\n\nLosartán 50mg x30 - 15\n");
    expect(result).toHaveLength(2);
  });

  describe("palabras de empaque despues de la cantidad (datos reales de clientes)", () => {
    // Bug real: "Estrogenos conjugados crema: 10 tubos" no calzaba con ningun
    // patron (solo se reconocia unid/und/u), asi que la linea completa —con el
    // "10" incluido— quedaba como texto del producto con cantidad 1. Ese "10"
    // suelto en el texto despues hacia que la homologacion se negara a
    // interpretarlo (un digito ahi se lee como una posible concentracion mal
    // escrita), terminando en NO_MATCH aunque el producto si existiera.
    it("reconoce 'tubos' como palabra de empaque", () => {
      const result = parsePastedList("Estrogenos conjugados crema: 10 tubos");
      expect(result).toEqual([{ text: "Estrogenos conjugados crema", quantity: 10 }]);
    });

    it("reconoce 'frascos' como palabra de empaque", () => {
      const result = parsePastedList("Berodual solución para nebulizar: 3 frascos");
      expect(result).toEqual([{ text: "Berodual solución para nebulizar", quantity: 3 }]);
    });

    it("no confunde un numero que es parte del nombre con la cantidad al final", () => {
      const result = parsePastedList("Vaselina crema x 500 ml: 3 frascos");
      expect(result).toEqual([{ text: "Vaselina crema x 500 ml", quantity: 3 }]);
    });

    it("reconoce cajas, ampollas y viales", () => {
      expect(parsePastedList("Dexametasona ampolla: 20 ampollas")).toEqual([
        { text: "Dexametasona ampolla", quantity: 20 },
      ]);
      expect(parsePastedList("Insulina glargina: 5 viales")).toEqual([{ text: "Insulina glargina", quantity: 5 }]);
      expect(parsePastedList("Ibuprofeno 400mg x30: 2 cajas")).toEqual([
        { text: "Ibuprofeno 400mg x30", quantity: 2 },
      ]);
    });
  });
});
