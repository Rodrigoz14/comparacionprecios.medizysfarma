import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem, resolveProductMatch } from "@/lib/matching/matching-service";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";

// "Zoltraxina" es un principio activo ficticio usado solo en estas pruebas, para
// no depender de (ni contaminar) datos reales o los del seed.
async function createProduct(rawName: string, laboratoryName: string) {
  const extraction = extractProductAttributes(rawName)!;
  const laboratoryNormalizedName = normalizeText(laboratoryName);
  const laboratory = await prisma.laboratory.upsert({
    where: { normalizedName: laboratoryNormalizedName },
    update: {},
    create: { name: laboratoryName, normalizedName: laboratoryNormalizedName },
  });
  const normalizedName = buildNormalizedName(extraction.attributes, laboratoryNormalizedName);
  return prisma.product.create({
    data: {
      standardName: rawName,
      normalizedName,
      genericKey: buildGenericKey(extraction.attributes),
      activeIngredient: extraction.attributes.activeIngredient,
      ingredientKey: canonicalizeIngredient(extraction.attributes.activeIngredient),
      concentration: extraction.attributes.concentration,
      concentrationUnit: extraction.attributes.concentrationUnit,
      dosageForm: extraction.attributes.dosageForm,
      presentationType: extraction.attributes.presentationType,
      presentationQuantity: extraction.attributes.presentationQuantity,
      presentationUnit: extraction.attributes.presentationUnit,
      laboratoryId: laboratory.id,
    },
  });
}

