import { SupplierDetail } from "@/components/proveedores/SupplierDetail";
import { verifySession } from "@/lib/auth/dal";

export default async function ProveedorDetailPage({ params }: PageProps<"/proveedores/[id]">) {
  await verifySession();
  const { id } = await params;
  return <SupplierDetail supplierId={id} />;
}
