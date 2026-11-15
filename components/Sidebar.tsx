"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";

export interface NavUser {
  name: string;
  email: string;
  role: string;
  credits: number;
}

const GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string; icon: IconName; adminOnly?: boolean }>;
}> = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: "grid" },
      { href: "/notifications", label: "Notifications", icon: "alert" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/lookup/phone", label: "Phone", icon: "phone" },
      { href: "/lookup/ip", label: "IP address", icon: "globe" },
      { href: "/lookup/email", label: "Email", icon: "mail" },
      { href: "/lookup/username", label: "Username", icon: "at" },
      { href: "/lookup/telegram", label: "Telegram", icon: "send" },
    ],
  },
  {
    label: "Phone pivots",
    items: [
      { href: "/lookup/hlr", label: "HLR & carrier", icon: "phone" },
      { href: "/lookup/whatsapp", label: "WhatsApp", icon: "send" },
      { href: "/lookup/getcontact", label: "Caller-ID tags", icon: "users" },
      { href: "/lookup/ewallet", label: "E-wallet", icon: "card" },
      { href: "/lookup/breach", label: "Breach exposure", icon: "alert" },
      { href: "/lookup/humint", label: "HUMINT records", icon: "folder" },
      { href: "/lookup/public-evidence", label: "Public evidence", icon: "eye" },
    ],
  },
  {
    label: "Identity & links",
    items: [
      { href: "/lookup/name", label: "Name", icon: "users" },
      { href: "/lookup/domain", label: "Domain", icon: "globe" },
      { href: "/lookup/telegram-analytics", label: "TG analytics", icon: "send" },
      { href: "/tools/qr", label: "QR decoder", icon: "search" },
      { href: "/graph", label: "Link graph", icon: "eye" },
    ],
  },
  {
    label: "Situation",
    items: [
      { href: "/osiris", label: "OSIRIS Global", icon: "globe" },
      { href: "/polaris", label: "Polaris-X", icon: "globe" },
      { href: "/geofence-chain", label: "Tango chains", icon: "pin" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/cases", label: "Cases", icon: "folder" },
      { href: "/history", label: "History", icon: "clock" },
      { href: "/watchlist", label: "Watchlist", icon: "eye" },
    ],
  },
  {
    label: "Assets",
    items: [
      { href: "/tracking", label: "Devices & geofence", icon: "pin" },
      { href: "/cctv", label: "Cameras", icon: "camera" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/billing", label: "Credits", icon: "card" },
      { href: "/settings", label: "Settings", icon: "settings" },
      { href: "/admin", label: "Administration", icon: "shield", adminOnly: true },
    ],
  },
];

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-3 px-1">
      <span className="relative grid h-9 w-9 place-items-center rounded-[10px] border border-brass/35 bg-brass/10">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8.2" stroke="#d9b26a" strokeWidth="1.3" />
          <circle cx="12" cy="12" r="3.1" stroke="#d9b26a" strokeWidth="1.3" />
          <circle cx="12" cy="12" r="1" fill="#d9b26a" />
          <path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6" stroke="#d9b26a" strokeWidth="1.1" />
        </svg>
      </span>
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-[0.16em] text-text">HAMSA</span>
        <span className="mt-1 block text-[9px] tracking-[0.22em] text-faint">OSINT CONSOLE</span>
      </span>
    </Link>
  );
}

export function Sidebar({ user, unread = 0 }: { user: NavUser; unread?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <Wordmark />
        <button
          type="button"
          className="btn-ghost btn -mr-2 px-2 lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="hairline" />

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || user.role === "admin");
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <p className="eyebrow px-3 pb-2">{group.label}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active =
                    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                          active
                            ? "bg-brass/10 text-brass"
                            : "text-muted hover:bg-surface-2 hover:text-text"
                        }`}
                      >
                        <Icon name={item.icon} size={15} className={active ? "opacity-100" : "opacity-60"} />
                        <span className="truncate">{item.label}</span>
                        {item.href === "/notifications" && unread > 0 ? (
                          <span className="ml-auto rounded-full bg-brass/15 px-1.5 py-0.5 text-[10px] font-semibold text-brass">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        ) : (
                          active && <span className="ml-auto h-1 w-1 rounded-full bg-brass" />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="hairline" />

      <div className="p-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-line-soft bg-surface-2/60 px-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-surface-3 text-[11px] font-semibold uppercase text-brass">
            {user.name.slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-text">{user.name}</p>
            <p className="truncate text-[10px] text-faint">{user.role}</p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="btn-ghost btn px-1.5 py-1.5"
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="logout" size={15} />
            </button>
          </form>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-line-soft bg-surface/70 backdrop-blur-xl lg:block">
        {nav}
      </aside>

      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line-soft bg-ink/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn px-2 py-2"
          aria-label="Open navigation"
        >
          <Icon name="menu" size={18} />
        </button>
        <Wordmark />
        <span className="ml-auto badge badge-brass mono">{user.credits} cr</span>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-[280px] border-r border-line bg-surface shadow-2xl">
            {nav}
          </div>
        </div>
      )}
    </>
  );
}
