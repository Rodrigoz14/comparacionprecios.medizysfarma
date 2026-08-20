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
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Medizys Procurement AI
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
