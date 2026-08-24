import { WarehouseStockManager } from "@/components/bodega/WarehouseStockManager";
import { verifySession } from "@/lib/auth/dal";

export default async function BodegaPage() {
  await verifySession();
  return <WarehouseStockManager />;
}
