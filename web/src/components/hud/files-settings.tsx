"use client"

import { useState } from "react"
import { FolderPlusIcon, RefreshCwIcon, XIcon } from "lucide-react"

import { linkFolder, reconnectFolder, syncFolderNow, unlinkFolder, useLinkedFolders, type LinkedFolder } from "@/lib/linked-folders"

const STATUS_LABEL: Record<LinkedFolder["status"], string> = {
  syncing: "SYNCING",
  synced: "SYNCED",
  "needs-permission": "NEEDS OK",
  error: "ERROR",
}

function ago(at: number | null): string {
  if (!at) return "not yet"
  const seconds = Math.round((Date.now() - at) / 1000)
  return seconds < 60 ? "just now" : `${Math.round(seconds / 60)} min ago`
}

// Settings > Files: the folders on this PC Jarvis can read
// (lib/linked-folders.ts). Read-only, and only while the console is open.
export function FilesSettings({ token }: { token: string }) {
  const folders = useLinkedFolders((state) => state.folders)
  const supported = useLinkedFolders((state) => state.supported)
  const [busy, setBusy] = useState(false)

  if (!supported) {
    return (
      <p className="wrap-words" style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>
        Linking folders needs Chrome or Edge on a computer: this browser cannot share a folder with a page.
      </p>
    )
  }

  return (
    <>
      {folders.map((folder) => (
        <div key={folder.name} className="flex min-w-0 flex-col" style={{ gap: 4 }}>
          <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
            <span className="t-label truncate-1" style={{ color: "var(--text-primary)" }} title={folder.name}>
              {folder.name}
            </span>
            <div className="flex shrink-0 items-center" style={{ gap: 4 }}>
              <span
                className="t-label"
                style={{
                  color:
                    folder.status === "error"
                      ? "var(--error)"
                      : folder.status === "needs-permission"
                        ? "var(--warning)"
                        : "var(--accent)",
                }}
              >
                {STATUS_LABEL[folder.status]}
              </span>
              <button
                type="button"
                className="btn"
                style={{ width: 22, height: 22, padding: 0 }}
                onClick={() => void syncFolderNow(folder.name)}
                aria-label={`Sync ${folder.name} now`}
                title="Sync now"
              >
                <RefreshCwIcon size={11} />
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: 22, height: 22, padding: 0 }}
                onClick={() => void unlinkFolder(folder.name, token)}
                aria-label={`Unlink ${folder.name}`}
                title="Unlink, and delete Jarvis's copy"
              >
                <XIcon size={11} />
              </button>
            </div>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            {folder.files} files · synced {ago(folder.lastSync)}
          </span>
          {folder.status === "needs-permission" && (
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 12px" }}
              onClick={() => void reconnectFolder(folder.name)}
            >
              ALLOW READING AGAIN
            </button>
          )}
          {folder.status === "error" && folder.error && (
            <span className="wrap-words" style={{ fontSize: 11, color: "var(--error)" }}>
              {folder.error}
            </span>
          )}
        </div>
      ))}

      <button
        type="button"
        className="btn flex items-center justify-center"
        style={{ gap: 6, padding: "4px 12px" }}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await linkFolder()
          } finally {
            setBusy(false)
          }
        }}
      >
        <FolderPlusIcon size={13} /> LINK FOLDER
      </button>
      <p className="wrap-words" style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>
        Jarvis can read the code and text files in a linked folder (not change them). A copy is kept in
        step while the console is open; build output, virtual environments and hidden folders are skipped.
      </p>
    </>
  )
}
