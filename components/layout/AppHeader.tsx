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
    <header className="border-b-2 border-brand-blue bg-white dark:bg-zinc-950">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-dark.png"
            alt="Medizys Farma"
            width={140}
            height={41}
            priority
            className="h-8 w-auto dark:hidden"
          />
          <Image
            src="/logo-light.png"
            alt="Medizys Farma"
            width={140}
            height={41}
            priority
            className="hidden h-8 w-auto dark:block"
          />
          <span className="hidden text-sm font-medium text-zinc-500 sm:inline dark:text-zinc-400">
            Procurement AI
          </span>
        </Link>
        {user && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">{user.name}</span>
            <LogoutButton />
          </div>
        )}
      </div>
    </header>
  );
}
