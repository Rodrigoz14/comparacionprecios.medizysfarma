import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem } from "@/lib/matching/matching-service";
import { selectBestOffer } from "@/lib/pricing/selection-engine";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";

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

async function createRequestItem(text: string, quantity: number) {
  const request = await prisma.customerRequest.create({ data: { customerName: "Cliente de prueba precios" } });
  const item = await prisma.customerRequestItem.create({
    data: { customerRequestId: request.id, originalText: text, requestedQuantity: quantity },
  });
  return { requestId: request.id, itemId: item.id };
}

// Fixtures propios en vez de datos del seed: el seed comparte el mismo espacio
// de nombres normalizados que los datos reales importados de proveedores, así
// que un producto "de ejemplo" puede terminar con precios reales encima.
describe("selectBestOffer (integracion contra base de datos real)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];

  beforeAll(async () => {
    const genfarVariant = await createProduct("PRICETEST TAB 50MG X10", "TestLab Genfar Precio");
    const pfizerVariant = await createProduct("PRICETEST TAB 50MG X10", "TestLab Pfizer Precio");
    productIds.push(genfarVariant.id, pfizerVariant.id);
    laboratoryIds.push(genfarVariant.laboratoryId!, pfizerVariant.laboratoryId!);

    const supplierX = await prisma.supplier.create({ data: { name: "Proveedor Precio Test X" } });
    const supplierY = await prisma.supplier.create({ data: { name: "Proveedor Precio Test Y" } });
    supplierIds.push(supplierX.id, supplierY.id);

    // X ofrece ambos laboratorios: el generico (Genfar) mas barato que el de marca (Pfizer).
    await prisma.supplierOffer.create({
      data: { supplierId: supplierX.id, productId: genfarVariant.id, price: 5000, availability: "AVAILABLE", stockQuantity: 200 },
    });
    await prisma.supplierOffer.create({
      data: { supplierId: supplierX.id, productId: pfizerVariant.id, price: 20000, availability: "AVAILABLE", stockQuantity: 50 },
    });
    // Y tambien ofrece el generico, un poco mas caro que X.
    await prisma.supplierOffer.create({
      data: { supplierId: supplierY.id, productId: genfarVariant.id, price: 5300, availability: "AVAILABLE", stockQuantity: 80 },
    });
  });

  afterAll(async () => {
    await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("elige el precio mas bajo entre laboratorios distintos del mismo generico", async () => {
    const { itemId } = await createRequestItem("PRICETEST TAB 50MG X10", 10);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);

    expect(result.status).toBe("SELECTED");
    expect(result.selected?.supplierId).toBe(supplierIds[0]); // Proveedor X + Genfar, el mas barato
    expect(result.selected?.packagePrice).toBe(5000);
    expect(result.selected?.packagesNeeded).toBe(1); // 10 solicitadas, caja x10
    expect(result.totalPrice).toBe(5000);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(3); // X/Genfar, X/Pfizer, Y/Genfar

    const persisted = await prisma.priceComparison.findMany({ where: { customerRequestItemId: itemId } });
    expect(persisted.length).toBe(result.alternatives.length);
    expect(persisted.filter((p) => p.selected).length).toBe(1);
  });

  it("NOT_FOUND cuando la homologacion no encontro el producto", async () => {
    const { itemId } = await createRequestItem("INGREDIENTEDESCONOCIDOXYZ TAB 100MG X30", 5);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.selected).toBeNull();
  });

  it("NO_STOCK cuando ninguna oferta tiene existencia suficiente", async () => {
    const { itemId } = await createRequestItem("PRICETEST TAB 50MG X10", 500); // supera el stock de ambos proveedores
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("NO_STOCK");
    expect(result.selected).toBeNull();
    expect(result.alternatives.every((a) => !a.eligible)).toBe(true);
  });

  it("REVIEW cuando el item aun no fue homologado (MatchStatus PENDING)", async () => {
    const { itemId } = await createRequestItem("PRICETEST TAB 50MG X10", 1);
    // No se llama a resolveCustomerRequestItem: el item queda en PENDING.
    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("REVIEW");
    expect(result.selected).toBeNull();
  });
});

