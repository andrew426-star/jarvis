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
    <div className="glow-border flex gap-1 rounded-lg p-1">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  )
}
