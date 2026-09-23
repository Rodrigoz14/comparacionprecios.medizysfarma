import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { extractProductAttributes } from "../lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "../lib/matching/normalize";
import { hashPassword } from "../lib/auth/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function upsertProduct(rawName: string, laboratoryName: string) {
  const extraction = extractProductAttributes(rawName);
  if (!extraction) throw new Error(`No se pudieron extraer atributos de "${rawName}"`);

  const laboratoryNormalizedName = normalizeText(laboratoryName);
  const laboratory = await prisma.laboratory.upsert({
    where: { normalizedName: laboratoryNormalizedName },
    update: {},
    create: { name: laboratoryName, normalizedName: laboratoryNormalizedName },
  });

  const normalizedName = buildNormalizedName(extraction.attributes, laboratoryNormalizedName);
  return prisma.product.upsert({
    where: { normalizedName },
    update: {},
    create: {
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
      presentationDescription: rawName,
      laboratoryId: laboratory.id,
    },
  });
}

// SupplierOffer ya no tiene un índice único por (supplierId, productId) --
// un proveedor puede reportar varias ofertas para el mismo producto con
// códigos distintos (ver prisma/schema.prisma). Estas ofertas de semilla no
// traen código, así que se agrupan igual que antes por (proveedor,
// producto) para que el seed siga siendo idempotente.
async function upsertOfferWithoutCode(
  supplierId: string,
  productId: string,
  data: { price: number; availability: "AVAILABLE"; stockQuantity: number },
) {
  const existing = await prisma.supplierOffer.findFirst({
    where: { supplierId, productId, supplierProductCode: null },
  });
  if (existing) {
    return prisma.supplierOffer.update({ where: { id: existing.id }, data });
  }
  return prisma.supplierOffer.create({ data: { supplierId, productId, ...data } });
}

async function upsertAdminUser() {
  const email = "admin@medizysfarma.com";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Usuario admin ya existe (${email}); no se cambió la contraseña.`);
    return;
  }

  const temporaryPassword = randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(temporaryPassword);
  await prisma.user.create({
    data: { name: "Administrador", email, passwordHash, role: "ADMIN" },
  });

  console.log("\n=== USUARIO ADMINISTRADOR CREADO ===");
  console.log(`Correo:      ${email}`);
  console.log(`Contraseña:  ${temporaryPassword}`);
  console.log("Guárdala ahora; no se volverá a mostrar. Cámbiala después del primer ingreso.\n");
}

async function main() {
  await upsertAdminUser();

  const supplier = await prisma.supplier.upsert({
    where: { id: "seed-supplier-ramedicas" },
    update: {},
    create: { id: "seed-supplier-ramedicas", name: "Ramédicas", taxId: "900000000-1" },
  });

  const disfarma = await prisma.supplier.upsert({
    where: { id: "seed-supplier-disfarma" },
    update: {},
    create: { id: "seed-supplier-disfarma", name: "Disfarma", taxId: "900000000-2" },
  });

  // Mismo genérico, dos laboratorios: el motor de precios (fase futura) debe
  // poder comparar ambos e ignorar el laboratorio para elegir el más barato.
  const genfarProduct = await upsertProduct("ACETAMINOFEN TAB 500MG X100", "Genfar");
  const pfizerProduct = await upsertProduct("ACETAMINOFEN TAB 500MG X100", "Pfizer");

  // El precio es por el EMPAQUE/presentación completa (una caja x100 =
  // $5000), no por unidad suelta -- confirmado revisando el catálogo real:
  // tratarlo como precio unitario multiplicaba cajas grandes a millones de
  // pesos (bug real reportado por el cliente).
  await upsertOfferWithoutCode(supplier.id, genfarProduct.id, {
    price: 5000,
    availability: "AVAILABLE",
    stockQuantity: 200,
  });

  await upsertOfferWithoutCode(supplier.id, pfizerProduct.id, {
    price: 20000,
    availability: "AVAILABLE",
    stockQuantity: 50,
  });

  // Disfarma ofrece el mismo genérico de Genfar a otro precio.
  await upsertOfferWithoutCode(disfarma.id, genfarProduct.id, {
    price: 5300,
    availability: "AVAILABLE",
    stockQuantity: 80,
  });

  // Un par de sinónimos de principio activo controlados, con fuente explícita.
  await prisma.ingredientSynonym.upsert({
    where: { term: "paracetamol" },
    update: {},
    create: { term: "paracetamol", canonicalTerm: "acetaminofen", source: "INN (manual)" },
  });

  // N-Butil Bromuro de Hioscina (Buscapina): a diferencia de "ácido valproico"
  // (mismo orden de palabras, distinto arreglo), aquí Ramédicas y Disfarma
  // ni siquiera usan el mismo CONJUNTO de palabras (con/sin el prefijo "N-",
  // con/sin la preposición "de"), así que ordenar alfabéticamente no alcanza
  // para unificarlas — son sinónimos de escritura genuinos, no una variante
  // de orden. Reportado por el cliente: buscar "Hioscina" no encontraba nada
  // aunque el producto existe en ambos proveedores.
  const hioscinaCanonical = "n-butil bromuro de hioscina"; // forma más común en los datos (Disfarma)
  for (const term of [
    "hioscina n-butil bromuro",
    "hioscina butil bromuro",
    "butilbromuro de hioscina",
    "hioscina butilbromuro",
    "hioscina",
  ]) {
    await prisma.ingredientSynonym.upsert({
      where: { term },
      update: {},
      create: { term, canonicalTerm: hioscinaCanonical, source: "Variantes reales de Ramédicas/Disfarma (manual)" },
    });
  }

  // Sulfametoxazol + Trimetoprim (cotrimoxazol): reportado por el cliente
  // como "Trimetropin Sulfa" — "Trimetropin" es un typo de "Trimetoprim" con
  // varias letras cambiadas de lugar (más allá de lo que tolera la
  // corrección de errores de tipeo por distancia de edición) y "Sulfa" es
  // una abreviatura clínica común de "Sulfametoxazol". No se registra
  // "sulfa" sola como sinónimo porque el catálogo real tiene otros
  // medicamentos genuinamente distintos que empiezan igual (Sulfadiazina,
  // Sulfacetamida, Sulfadoxina, Sulfasalazina, Sulfametizol) — solo se
  // registran las frases donde "sulfa" aparece junto a "trimetropin"/
  // "trimetoprim", donde no hay ambigüedad posible, más "trimetropin" sola
  // (el catálogo no tiene ningún producto de Trimetoprim en monoterapia).
  const cotrimoxazolCanonical = "sulfametoxazol trimetoprim";
  for (const term of [
    "trimetropin sulfa",
    "sulfa trimetropin",
    "trimetoprim sulfa",
    "sulfa trimetoprim",
    "trimetropin",
  ]) {
    await prisma.ingredientSynonym.upsert({
      where: { term },
      update: {},
      create: { term, canonicalTerm: cotrimoxazolCanonical, source: "Variante real reportada por el cliente (manual)" },
    });
  }

  console.log("Seed completado: proveedores, laboratorios, productos, ofertas y sinónimos de prueba creados.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