// Caso real reportado por el cliente: Sildenafil 100mg en caja x30 (Ramedicas)
// vs caja x100 (Disfarma) — deben compararse por costo total para cubrir lo
// pedido, no descartarse entre si por tener presentaciones distintas.
describe("selectBestOffer (comparacion entre presentaciones distintas del mismo generico)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];

  beforeAll(async () => {
    const caja30 = await createProduct("ZOLTRAXINA TAB 100MG X30", "TestLab Zoltraxina");
    const caja100 = await createProduct("ZOLTRAXINA TAB 100MG X100", "TestLab Zoltraxina");
    productIds.push(caja30.id, caja100.id);
    laboratoryIds.push(caja30.laboratoryId!, caja100.laboratoryId!);
    expect(caja30.genericKey).toBe(caja100.genericKey); // misma clave generica pese a distinta presentacion

    const ramedicas = await prisma.supplier.create({ data: { name: "Ramedicas Test Zoltraxina" } });
    const disfarma = await prisma.supplier.create({ data: { name: "Disfarma Test Zoltraxina" } });
    supplierIds.push(ramedicas.id, disfarma.id);

    // Ramedicas: caja x30 a $9000 -> $300/unidad. Disfarma: caja x100 a $25000 -> $250/unidad.
    await prisma.supplierOffer.create({
      data: { supplierId: ramedicas.id, productId: caja30.id, price: 9000, availability: "AVAILABLE", stockQuantity: 300 },
    });
    await prisma.supplierOffer.create({
      data: { supplierId: disfarma.id, productId: caja100.id, price: 25000, availability: "AVAILABLE", stockQuantity: 500 },
    });
  });

  afterAll(async () => {
    await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("para un pedido pequeno, gana la presentacion mas chica aunque su precio unitario sea mas alto", async () => {
    // Piden 30: Ramedicas cubre con 1 caja x30 ($9000). Disfarma necesita 1 caja x100 igual ($25000).
    const { itemId } = await createRequestItem("ZOLTRAXINA TAB 100MG X30", 30);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("SELECTED");
    expect(result.selected?.supplierName).toBe("Ramedicas Test Zoltraxina");
    expect(result.selected?.unitPrice).toBeGreaterThan(
      result.alternatives.find((a) => a.supplierName === "Disfarma Test Zoltraxina")!.unitPrice,
    );
    expect(result.totalPrice).toBe(9000);
  });

  it("para un pedido grande, gana la presentacion que minimiza empaques desperdiciados", async () => {
    // Piden 90: Ramedicas necesita 3 cajas x30 (3*9000=27000). Disfarma cubre con 1 caja x100 (25000).
    const { itemId } = await createRequestItem("ZOLTRAXINA TAB 100MG X30", 90);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("SELECTED");
    expect(result.selected?.supplierName).toBe("Disfarma Test Zoltraxina");
    expect(result.selected?.packagesNeeded).toBe(1);
    expect(result.totalPrice).toBe(25000);
  });
});

// Caso pedido por el cliente: si ya hay existencia en bodega, no se debe
// cotizar lo que ya se tiene -- solo el faltante, y si bodega cubre todo, no
// se cotiza nada.
describe("selectBestOffer (descuento de inventario propio en bodega)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];
  let genericKey: string;

  beforeAll(async () => {
    const product = await createProduct("BODEGATEST JBE 100MG X1", "TestLab Bodega");
    productIds.push(product.id);
    laboratoryIds.push(product.laboratoryId!);
    genericKey = product.genericKey;

    const supplier = await prisma.supplier.create({ data: { name: "Proveedor Bodega Test" } });
    supplierIds.push(supplier.id);

    await prisma.supplierOffer.create({
      data: { supplierId: supplier.id, productId: product.id, price: 1000, availability: "AVAILABLE", stockQuantity: 1000 },
    });
  });

  afterAll(async () => {
    await prisma.warehouseStock.deleteMany({ where: { genericKey } });
    await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("COVERED_BY_STOCK cuando la bodega ya cubre toda la cantidad pedida", async () => {
    await prisma.warehouseStock.upsert({
      where: { genericKey },
      update: { quantity: 50 },
      create: { genericKey, quantity: 50 },
    });

    const { itemId } = await createRequestItem("BODEGATEST JBE 100MG X1", 30);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("COVERED_BY_STOCK");
    expect(result.warehouseStock).toBe(50);
    expect(result.quantityToPurchase).toBe(0);
    expect(result.selected).toBeNull();
    expect(result.totalPrice).toBe(0);

    // No debe quedar ninguna comparacion de precio pendiente para este item.
    const persisted = await prisma.priceComparison.findMany({ where: { customerRequestItemId: itemId } });
    expect(persisted.length).toBe(0);
  });

  it("cotiza solo el faltante cuando la bodega cubre parte de lo pedido", async () => {
    await prisma.warehouseStock.upsert({
      where: { genericKey },
      update: { quantity: 20 },
      create: { genericKey, quantity: 20 },
    });

    const { itemId } = await createRequestItem("BODEGATEST JBE 100MG X1", 30); // faltan 10
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("SELECTED");
    expect(result.warehouseStock).toBe(20);
    expect(result.quantityToPurchase).toBe(10);
    expect(result.selected?.packagesNeeded).toBe(10); // caja x1, faltan 10 unidades
    expect(result.totalPrice).toBe(10000); // 10 x $1000
  });

  it("sin inventario de bodega, se cotiza la cantidad completa como antes", async () => {
    await prisma.warehouseStock.deleteMany({ where: { genericKey } });

    const { itemId } = await createRequestItem("BODEGATEST JBE 100MG X1", 30);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("SELECTED");
    expect(result.warehouseStock).toBe(0);
    expect(result.quantityToPurchase).toBe(30);
    expect(result.totalPrice).toBe(30000);
  });
});

// Caso real reportado por el cliente: "Beta metildigoxina solucion inyectable"
// y "Furosemida solucion inyectable" -- el sistema ofrecia una ampolla de
// 100ml como si fuera intercambiable "1 a 1" con una de 2ml para la misma
// cantidad de "unidades" pedidas (una ampolla sellada de un solo uso no se
// fracciona ni se agrega como un frasco de jarabe). La causa real era que
// "solucion/suspension inyectable" se clasificaba como dosageForm "Solución"
// a secas -- ver COMPOUND_DOSAGE_FORM_MAP en extract-attributes.ts.
describe("selectBestOffer (ampollas/viales inyectables no se tratan como formas medidas)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];

  beforeAll(async () => {
    const ampolla2ml = await createProduct("AMPOLLATEST SOLUCION INYECTABLE 20MG/2ML X2ML", "TestLab Ampolla");
    const ampolla100ml = await createProduct("AMPOLLATEST SOLUCION INYECTABLE 20MG/2ML X100ML", "TestLab Ampolla");
    productIds.push(ampolla2ml.id, ampolla100ml.id);
    laboratoryIds.push(ampolla2ml.laboratoryId!, ampolla100ml.laboratoryId!);
    expect(ampolla2ml.dosageForm).toBe("Inyectable"); // no "Solución"
    expect(ampolla2ml.genericKey).toBe(ampolla100ml.genericKey);

    const supplierA = await prisma.supplier.create({ data: { name: "Proveedor Ampolla A" } });
    const supplierB = await prisma.supplier.create({ data: { name: "Proveedor Ampolla B" } });
    supplierIds.push(supplierA.id, supplierB.id);

    await prisma.supplierOffer.create({
      data: { supplierId: supplierA.id, productId: ampolla2ml.id, price: 500, availability: "AVAILABLE", stockQuantity: 1000 },
    });
    await prisma.supplierOffer.create({
      data: { supplierId: supplierB.id, productId: ampolla100ml.id, price: 20000, availability: "AVAILABLE", stockQuantity: 1000 },
    });
  });

  afterAll(async () => {
    await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("cada ampolla se compara con la division normal (empaques = ceil(cantidad/tamano)), no como si todos los tamanos costaran lo mismo por unidad pedida", async () => {
    const { itemId } = await createRequestItem("AMPOLLATEST SOLUCION INYECTABLE 20MG/2ML X2ML", 100);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("SELECTED");

    const optionA = result.alternatives.find((a) => a.supplierName === "Proveedor Ampolla A")!;
    const optionB = result.alternatives.find((a) => a.supplierName === "Proveedor Ampolla B")!;
    // Antes del fix, ambas mostraban packagesNeeded=100 (se ignoraba el
    // tamano de cada ampolla). Ahora cada una usa su propio tamano.
    expect(optionA.packagesNeeded).toBe(50); // ceil(100/2)
    expect(optionB.packagesNeeded).toBe(1); // ceil(100/100)
    expect(optionA.packagesNeeded).not.toBe(optionB.packagesNeeded);
  });
});

// Caso real reportado por el cliente: pidió un jarabe de 30ml y el sistema
// ofreció uno de 15ml sin darse cuenta de que hacían falta el doble para
// cubrir lo mismo -- "cantidad" en un líquido es número de FRASCOS, no
// mililitros sueltos, y un frasco de otro tamaño se compara por costo total
// (como una caja de tabletas de 30 vs 100), nunca 1 a 1.
describe("selectBestOffer (formas medidas: frascos de distinto tamaño)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];

  beforeAll(async () => {
    const frasco30 = await createProduct("JARABETEST 100MG/5ML JBE X30ML", "TestLab Jarabe");
    const frasco15 = await createProduct("JARABETEST 100MG/5ML JBE X15ML", "TestLab Jarabe");
    productIds.push(frasco30.id, frasco15.id);
    laboratoryIds.push(frasco30.laboratoryId!, frasco15.laboratoryId!);
    expect(frasco30.genericKey).toBe(frasco15.genericKey);

    const supplierA = await prisma.supplier.create({ data: { name: "Proveedor Jarabe A" } });
    const supplierB = await prisma.supplier.create({ data: { name: "Proveedor Jarabe B" } });
    supplierIds.push(supplierA.id, supplierB.id);

    // A vende el frasco de 30ml a $5000. B vende el de 15ml, mas barato por
    // frasco ($2000), pero se necesitan el doble de frascos para el mismo volumen.
    await prisma.supplierOffer.create({
      data: { supplierId: supplierA.id, productId: frasco30.id, price: 5000, availability: "AVAILABLE", stockQuantity: 100 },
    });
    await prisma.supplierOffer.create({
      data: { supplierId: supplierB.id, productId: frasco15.id, price: 2000, availability: "AVAILABLE", stockQuantity: 100 },
    });
  });

  afterAll(async () => {
    await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("con tamaño de frasco especificado, compara por costo total real (no 1 frasco de cada uno)", async () => {
    // Pide 2 frascos de 30ml (= 60ml en total). B necesita 4 frascos de 15ml
    // para cubrir lo mismo (no 2, que era el bug real reportado).
    const { itemId } = await createRequestItem("JARABETEST 100MG/5ML JBE X30ML", 2);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("SELECTED");

    const optionA = result.alternatives.find((a) => a.supplierName === "Proveedor Jarabe A")!;
    const optionB = result.alternatives.find((a) => a.supplierName === "Proveedor Jarabe B")!;
    expect(optionA.packagesNeeded).toBe(2); // 2 frascos de 30ml = 60ml
    expect(optionA.totalCost).toBe(10000);
    expect(optionB.packagesNeeded).toBe(4); // 4 frascos de 15ml = 60ml (no 2)
    expect(optionB.totalCost).toBe(8000);

    // B gana por costo TOTAL real (8000 < 10000), no por precio de frasco a ciegas.
    expect(result.selected?.supplierName).toBe("Proveedor Jarabe B");
    expect(result.totalPrice).toBe(8000);
  });

  it("sin tamaño de frasco especificado, se piden esa cantidad de frascos tal cual venga cada oferta", async () => {
    const { itemId } = await createRequestItem("JARABETEST 100MG/5ML JBE", 2);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    const optionA = result.alternatives.find((a) => a.supplierName === "Proveedor Jarabe A")!;
    const optionB = result.alternatives.find((a) => a.supplierName === "Proveedor Jarabe B")!;
    expect(optionA.packagesNeeded).toBe(2); // 2 frascos de A, sea cual sea su tamaño
    expect(optionB.packagesNeeded).toBe(2); // 2 frascos de B, sea cual sea su tamaño
    expect(result.selected?.supplierName).toBe("Proveedor Jarabe B"); // mas barato por frasco
    expect(result.totalPrice).toBe(4000);
  });
});
