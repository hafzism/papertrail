"use client";

import {
  Bell,
  BriefcaseBusiness,
  ClipboardCheck,
  FileKey2,
  FolderLock,
  LayoutGrid,
  Menu,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserRoundCheck,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

const navigation = [
  { href: "/app", label: "Workspace", icon: LayoutGrid, exact: true },
  { href: "/app/applications/new", label: "Applications", icon: BriefcaseBusiness },
  { href: "/app/vault", label: "Vault", icon: FolderLock },
  { href: "/app/profile", label: "Facts", icon: ClipboardCheck },
  { href: "/app/activities", label: "Activities", icon: ScrollText },
  { href: "/app/notifications", label: "Notifications", icon: Bell },
  { href: "/app/notices", label: "Notices", icon: FileKey2 },
  { href: "/app/settings", label: "Settings", icon: Settings2 },
];

function isActive(pathname: string, item: (typeof navigation)[number]): boolean {
  if (item.exact) return pathname === item.href;
  if (item.label === "Applications") return pathname.startsWith("/app/applications") || pathname.startsWith("/app/review");
  return pathname.startsWith(item.href);
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav aria-label="Workspace navigation" className="pt-nav">
    <p className="pt-nav-label">Navigation ledger</p>
    <div className="pt-nav-list">
      {navigation.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item);
        return <a aria-current={active ? "page" : undefined} className={`pt-nav-link ${active ? "is-active" : ""}`} href={item.href} key={item.href} onClick={onNavigate}>
          <Icon aria-hidden="true" className="size-4" />
          <span>{item.label}</span>
        </a>;
      })}
    </div>
  </nav>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return <div className="pt-app-shell">
    <aside className="pt-sidebar">
      <a aria-label="PaperTrail workspace" className="pt-brand" href="/app">
        <span className="pt-brand-mark"><FileKey2 aria-hidden="true" className="size-4" /></span>
        <span><strong>PaperTrail</strong><small>Private evidence workspace</small></span>
      </a>
      <Navigation />
      <div className="pt-sidebar-footer">
        <p><span className="pt-status-dot" aria-hidden="true" /> Owner session</p>
        <p>Vault storage · private</p>
        <small>Review boundaries explicit</small>
      </div>
    </aside>

    <header className="pt-topbar">
      <button aria-controls="papertrail-mobile-nav" aria-expanded={menuOpen} aria-label="Open workspace navigation" className="pt-menu-button" onClick={() => setMenuOpen(true)} type="button"><Menu aria-hidden="true" className="size-5" /></button>
      <div className="pt-system-state"><span>System: docket active</span><i aria-hidden="true" /><span>Integrity verified</span></div>
      <div className="pt-secure-state"><ShieldCheck aria-hidden="true" className="size-3.5" /><span>Private workspace</span></div>
    </header>

    {menuOpen ? <div className="pt-mobile-overlay" id="papertrail-mobile-nav">
      <div className="pt-mobile-drawer">
        <div className="flex items-center justify-between border-b border-[var(--pt-rule)] p-4"><span className="pt-nav-label">Navigation ledger</span><button aria-label="Close workspace navigation" className="pt-icon-button" onClick={() => setMenuOpen(false)} type="button"><X aria-hidden="true" className="size-5" /></button></div>
        <Navigation onNavigate={() => setMenuOpen(false)} />
      </div>
    </div> : null}

    <div className="pt-app-content">{children}</div>
  </div>;
}
