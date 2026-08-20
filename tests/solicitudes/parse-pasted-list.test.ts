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
});
