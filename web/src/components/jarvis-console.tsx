"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { motion } from "framer-motion"

import { AudioVisualizer } from "@/components/hud/audio-visualizer"
import { BottomBar } from "@/components/hud/bottom-bar"
import { CoreCipher } from "@/components/hud/core-cipher"
import { DataWindow } from "@/components/hud/data-window"
import { ChatInterface } from "@/components/hud/chat-interface"
import type { ChatMessageData } from "@/components/hud/chat-message"
import { DataStream } from "@/components/hud/data-stream"
import { GlobalEffects } from "@/components/hud/global-effects"
import { HolographicGrid } from "@/components/hud/holographic-grid"
import { LeftPanel } from "@/components/hud/left-panel"
import { RightPanel } from "@/components/hud/right-panel"
import { SettingsPanel } from "@/components/hud/settings-panel"
import { StatusRing } from "@/components/hud/status-ring"
import { CameraPreview } from "@/components/spatial/camera-preview"
import { HandCursors } from "@/components/spatial/hand-cursors"
import { HologramLayer } from "@/components/spatial/hologram-layer"
import { Workshop } from "@/components/workshop/workshop"
import { TopBar } from "@/components/hud/top-bar"
import { LoginGate } from "@/components/login-gate"
import type { MicButtonHandle } from "@/components/mic-button"
import { MarketsPanel } from "@/components/panels/markets-panel"
import { NewsPanel } from "@/components/panels/news-panel"
import { PortfolioPanel } from "@/components/panels/portfolio-panel"
import {
  JarvisApiError,
  JarvisAuthError,
  JarvisNetworkError,
  getSessionContext,
  getStatus,
  invoke,
  type MarketHistory,
  type MarketSnapshot,
  type NewsResult,
  type PortfolioResult,
  type ToolResult,
} from "@/lib/jarvis-client"
import { audioAmplitude } from "@/lib/audio-amplitude"
import { captureFrame, startCamera, stopCamera } from "@/lib/camera"
import { emitCore } from "@/lib/core-events"
import { startHands, stopHands } from "@/lib/hand-tracking"
import { stopNarration } from "@/lib/narration"
import { sfx, unlockAudio } from "@/lib/sfx"
import { useSpatial } from "@/lib/spatial-store"
import { clockTime, useJarvis, type AgentStatus, type TabKey } from "@/lib/store"
import { useBoot } from "@/lib/use-boot"
import {
  clearSession,
  clearStoredToken,
  getOrCreateSessionId,
  getStoredToken,
  setStoredToken,
} from "@/lib/storage"

const TOOL_PANEL_MAP: Record<string, TabKey> = {
  market_analysis: "markets",
  market_history: "markets",
  news_feed: "intel",
  portfolio: "assets",
}

type AuthState =
  | { status: "authenticated"; token: string; sessionId: string }
  | { status: "unauthenticated"; loginError: string | null }

// How this page load is signed in, worked out once from the URL and
// localStorage and cached for the life of the page. Read through
// useSyncExternalStore (like use-clock.ts) rather than set from an effect:
// the static export's server render can't see either source, so the
// server snapshot is null ("resolving") and the client snapshot replaces
// it after hydration without a mismatch.
let resolvedAuth: AuthState | null = null

function resolveAuth(): AuthState {
  if (resolvedAuth) return resolvedAuth

  // A completed Google sign-in lands back here as ?session=... since
  // the callback has to hand the browser its credential somehow and
  // this app talks Bearer, not cookies.
  const params = new URLSearchParams(window.location.search)
  const granted = params.get("session")
  const failure = params.get("login_error")

  if (granted || failure) {
    // Strip it immediately: a session token in the address bar ends up
    // in history, bookmarks, and any screenshot of the app.
    window.history.replaceState({}, "", window.location.pathname)
  }

  if (granted) {
    setStoredToken(granted)
    resolvedAuth = { status: "authenticated", token: granted, sessionId: getOrCreateSessionId() }
  } else if (failure) {
    resolvedAuth = { status: "unauthenticated", loginError: failure }
  } else {
    const stored = getStoredToken()
    resolvedAuth = stored
      ? { status: "authenticated", token: stored, sessionId: getOrCreateSessionId() }
      : { status: "unauthenticated", loginError: null }
  }
  return resolvedAuth
}

