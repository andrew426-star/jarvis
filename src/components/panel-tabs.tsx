"use client"

import {
  LineChartIcon,
  MessageSquareIcon,
  NewspaperIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type TabKey = "chat" | "markets" | "news" | "portfolio"

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "chat", label: "Chat", icon: MessageSquareIcon },
  { key: "markets", label: "Markets", icon: LineChartIcon },
  { key: "news", label: "News", icon: NewspaperIcon },
  { key: "portfolio", label: "Portfolio", icon: WalletIcon },
]

interface PanelTabsProps {
  active: TabKey
  onChange: (tab: TabKey) => void
}

export function PanelTabs({ active, onChange }: PanelTabsProps) {
  return (
    <nav className="flex items-center gap-7">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "relative flex items-center gap-1.5 pb-2.5 text-xs font-medium tracking-[0.18em] uppercase transition-colors",
            active === key ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="size-3.5" />
          {label}
          {active === key && (
            <span className="glow-green absolute inset-x-0 -bottom-px h-px bg-primary" />
          )}
        </button>
      ))}
    </nav>
  )
}
