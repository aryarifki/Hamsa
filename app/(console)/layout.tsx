import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { unreadCount } from "@/lib/notify";
import { Sidebar } from "@/components/Sidebar";
import { Icon } from "@/components/Icon";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await unreadCount(user.id);

  return (
    <div className="min-h-screen">
      <Sidebar
        user={{ name: user.name, email: user.email, role: user.role, credits: user.credits }}
        unread={unread}
      />
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-10 hidden h-14 items-center gap-4 border-b border-line-soft bg-ink/80 px-8 backdrop-blur-xl lg:flex">
          <p className="text-[11px] tracking-[0.16em] text-faint uppercase">
            Authorized investigations only
          </p>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/lookup/phone"
              className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-brass/40 hover:text-text"
            >
              <Icon name="search" size={13} />
              Quick lookup
              <kbd className="mono rounded border border-line bg-surface-3 px-1.5 py-0.5 text-[10px] text-faint">
                /
              </kbd>
            </Link>
            <Link href="/billing" className="badge badge-brass mono">
              <Icon name="card" size={11} />
              {user.credits} credits
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
