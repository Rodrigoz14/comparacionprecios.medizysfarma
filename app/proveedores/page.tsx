import { SupplierList } from "@/components/proveedores/SupplierList";
import { verifySession } from "@/lib/auth/dal";

export default async function ProveedoresPage() {
  await verifySession();
  return <SupplierList />;
}
