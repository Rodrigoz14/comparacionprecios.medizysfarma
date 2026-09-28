-- Sector de negocio (Medicamentos, Dispositivos médicos, Odontología, Aseo,
-- Papelería) -- confirmado con el cliente, 2026-09-28. Un proveedor puede
-- vender en varios sectores a la vez (sectors[]); cada producto queda fijado
-- a uno solo (el activo en la pestaña de Proveedores al importar su
-- archivo); cada solicitud elige uno solo para toda la lista.
CREATE TYPE "Sector" AS ENUM ('MEDICAMENTOS', 'DISPOSITIVOS_MEDICOS', 'ODONTOLOGIA', 'ASEO', 'PAPELERIA');

ALTER TABLE "suppliers" ADD COLUMN     "sectors" "Sector"[] DEFAULT ARRAY[]::"Sector"[];

ALTER TABLE "products" ADD COLUMN     "sector" "Sector" NOT NULL DEFAULT 'MEDICAMENTOS';

ALTER TABLE "customer_requests" ADD COLUMN     "sector" "Sector" NOT NULL DEFAULT 'MEDICAMENTOS';

CREATE INDEX "products_sector_idx" ON "products"("sector");

-- Backfill: los proveedores reales de hoy (Disfarma, Ramédicas, Ofimédicas)
-- son todos de medicamentos.
UPDATE "suppliers" SET "sectors" = ARRAY['MEDICAMENTOS']::"Sector"[] WHERE "sectors" = '{}';
