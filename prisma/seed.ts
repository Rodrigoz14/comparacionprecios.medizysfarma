import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const laboratory = await prisma.laboratory.upsert({
    where: { normalizedName: "genfar" },
    update: {},
    create: { name: "Genfar", normalizedName: "genfar" },
  });

  const supplier = await prisma.supplier.upsert({
    where: { id: "seed-supplier-ramedicas" },
    update: {},
    create: {
      id: "seed-supplier-ramedicas",
      name: "Ramédicas",
      taxId: "900000000-1",
    },
  });

  const product = await prisma.product.upsert({
    where: { normalizedName: "acetaminofen-500-mg-tableta-100" },
    update: {},
    create: {
      standardName: "Acetaminofén 500 mg tabletas x 100",
      normalizedName: "acetaminofen-500-mg-tableta-100",
      activeIngredient: "Acetaminofén",
      concentration: "500",
      concentrationUnit: "mg",
      dosageForm: "Tableta",
      presentationType: "Caja",
      presentationQuantity: 100,
      presentationUnit: "tabletas",
      laboratoryId: laboratory.id,
    },
  });

  await prisma.supplierOffer.upsert({
    where: { supplierId_productId: { supplierId: supplier.id, productId: product.id } },
    update: { price: 10500 },
    create: {
      supplierId: supplier.id,
      productId: product.id,
      price: 10500,
      availability: "AVAILABLE",
      stockQuantity: 200,
    },
  });

  console.log("Seed completado: proveedor, laboratorio, producto y oferta de prueba creados.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
