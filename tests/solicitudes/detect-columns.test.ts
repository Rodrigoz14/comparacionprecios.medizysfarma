import { describe, expect, it } from "vitest";
import { detectRequestColumns } from "@/lib/solicitudes/detect-columns";
import type { RawRow } from "@/lib/excel/types";

function row(...values: (string | number | null)[]): RawRow {
  const raw: RawRow = {};
  values.forEach((v, i) => {
    raw[i] = v;
  });
  return raw;
}

describe("detectRequestColumns (columna de cliente)", () => {
  it("detecta la columna de cliente por el encabezado, aunque haya columnas de precio de por medio", () => {
    const rows: RawRow[] = [
      row("Cliente", "Producto", "Cantidad", "P1", "P2", "P3"),
      row("SALUD V", "HEPARINA SODICA 5.000 UI/ML SOLUCION INYECTABLE", 100, 17595, 14793, 16071),
      row("SALUD V", "HIOSCINA N-BUTIL BROMURO 20 MG/ML SOLUCION INYECTABLE", 20, 819, 795, 1429),
      row("SANTOS", "NIMODIPINO 30MG C*100 TAB", 300, null, 155, 125),
      row("SANTOS", "ATROPINA SULFATO 1MG/ML SOL INY", 20, 848, null, 1072),
    ];

    const result = detectRequestColumns(rows);

    expect(result.clientColumn).toBe(0);
    expect(result.productColumn).toBe(1);
    expect(result.quantityColumn).toBe(2);
  });

  it("sin columna de cliente, no detecta ninguna (solo producto y cantidad)", () => {
    const rows: RawRow[] = [
      row("Producto", "Cantidad"),
      row("Acetaminofén 500mg x100", 20),
      row("Losartán 50mg x30", 15),
    ];

    const result = detectRequestColumns(rows);

    expect(result.clientColumn).toBeNull();
  });

  it("sin encabezados, usa la repetición de valores cortos para detectar la columna de cliente", () => {
    const rows: RawRow[] = [
      row("SALUD V", "Acetaminofén 500mg x100", 20),
      row("SALUD V", "Losartán 50mg x30", 15),
      row("SANTOS", "Omeprazol 20mg x30", 10),
      row("SANTOS", "Ibuprofeno 400mg x30", 5),
    ];

    const result = detectRequestColumns(rows);

    expect(result.clientColumn).toBe(0);
    expect(result.productColumn).toBe(1);
  });
});