// Sign-in state only changes by leaving the page (the Google redirect) or
// by handleAuthError below, so there is nothing to subscribe to.
const subscribeAuth = () => () => {}

export function JarvisConsole() {
  const auth = useSyncExternalStore(subscribeAuth, resolveAuth, () => null)
  // Set by a rejected token or an explicit sign-out; signing back in goes
  // through the Google redirect, which reloads the page and resets this.
  const [signedOut, setSignedOut] = useState(false)

  function handleAuthError() {
    clearStoredToken()
    clearSession()
    setSignedOut(true)
  }

  const status = auth === null ? "resolving" : signedOut ? "unauthenticated" : auth.status
  const token = auth?.status === "authenticated" && !signedOut ? auth.token : null
  const sessionId = auth?.status === "authenticated" ? auth.sessionId : ""
  const loginError = auth?.status === "unauthenticated" ? auth.loginError : null

  if (status === "resolving") return <div style={{ height: "100vh" }} />
  if (status === "unauthenticated" || !token) return <LoginGate loginError={loginError} />

  // Keyed on the token so signing out and back in remounts the shell and
  // replays the boot sequence rather than snapping to a live HUD.
  return (
    <Shell
      key={token}
      token={token}
      sessionId={sessionId}
      onAuthError={handleAuthError}
      onSignOut={handleAuthError}
    />
  )
}