describe("resolveProductMatch (integracion contra base de datos real)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    const genfarVariant = await createProduct("ZOLTRAXINA TAB 100MG X30", "TestLab Genfar");
    const pfizerVariant = await createProduct("ZOLTRAXINA TAB 100MG X30", "TestLab Pfizer");
    const differentConcentration = await createProduct("ZOLTRAXINA TAB 200MG X30", "TestLab Genfar");
    const differentForm = await createProduct("ZOLTRAXINA CAPS 100MG X30", "TestLab Genfar");

    productIds.push(genfarVariant.id, pfizerVariant.id, differentConcentration.id, differentForm.id);
    laboratoryIds.push(genfarVariant.laboratoryId!, pfizerVariant.laboratoryId!);

    await prisma.ingredientSynonym.upsert({
      where: { term: "zoltraxinasal" },
      update: {},
      create: { term: "zoltraxinasal", canonicalTerm: "zoltraxina", source: "test" },
    });
  });

  afterAll(async () => {
    await prisma.customerRequestItem.deleteMany({ where: { matchedProductId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
    await prisma.ingredientSynonym.deleteMany({ where: { term: "zoltraxinasal" } });
  });

  it("coincidencia exacta devuelve TODOS los laboratorios del mismo generico con confianza 1", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 100MG X30");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds.sort()).toEqual([productIds[0], productIds[1]].sort());
    expect(result.source).toBe("deterministic");
  });

  it("nunca es MATCH cuando la concentracion es distinta, aunque el ingrediente coincida", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 999MG X30");
    expect(result.decision).not.toBe("MATCH");
  });

  it("ingrediente desconocido sin candidatos -> NO_MATCH", async () => {
    const result = await resolveProductMatch("INGREDIENTEDESCONOCIDOXYZ TAB 100MG X30");
    expect(result.decision).toBe("NO_MATCH");
    expect(result.matchedProductIds).toEqual([]);
  });

  it("texto sin concentracion/presentacion reconocible -> NO_MATCH inmediato, sin consultar la base de datos", async () => {
    const result = await resolveProductMatch("PRODUCTO SIN DATOS CLAROS");
    expect(result.decision).toBe("NO_MATCH");
    expect(result.source).toBe("none");
  });

  it("presentacion distinta sigue siendo MATCH: mismo generico, se compara por unidad en el motor de precios", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 100MG X90");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds.sort()).toEqual([productIds[0], productIds[1]].sort());
  });

  it("un cliente puede buscar sin indicar presentacion: la cantidad va en un campo aparte", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 100MG");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds.sort()).toEqual([productIds[0], productIds[1]].sort());
  });

  it("sin forma farmaceutica y con varias disponibles a la misma concentracion -> REVIEW, nunca NO_MATCH ni una eleccion a ciegas", async () => {
    // Bug real reportado por el cliente: "Acido Valproico 250mg" (sin decir
    // capsula/jarabe/tableta) caia en NO_MATCH aunque el producto existiera,
    // porque el puntaje por la forma farmaceutica ausente hundia el total
    // por debajo del umbral de revision. A 100mg este fixture tiene Tableta
    // (dos laboratorios) y Capsula, asi que es un caso realmente ambiguo.
    const result = await resolveProductMatch("ZOLTRAXINA 100MG");
    expect(result.decision).toBe("REVIEW");
    expect(result.matchedProductIds).toEqual([]);
    expect(result.reasons.join(" ")).toMatch(/forma farmac[ée]utica/i);
    // Bug real: la lista de candidatos mostraba solo los primeros 5 resultados
    // sin ordenar por relevancia, así que si un proveedor tenía muchas filas
    // (varios laboratorios de la misma forma), las opciones de otro proveedor
    // quedaban afuera. Debe haber un candidato por forma farmacéutica distinta
    // (Tableta, Cápsula), no uno por cada fila/laboratorio repetido.
    expect(result.candidates).toHaveLength(2);
    expect(new Set(result.candidates.map((c) => c.product.dosageForm))).toEqual(new Set(["Tableta", "Cápsula"]));
  });

  it("busca sin concentracion: lista las concentraciones disponibles en vez de terminar en NO_MATCH", async () => {
    // Bug real: buscar solo "Ácido Valproico" (sin decir la concentración) no
    // daba ninguna opción. Ahora debe mostrar qué concentraciones existen para
    // que el cliente elija, nunca adivinar cuál es.
    const result = await resolveProductMatch("ZOLTRAXINA");
    expect(result.decision).toBe("REVIEW");
    expect(result.matchedProductIds).toEqual([]);
    expect(result.reasons.join(" ")).toMatch(/concentraci[oó]n/i);
    expect(result.reasons.join(" ")).toMatch(/100MG/);
    expect(result.reasons.join(" ")).toMatch(/200MG/);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("coincidencia via sinonimo de ingrediente no es MATCH automatico (queda para revision sin IA configurada)", async () => {
    const result = await resolveProductMatch("ZOLTRAXINASAL TAB 100MG X30");
    expect(result.decision).toBe("REVIEW");
    expect(result.confidence).toBeLessThan(1);
    expect(result.matchedProductIds).toEqual([]);
  });

  it("resolveCustomerRequestItem persiste la decision en el item de la solicitud", async () => {
    const customerRequest = await prisma.customerRequest.create({
      data: { customerName: "Cliente de prueba" },
    });
    const item = await prisma.customerRequestItem.create({
      data: {
        customerRequestId: customerRequest.id,
        originalText: "ZOLTRAXINA TAB 100MG X30",
        requestedQuantity: 10,
      },
    });

    const result = await resolveCustomerRequestItem(item.id);
    expect(result.decision).toBe("MATCH");

    const updated = await prisma.customerRequestItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.matchStatus).toBe("MATCH");
    expect(Number(updated.matchConfidence)).toBe(1);
    expect(updated.matchedProductId).not.toBeNull();

    await prisma.customerRequestItem.delete({ where: { id: item.id } });
    await prisma.customerRequest.delete({ where: { id: customerRequest.id } });
  });
});

// Caso real reportado por el cliente: Ramedicas escribe "VALPROICO ACIDO"
// (alfabetizado) y Disfarma "ACIDO VALPROICO" (orden natural) para la misma
// sustancia; sin canonicalizar el orden de las palabras, ni la busqueda del
// cliente ni la comparacion de precios entre proveedores encontraban match.
describe("resolveProductMatch (orden de palabras del ingrediente activo)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    // "ZOLTRAXINICO ACIDO", orden alfabetizado como en los archivos de Ramedicas.
    const ramedicasStyle = await createProduct("ZOLTRAXINICO ACIDO 250MG CAPSULA X30", "TestLab Ramedicas Style");
    productIds.push(ramedicasStyle.id);
    laboratoryIds.push(ramedicasStyle.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("encuentra el producto sin importar el orden de las palabras del ingrediente", async () => {
    const result = await resolveProductMatch("ACIDO ZOLTRAXINICO 250MG CAPSULA X30");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds).toEqual([productIds[0]]);
  });

  it("combina ambas correcciones: sin presentacion y con el ingrediente en orden natural", async () => {
    const result = await resolveProductMatch("ACIDO ZOLTRAXINICO 250MG CAPSULA");
    expect(result.decision).toBe("MATCH");
    expect(result.matchedProductIds).toEqual([productIds[0]]);
  });

  it("sin forma farmaceutica pero con una sola disponible -> MATCH automatico, no hay ambiguedad real", async () => {
    const result = await resolveProductMatch("ACIDO ZOLTRAXINICO 250MG");
    expect(result.decision).toBe("MATCH");
    expect(result.matchedProductIds).toEqual([productIds[0]]);
  });
});

