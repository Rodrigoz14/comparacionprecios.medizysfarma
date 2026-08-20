import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { extractProductAttributes } from "../lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName, normalizeText } from "../lib/matching/normalize";

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

async function main() {
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

  await prisma.supplierOffer.upsert({
    where: { supplierId_productId: { supplierId: supplier.id, productId: genfarProduct.id } },
    update: { price: 5000 },
    create: {
      supplierId: supplier.id,
      productId: genfarProduct.id,
      price: 5000,
      availability: "AVAILABLE",
      stockQuantity: 200,
    },
  });

  await prisma.supplierOffer.upsert({
    where: { supplierId_productId: { supplierId: supplier.id, productId: pfizerProduct.id } },
    update: { price: 20000 },
    create: {
      supplierId: supplier.id,
      productId: pfizerProduct.id,
      price: 20000,
      availability: "AVAILABLE",
      stockQuantity: 50,
    },
  });

  // Disfarma ofrece el mismo genérico de Genfar a otro precio.
  await prisma.supplierOffer.upsert({
    where: { supplierId_productId: { supplierId: disfarma.id, productId: genfarProduct.id } },
    update: { price: 5300 },
    create: {
      supplierId: disfarma.id,
      productId: genfarProduct.id,
      price: 5300,
      availability: "AVAILABLE",
      stockQuantity: 80,
    },
  });

  // Un par de sinónimos de principio activo controlados, con fuente explícita.
  await prisma.ingredientSynonym.upsert({
    where: { term: "paracetamol" },
    update: {},
    create: { term: "paracetamol", canonicalTerm: "acetaminofen", source: "INN (manual)" },
  });

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