function Shell({
  token,
  sessionId,
  onAuthError,
  onSignOut,
}: {
  token: string
  sessionId: string
  onAuthError: () => void
  onSignOut: () => void
}) {
  const boot = useBoot()
  const micRef = useRef<MicButtonHandle>(null)

  const {
    mode,
    activeTab,
    listening,
    gridVisible,
    setStatus: setAgentStatus,
    setContext,
    addToolsUsed,
    setFps,
    setVoice,
    setLinkDown,
    setConnections,
    pushLog,
    notify,
  } = useJarvis()

  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [pending, setPending] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [liveMarketSnapshot, setLiveMarketSnapshot] = useState<MarketSnapshot | undefined>()
  const [liveMarketHistory, setLiveMarketHistory] = useState<MarketHistory | undefined>()
  const [liveNews, setLiveNews] = useState<NewsResult | undefined>()
  const [livePortfolio, setLivePortfolio] = useState<PortfolioResult | undefined>()

  // Listening outranks speaking: during a barge-in the mic opens in the
  // same tick narration is cut, and the reactor should read as listening
  // immediately rather than flickering through "responding" on the way.
  const agentStatus: AgentStatus = listening
    ? "listening"
    : speaking
      ? "speaking"
      : pending
        ? "thinking"
        : "idle"

  // Serious mode runs its own ambience layer. Keyed on the mode itself,
  // so it also applies on load after a reload in serious mode.
  useEffect(() => {
    sfx.setAmbience(mode)
  }, [mode])

  useEffect(() => {
    setAgentStatus(agentStatus)
    // The ambience follows the same state the reactor and EQ do, so the
    // room reacts to thinking and ducks under narration for free.
    sfx.setStatus(agentStatus)
  }, [agentStatus, setAgentStatus])

  // Browsers keep an AudioContext suspended until a real gesture, so the
  // bed cannot start on load however much we would like it to.
  useEffect(() => {
    const start = () => unlockAudio()
    window.addEventListener("pointerdown", start, { once: true })
    window.addEventListener("keydown", start, { once: true })

    // Delegated rather than an onClick on every control: one listener
    // covers buttons that do not exist yet, and nothing has to import
    // sfx to make a sound.
    const click = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("button, [role=\"button\"], a[href]")) {
        sfx.click()
        emitCore({ kind: "click", x: event.clientX, y: event.clientY })
      }
    }
    window.addEventListener("pointerdown", click)

    return () => {
      window.removeEventListener("pointerdown", start)
      window.removeEventListener("keydown", start)
      window.removeEventListener("pointerdown", click)
    }
  }, [])

  // Real render health and voice level, sampled twice a second. The
  // reactor and the EQ read amplitude directly at frame rate; only the
  // gauge needs to go through React, and 2Hz is enough for a dial with a
  // CSS transition on it.
  useEffect(() => {
    let frames = 0
    let lastSample = performance.now()
    let raf = 0

    const tick = (now: number) => {
      frames += 1
      const elapsed = now - lastSample
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed))
        setVoice(audioAmplitude.current)
        frames = 0
        lastSample = now
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [setFps, setVoice])

  // Integration health, once on mount. Doubles as the first real call
  // of the session, so LINK and LAT show something true immediately
  // rather than sitting at IDLE until the user says something.
  useEffect(() => {
    let cancelled = false

    getStatus(token)
      .then((result) => {
        if (cancelled) return
        setConnections(result.connections)
        pushLog("OK", "Integration status read")

        for (const connection of result.connections) {
          // "not_configured" is a deployment choice, not a fault, and
          // "unknown" means the check itself failed - neither deserves
          // to be reported to the user as a broken integration.
          if (connection.status !== "disconnected") continue
          notify(
            "warning",
            `${connection.provider} not linked`,
            "Connect it from Settings to let Jarvis use it."
          )
        }
      })
      .catch(() => {
        if (cancelled) return
        // Leaves connections null, which the panel renders as CHECKING
        // rather than inventing a disconnected state.
        pushLog("WARN", "Integration status unavailable")
      })

    return () => {
      cancelled = true
    }
  }, [token, setConnections, pushLog, notify])

  // Signing out unmounts the shell but not the camera stream; without
  // this the light would stay on behind the login screen.
  useEffect(() => {
    return () => {
      stopHands()
      stopCamera()
      useSpatial.getState().setCameraOn(false)
    }
  }, [])

  // How much Jarvis remembers of this session, read from the backend on
  // load. The chat on screen starts empty after a reload, but the session
  // and its memory carry on, so counting messages here would read 0 while
  // he still remembers the last several exchanges.
  useEffect(() => {
    let cancelled = false
    getSessionContext(sessionId, token)
      .then((context) => {
        if (!cancelled && context.turns !== null) setContext(context.turns, context.window)
      })
      .catch(() => {
        // Leaves the gauge where it is; the next reply corrects it.
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, token, setContext])

  function handleToolResults(results: ToolResult[]) {
    let firstPanel: TabKey | null = null
    for (const entry of results) {
      if (entry.name === "market_analysis") setLiveMarketSnapshot(entry.result as MarketSnapshot)
      if (entry.name === "market_history") setLiveMarketHistory(entry.result as MarketHistory)
      if (entry.name === "news_feed") setLiveNews(entry.result as NewsResult)
      if (entry.name === "portfolio") setLivePortfolio(entry.result as PortfolioResult)
      const mapped = TOOL_PANEL_MAP[entry.name]
      if (mapped && !firstPanel) firstPanel = mapped
      pushLog("OK", `Tool ${entry.name}`)

      // A tool that ran but failed is worth surfacing - it is the
      // difference between "Jarvis did not answer" and "Alpaca is down".
      const payload = entry.result as { ok?: boolean; error?: string } | null
      if (payload && payload.ok === false) {
        notify("warning", `${entry.name} failed`, payload.error ?? "The tool returned an error.")
        pushLog("WARN", `${entry.name} returned an error`)
      }
    }
    addToolsUsed(results.map((entry) => entry.name))
    if (firstPanel) useJarvis.getState().setActiveTab(firstPanel)
  }

  async function toggleCamera() {
    const spatial = useSpatial.getState()
    if (spatial.cameraOn) {
      stopHands()
      stopCamera()
      spatial.setCameraOn(false)
      pushLog("NONE", "Camera off")
      return
    }
    try {
      await startCamera()
      spatial.setCameraOn(true)
      pushLog("OK", "Camera on")
    } catch (err) {
      const denied = err instanceof DOMException && err.name === "NotAllowedError"
      notify(
        "warning",
        denied ? "Camera blocked" : "Camera unavailable",
        denied
          ? "Allow camera access for this site in the browser's address bar, then try again."
          : "No camera could be opened. Check that one is connected and not in use."
      )
      pushLog("WARN", denied ? "Camera permission denied" : "Camera unavailable")
    }
  }

  async function toggleHands() {
    if (useSpatial.getState().handsStatus === "tracking") {
      stopHands()
      pushLog("NONE", "Hand tracking off")
      return
    }
    try {
      await startHands()
      pushLog("OK", "Hand tracking on")
      notify("info", "Hands online", "Pinch to grab or tap. Pinch a hologram with both hands to resize it.")
    } catch {
      notify("warning", "Hand tracking failed", "The hand model could not load. Check the connection and try again.")
      pushLog("ERR", "Hand tracking failed to load")
    }
  }

  async function handleSend(text: string, viaVoice: boolean, look = false) {
    // While the camera is on every message carries a frame, and Jarvis
    // decides whether the question needs it; the frame only goes on to
    // the vision model if he does, or if Look was pressed.
    const frame = useSpatial.getState().cameraOn ? captureFrame() : null
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text, time: clockTime() },
    ])
    setPending(true)
    setError(null)
    sfx.send()
    emitCore({ kind: "send" })
    pushLog("NONE", viaVoice ? "Voice command received" : "Command received")

    try {
      const result = await invoke(text, sessionId, token, { image: frame?.base64, look })
      setContext(result.context_turns, result.context_window)
      emitCore({ kind: "reply" })
      result.tool_results.forEach((entry) => emitCore({ kind: "tool", name: entry.name }))
      const sight = result.tool_results.find((entry) => entry.name === "camera_look")
      const seen = sight?.result as { ok?: boolean; description?: string } | undefined
      if (frame && seen?.ok && seen.description) {
        // What he saw, pinned beside the frame he saw it in, so the
        // answer can be checked against the picture.
        useSpatial.getState().addHologram({
          kind: "vision",
          title: `VISUAL · ${clockTime()}`,
          body: seen.description,
          image: frame.thumbnail,
        })
        pushLog("OK", "Frame analysed")
      }
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.response,
          spoken: result.spoken,
          time: clockTime(),
          toolsUsed: result.tools_used,
          autoPlay: true,
          reopenMicAfter: viaVoice,
        },
      ])
      if (result.tool_results.length > 0) handleToolResults(result.tool_results)

      // Render's free tier sleeps after 15 minutes. A multi-second first
      // call is the instance waking up, not Jarvis thinking slowly, and
      // saying so is more useful than a gauge pegged at red.
      const elapsed = useJarvis.getState().signals.latencyMs
      if (elapsed !== null && elapsed > 1500) {
        notify(
          "info",
          "Backend cold start",
          `First call took ${(elapsed / 1000).toFixed(1)}s. Later ones will be quick.`
        )
      }
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        pushLog("ERR", "Session rejected")
        notify("warning", "Session expired", "Sign in again to continue.")
        onAuthError()
        return
      }
      if (err instanceof JarvisNetworkError) setLinkDown()
      const message =
        err instanceof JarvisNetworkError || err instanceof JarvisApiError
          ? err.message
          : "Something went wrong."
      setError(message)
      sfx.alert()
      emitCore({ kind: "error" })
      pushLog("ERR", message)
      notify("warning", "Request failed", message)
    } finally {
      setPending(false)
    }
  }

  function handleReactorToggle() {
    if (listening) {
      micRef.current?.stopRecording()
      return
    }
    // Barge-in. Narration is cut first so the mic never records Jarvis
    // talking over the user; a no-op when nothing is playing.
    stopNarration()
    micRef.current?.startRecording()
  }

  const serious = mode === "serious"

  return (
    <div className="hud-grid">
      <HolographicGrid serious={serious} visible={gridVisible} />
      <DataStream visible={boot.streams} serious={serious} />

      {/* Step 2 of the boot: a single line draws across the centre.
          scaleX, not width - rule 10 allows transform and opacity only,
          and a width animation would relayout every frame. */}
      {!boot.chrome && (
        <div
          className="pointer-events-none fixed top-1/2 right-0 left-0"
          style={{ zIndex: 40 }}
          aria-hidden
        >
          <div
            style={{
              height: "1px",
              background: "var(--accent)",
              boxShadow: "0 0 12px var(--accent)",
              transform: `scaleX(${boot.line ? 1 : 0})`,
              transition: "transform 300ms ease-in-out",
            }}
          />
        </div>
      )}

      <motion.div
        className="bar-full"
        initial={{ y: -48, opacity: 0 }}
        animate={boot.chrome ? { y: 0, opacity: 1 } : { y: -48, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        style={{ zIndex: 20 }}
      >
        <TopBar />
      </motion.div>

      <motion.div
        className="hud-side min-h-0"
        initial={{ x: -220, opacity: 0 }}
        animate={boot.chrome ? { x: 0, opacity: 1 } : { x: -220, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay: 0.08 }}
        style={{ zIndex: 20, display: "flex" }}
      >
        <LeftPanel token={token} onAuthError={onAuthError} />
      </motion.div>

      {/* Centre column. Flex rather than the spec's absolute positioning:
          absolute children cannot participate in min-h-0, so a long chat
          would have escaped its region - which rules 1 and 2 forbid. */}
      <main
        className="relative flex min-h-0 flex-col overflow-hidden"
        style={{ padding: "var(--sp-4) var(--sp-5)", gap: "var(--sp-3)", zIndex: 10 }}
      >
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <div className="relative aspect-square h-full max-h-full">
            <StatusRing visible={boot.statusRing} />
            <div className="absolute inset-[13%]">
              <CoreCipher
                status={agentStatus}
                onToggle={handleReactorToggle}
                ringsRevealed={boot.rings}
              />
            </div>
          </div>
        </div>

        {/* Comms terminal, capped at 40% of the column so the reactor is
            never pushed off screen. The data tabs open in their own
            full-console window (DataWindow, below) instead of this slot. */}
        <div
          className="flex min-h-0 flex-col"
          style={{
            maxHeight: "40%",
            opacity: boot.chat ? 1 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          <ChatInterface
            messages={messages}
            pending={pending}
            error={error}
            token={token}
            onAuthError={onAuthError}
            onSpeakingChange={setSpeaking}
            onReopenMic={() => micRef.current?.startRecording()}
          />
        </div>

        <div className="shrink-0">
          <AudioVisualizer status={agentStatus} visible={boot.visualizer} />
        </div>
      </main>

      <motion.div
        className="hud-side min-h-0"
        initial={{ x: 220, opacity: 0 }}
        animate={boot.chrome ? { x: 0, opacity: 1 } : { x: 220, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay: 0.08 }}
        style={{ zIndex: 20, display: "flex" }}
      >
        <RightPanel />
      </motion.div>

      <motion.div
        className="bar-full"
        initial={{ y: 56, opacity: 0 }}
        animate={boot.chrome ? { y: 0, opacity: 1 } : { y: 56, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay: 0.16 }}
        style={{ zIndex: 20 }}
      >
        <BottomBar
          token={token}
          disabled={pending}
          onSend={handleSend}
          onAuthError={onAuthError}
          micRef={micRef}
          onToggleCamera={toggleCamera}
        />
      </motion.div>

      <DataWindow>
        <div className={activeTab === "markets" ? "" : "hidden"}>
          <MarketsPanel
            token={token}
            onAuthError={onAuthError}
            liveSnapshot={liveMarketSnapshot}
            liveHistory={liveMarketHistory}
          />
        </div>
        <div className={activeTab === "intel" ? "" : "hidden"}>
          <NewsPanel token={token} onAuthError={onAuthError} liveNews={liveNews} />
        </div>
        <div className={activeTab === "assets" ? "" : "hidden"}>
          <PortfolioPanel token={token} onAuthError={onAuthError} livePortfolio={livePortfolio} />
        </div>
      </DataWindow>

      <HologramLayer />
      <Workshop />
      <CameraPreview
        lookDisabled={pending}
        onLook={() => handleSend("What do you see?", false, true)}
        onToggleHands={toggleHands}
        onClose={toggleCamera}
      />
      <HandCursors />

      <SettingsPanel sessionId={sessionId} onSignOut={onSignOut} />
      <GlobalEffects />
    </div>
  )
}