// Caso real reportado por el cliente: buscar "acido valprico" (typo, falta una
// letra) en vez de "acido valproico" no encontraba nada. La tolerancia a
// errores de tipeo nunca debe auto-confirmar: solo amplía qué se muestra para
// que un humano confirme, porque una sustancia distinta con nombre parecido
// no es intercambiable (a diferencia del orden de palabras o la presentación).
describe("resolveProductMatch (tolerancia a errores de tipeo en el ingrediente)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    const product = await createProduct("ZOLTRAXOLIDINA 250MG TABLETA X30", "TestLab Zoltraxolidina");
    productIds.push(product.id);
    laboratoryIds.push(product.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("un typo de una letra encuentra el candidato pero nunca hace MATCH automatico", async () => {
    const result = await resolveProductMatch("ZOLTRAXOLIDNA 250MG TABLETA X30");
    expect(result.decision).toBe("REVIEW");
    expect(result.matchedProductIds).toEqual([]);
    expect(result.candidates.map((c) => c.product.id)).toContain(productIds[0]);
    expect(result.reasons.join(" ")).toMatch(/error de tipeo/i);
  });

  it(
    "un ingrediente totalmente distinto no encuentra nada por mas tolerancia que se de",
    async () => {
      // Ficticio y muy distinto a cualquier ingrediente real del catalogo, para
      // no depender de qué productos reales existan en la base de datos compartida.
      // Este caso llega hasta el ultimo nivel de busqueda (nombre comercial), que
      // trae el catalogo activo completo (~11 mil productos) para compararlo en
      // memoria -- contra una base de datos alojada por red, eso mide unos
      // segundos en datos reales, mas que el timeout por defecto de la prueba.
      const result = await resolveProductMatch("INGREDIENTEDESCONOCIDOPQZ 250MG TABLETA X30");
      expect(result.decision).toBe("NO_MATCH");
      expect(result.matchedProductIds).toEqual([]);
    },
    15000,
  );
});

// Caso real reportado por el cliente: buscar "Hioscina" no encontraba nada,
// aunque el producto existe en ambos proveedores como "N-Butil Bromuro de
// Hioscina" (Disfarma) y "Hioscina N-Butil Bromuro" (Ramédicas, sin la
// preposición "de"). A diferencia de "ácido valproico" (mismo conjunto de
// palabras, orden distinto), aquí ni siquiera es el mismo conjunto de
// palabras -- ordenar alfabéticamente no basta para unificarlas, hace falta
// un sinónimo controlado explícito (igual que paracetamol/acetaminofén).
//
// El fixture original usaba "de" como la palabra que creaba el conjunto
// distinto (igual que el caso real de Hioscina), pero canonicalizeIngredient
// ahora filtra "de"/"del" (ver normalize.ts), así que esa palabra ya no basta
// para diferenciar los conjuntos -- se usa en su lugar una palabra compuesta
// pegada vs. separada ("BUTILBROMURO" vs "BROMURO BUTIL"), que replica el
// mismo problema real (palabras fusionadas vs. separadas, aún sin resolver
// de forma general) y sigue exigiendo el sinónimo.
describe("resolveProductMatch (sinonimos con distinto conjunto de palabras, no solo distinto orden)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const synonymTerms = ["zoltraxina bromuro butil", "zoltraxina"];

  beforeAll(async () => {
    // "BUTILBROMURO ZOLTRAXINA" (palabra fusionada) vs "ZOLTRAXINA BROMURO
    // BUTIL" (palabras separadas): mismo principio activo ficticio, distinto
    // conjunto de palabras -- el mismo patrón real de Hioscina, con nombres
    // inventados para no depender de datos reales ni de ediciones futuras
    // del seed.
    const fusionada = await createProduct("BUTILBROMURO ZOLTRAXINA 10MG TABLETA X30", "TestLab Zoltraxina Disfarma");
    const separada = await createProduct("ZOLTRAXINA BROMURO BUTIL 10MG TABLETA X30", "TestLab Zoltraxina Ramedicas");
    productIds.push(fusionada.id, separada.id);
    laboratoryIds.push(fusionada.laboratoryId!, separada.laboratoryId!);

    const canonical = canonicalizeIngredient("BUTILBROMURO ZOLTRAXINA");
    for (const term of synonymTerms) {
      await prisma.ingredientSynonym.upsert({
        where: { term },
        update: {},
        create: { term, canonicalTerm: canonical, source: "test" },
      });
    }
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
    await prisma.ingredientSynonym.deleteMany({ where: { term: { in: synonymTerms } } });
  });

  it("una busqueda del nombre base encuentra ambas variantes, sin importar que trian distinto set de palabras", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA 10MG TABLETA");
    expect(result.decision).not.toBe("NO_MATCH");
    const foundIds = result.matchedProductIds.length > 0 ? result.matchedProductIds : result.candidates.map((c) => c.product.id);
    expect(foundIds).toEqual(expect.arrayContaining([productIds[0], productIds[1]]));
  });
});

