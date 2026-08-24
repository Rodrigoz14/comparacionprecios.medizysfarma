import Image from "next/image";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { LogoutButton } from "@/components/layout/LogoutButton";

export async function AppHeader() {
  const session = await getSession();
  const user = session?.userId
    ? await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } })
    : null;

  return (
    <header className="bg-gradient-to-r from-brand-navy to-brand-blue shadow-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo-light.png" alt="Medizys Farma" width={140} height={41} priority className="h-8 w-auto" />
          <span className="hidden border-l border-white/30 pl-3 text-sm font-medium text-white/80 sm:inline">
            Procurement AI
          </span>
        </Link>
        {user && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-white/80">{user.name}</span>
            <LogoutButton />
          </div>
        )}
      </div>
    </header>
  );
}