// Bug real reportado por el cliente: buscar "Hidroxido de aluminio +
// Simeticona suspension" no encontraba nada, aunque el producto real del
// catálogo (Disfarma, código 320243) lleva un tercer componente que el
// cliente no mencionó: "Aluminio Hidroxido + Magnesio Hidroxido +
// Simeticona". Se usa un principio activo ficticio para no depender de datos
// reales ni de ediciones futuras del seed.
describe("resolveProductMatch (subconjunto de palabras: combinado con un componente no mencionado)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    const combinado = await createProduct("ZOLTRAXINA + MEGATROLINA + SIMETIFENOL 4G SUSPENSION X240ML", "TestLab Zoltraxina Combinado");
    productIds.push(combinado.id);
    laboratoryIds.push(combinado.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("encuentra el combinado real aunque la busqueda omita uno de sus componentes", async () => {
    const result = await resolveProductMatch("Zoltraxina + Simetifenol suspensión x 360 ml");
    expect(result.decision).toBe("REVIEW");
    const foundIds = result.candidates.map((c) => c.product.id);
    expect(foundIds).toEqual(expect.arrayContaining([productIds[0]]));
    expect(result.reasons.join(" ")).toMatch(/principios activos adicionales/i);
  });

  it("nunca es MATCH automatico solo por subconjunto de palabras (requiere revision humana)", async () => {
    const result = await resolveProductMatch("Zoltraxina + Simetifenol suspensión x 360 ml");
    expect(result.decision).not.toBe("MATCH");
    expect(result.matchedProductIds).toEqual([]);
  });

  it("no encuentra nada si la busqueda menciona un ingrediente que el combinado no tiene", async () => {
    const result = await resolveProductMatch("Zoltraxina + Ibuprofenol suspensión x 360 ml");
    expect(result.decision).toBe("NO_MATCH");
  });
});

// Bug real reportado por el cliente: buscar "Verodual" no encontraba nada,
// aunque el producto existe con el nombre comercial "BERODUAL" (confundido
// por el mismo sonido de B/V en español) entre paréntesis en los datos de
// Disfarma ("...FCO X 20ML (BERODUAL) - BOEHRINGER"). Se usa un principio
// activo y una marca ficticios para no depender de datos reales.
describe("resolveProductMatch (nombre comercial entre parentesis, no principio activo)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    const product = await createProduct(
      "ZOLTRAXAMINA 5MG SOLUCION PARA INHALACION FCO X20ML (ZOLTRODUAL) - TestLab Zoltrodual",
      "TestLab Zoltrodual",
    );
    productIds.push(product.id);
    laboratoryIds.push(product.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("encuentra el producto por su nombre comercial, aunque no coincida con ningun principio activo", async () => {
    const result = await resolveProductMatch("Zoltrodual solución para nebulizar");
    expect(result.decision).toBe("REVIEW");
    const foundIds = result.candidates.map((c) => c.product.id);
    expect(foundIds).toEqual(expect.arrayContaining([productIds[0]]));
    expect(result.reasons.join(" ")).toMatch(/nombre comercial/i);
  });

  it("tolera un error de tipeo/transcripcion en el nombre comercial (p. ej. confusion B/V)", async () => {
    const result = await resolveProductMatch("Zeltrodual solución para nebulizar");
    const foundIds = result.candidates.map((c) => c.product.id);
    expect(foundIds).toEqual(expect.arrayContaining([productIds[0]]));
  });

  it("nunca es MATCH automatico solo por nombre comercial (requiere revision humana)", async () => {
    const result = await resolveProductMatch("Zoltrodual solución para nebulizar");
    expect(result.decision).not.toBe("MATCH");
    expect(result.matchedProductIds).toEqual([]);
  });
});

// Bug real reportado por el cliente: buscar "Carboximetilcelulosa gotas al
// 0.5%" no encontraba el producto real (Disfarma, codigo 320231), guardado
// en el catalogo como "5MG/ML (0.5%)" -- la misma concentracion, solo
// expresada en mg/mL en vez de porcentaje. Se usa un principio activo
// ficticio para no depender de datos reales.
describe("resolveProductMatch (concentracion en porcentaje equivalente a mg/mL)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    const target = await createProduct("ZOLTRACELULOSA 5MG SOLUCION OFTALMICA FCO X15ML", "TestLab Zoltracelulosa");
    const otraConcentracion = await createProduct(
      "ZOLTRACELULOSA 10MG SOLUCION OFTALMICA FCO X15ML",
      "TestLab Zoltracelulosa",
    );
    productIds.push(target.id, otraConcentracion.id);
    laboratoryIds.push(target.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("encuentra el producto en mg/mL a partir de una busqueda en porcentaje equivalente (0.5% = 5mg/mL)", async () => {
    const result = await resolveProductMatch("Zoltracelulosa solución 0.5%");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds).toEqual([productIds[0]]);
  });

  it("no confunde una concentracion en porcentaje con otra concentracion distinta (1% = 10mg/mL, no 0.5%)", async () => {
    const result = await resolveProductMatch("Zoltracelulosa solución 1%");
    expect(result.decision).toBe("MATCH");
    expect(result.matchedProductIds).toEqual([productIds[1]]);
  });
});

// Pedido explícito del cliente: no ofrecer para elegir una opción que ningún
// proveedor tiene en existencia — sería un callejón sin salida.
describe("resolveProductMatch (no ofrece opciones sin existencia confirmada)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];

  beforeAll(async () => {
    // Misma concentración, dos formas distintas: una con existencia
    // confirmada (AVAILABLE) y otra sin ninguna oferta -- ambigüedad real de
    // forma farmacéutica, igual que el patrón ya cubierto para Zoltraxina.
    const conStock = await createProduct("ZOLTRAXOFEN TAB 50MG X30", "TestLab Zoltraxofen Con Stock");
    const sinStock = await createProduct("ZOLTRAXOFEN CAPS 50MG X30", "TestLab Zoltraxofen Sin Stock");
    productIds.push(conStock.id, sinStock.id);
    laboratoryIds.push(conStock.laboratoryId!, sinStock.laboratoryId!);

    const supplier = await prisma.supplier.create({ data: { name: "Proveedor Test Stock" } });
    supplierIds.push(supplier.id);
    await prisma.supplierOffer.create({
      data: { supplierId: supplier.id, productId: conStock.id, price: 1000, availability: "AVAILABLE" },
    });
    // sinStock no recibe ninguna oferta a propósito.
  });

  afterAll(async () => {
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("excluye de las opciones un candidato sin ninguna oferta, cuando otro si tiene existencia", async () => {
    const result = await resolveProductMatch("ZOLTRAXOFEN 50MG");
    const ids = result.candidates.map((c) => c.product.id);
    expect(ids).toContain(productIds[0]); // con stock: se muestra
    expect(ids).not.toContain(productIds[1]); // sin stock: se excluye
  });
});

describe("resolveProductMatch (todas las opciones sin existencia: se muestran igual, con nota)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    // Dos formas ambiguas, ninguna con ninguna oferta: forzar el caso donde
    // filtrar por existencia dejaría la lista vacía -- mejor mostrar las
    // opciones sin confirmar que no mostrar nada.
    const tableta = await createProduct("ZOLTRAXAGEL TAB 75MG X30", "TestLab Zoltraxagel A");
    const capsula = await createProduct("ZOLTRAXAGEL CAPS 75MG X30", "TestLab Zoltraxagel B");
    productIds.push(tableta.id, capsula.id);
    laboratoryIds.push(tableta.laboratoryId!, capsula.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("si ninguna opcion tiene existencia confirmada, las muestra igual con una nota explicita", async () => {
    const result = await resolveProductMatch("ZOLTRAXAGEL 75MG");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.reasons.join(" ")).toMatch(/existencia confirmada/i);
  });
});
