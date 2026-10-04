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
import { ShowcaseWindow } from "@/components/showcase/showcase-window"
import { CameraPreview } from "@/components/spatial/camera-preview"
import { HandCursors } from "@/components/spatial/hand-cursors"
import { HologramLayer } from "@/components/spatial/hologram-layer"
import { Workshop } from "@/components/workshop/workshop"
import { TopBar } from "@/components/hud/top-bar"
import { LoginGate } from "@/components/login-gate"
import type { MicButtonHandle } from "@/components/mic-button"
import { MarketsPanel } from "@/components/panels/markets-panel"
import { NewsPanel } from "@/components/panels/news-panel"
import { NotesPanel } from "@/components/panels/notes-panel"
import { PortfolioPanel } from "@/components/panels/portfolio-panel"
import {
  JarvisApiError,
  JarvisAuthError,
  JarvisNetworkError,
  getStatus,
  invokeStream,
  type MarketHistory,
  type MarketSnapshot,
  type NewsResult,
  type PortfolioResult,
  type ToolResult,
  type WatchLevel,
} from "@/lib/jarvis-client"
import type { Attachment } from "@/lib/attachments"
import { audioAmplitude } from "@/lib/audio-amplitude"
import { captureFrame, startCamera, stopCamera } from "@/lib/camera"
import {
  consoleState,
  runConsoleActions,
  runWorkshopActions,
  type ConsoleAction,
  type WorkshopAction,
} from "@/lib/console-commands"
import { emitCore } from "@/lib/core-events"
import { startHands, stopHands } from "@/lib/hand-tracking"
import { stopNarration } from "@/lib/narration"
import { sfx, unlockAudio } from "@/lib/sfx"
import { onScreenText, useShowcase, type ShowcaseItem } from "@/lib/showcase-store"
import { SpeechQueue } from "@/lib/speech-queue"
import { useSpatial } from "@/lib/spatial-store"
import { clockTime, useJarvis, type AgentStatus, type TabKey } from "@/lib/store"
import { useBoot } from "@/lib/use-boot"
import { useHeartbeat } from "@/lib/use-heartbeat"
import { snoozeWatch, startWatch, stopWatch } from "@/lib/watch"
import { loadLinkedFolders, startFolderSync, useLinkedFolders } from "@/lib/linked-folders"
import { resolveAuth, subscribeAuth } from "@/lib/auth-state"
import { clearSession, clearStoredToken } from "@/lib/storage"

// "Not now", "quiet", "hush, Jarvis": while he is watching, a short line
// like this snoozes him rather than going out as a message.
const SNOOZE_PHRASE = /^\s*(not now|quiet|hush|shh+|later|pipe down|zip it|give me a (minute|moment|sec(ond)?))[\s,.!]*(jarvis|j)?[\s.!]*$/i
const SNOOZE_MS = 15 * 60_000

const TOOL_PANEL_MAP: Record<string, TabKey> = {
  market_analysis: "markets",
  market_history: "markets",
  news_feed: "intel",
  portfolio: "assets",
}

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
  const [standby, setStandby] = useState(false)

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
      stopWatch()
      stopHands()
      stopCamera()
      useSpatial.getState().setCameraOn(false)
      useSpatial.getState().setWatching(null)
    }
  }, [])

  // LINK, LAT and CTX kept live while the console is on screen, including
  // how much Jarvis remembers of this session: the chat on screen starts
  // empty after a reload, but the session and its memory carry on.
  useHeartbeat(token, sessionId, onAuthError)

  // Linked folders (Settings > Files) are kept in step while the console
  // is open. One that the browser wants re-approved is flagged once.
  useEffect(() => {
    void loadLinkedFolders()
    const stop = startFolderSync(token)
    let warned = false
    const unsubscribe = useLinkedFolders.subscribe((state) => {
      const waiting = state.folders.find((f) => f.status === "needs-permission")
      if (waiting && !warned) {
        warned = true
        notify("info", `Reconnect ${waiting.name}`, "Allow reading it again in Settings > Files so Jarvis sees your latest work.")
      }
    })
    return () => {
      stop()
      unsubscribe()
    }
  }, [token, notify])

  // Close the console: everything that runs stops, and the shell shows a
  // standby screen (a browser tab cannot close itself unless a script
  // opened it, so window.close() is only a best effort).
  function closeConsole() {
    void setWatch(null)
    stopHands()
    stopCamera()
    useSpatial.getState().setCameraOn(false)
    useSpatial.getState().setWorkshopOpen(false)
    useJarvis.getState().setActiveTab(null)
    useJarvis.getState().setSettingsOpen(false)
    sfx.sleep()
    pushLog("NONE", "Console closed by Jarvis")
    setStandby(true)
    window.close()
  }

  function wake() {
    sfx.wake()
    setStandby(false)
  }

  function handleToolResults(results: ToolResult[]) {
    let firstPanel: TabKey | null = null
    for (const entry of results) {
      // Jarvis operating the console himself.
      const control = entry.result as { ok?: boolean; actions?: unknown[] } | null
      if (control?.ok && Array.isArray(control.actions)) {
        if (entry.name === "console") {
          void runConsoleActions(control.actions as ConsoleAction[], { setCamera, setHands, setWatch, snoozeWatch: snooze, closeConsole })
        }
        if (entry.name === "workshop") runWorkshopActions(control.actions as WorkshopAction[])
      }
      // Something Jarvis put on screen: it opens in the showcase window.
      const shown = entry.result as { ok?: boolean; showcase?: Omit<ShowcaseItem, "id" | "time"> } | null
      if (entry.name === "showcase" && shown?.ok && shown.showcase) {
        useJarvis.getState().setActiveTab(null)
        useShowcase.getState().add({ ...shown.showcase, time: clockTime() })
      }
      if (entry.name === "market_analysis") setLiveMarketSnapshot(entry.result as MarketSnapshot)
      if (entry.name === "market_history") setLiveMarketHistory(entry.result as MarketHistory)
      if (entry.name === "news_feed") setLiveNews(entry.result as NewsResult)
      if (entry.name === "portfolio") setLivePortfolio(entry.result as PortfolioResult)
      const mapped = TOOL_PANEL_MAP[entry.name]
      // A panel Jarvis opened or closed on purpose wins over the automatic
      // "show the data behind that answer" switch.
      if (entry.name === "console" || entry.name === "workshop") {
        pushLog("OK", `Jarvis ran ${entry.name}`)
        continue
      }
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
    await setCamera(!useSpatial.getState().cameraOn)
  }

  async function setCamera(on: boolean) {
    const spatial = useSpatial.getState()
    if (on === spatial.cameraOn) return
    if (!on) {
      await setWatch(null)
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

  // Watch mode (lib/watch.ts): Jarvis following the whiteboard and
  // speaking up on his own. It needs the camera, so it brings it up.
  async function setWatch(level: WatchLevel | null) {
    const spatial = useSpatial.getState()
    if (level === spatial.watching) return
    if (!level) {
      stopWatch()
      spatial.setWatching(null)
      pushLog("NONE", "Watch off")
      return
    }
    if (!spatial.cameraOn) await setCamera(true)
    if (!useSpatial.getState().cameraOn) return
    startWatch(
      {
        token,
        sessionId,
        canSpeak: () => useJarvis.getState().status === "idle",
        onRemark: remark,
        // The window he is working from, often the questions on the board.
        onScreen: onScreenText,
        onError: (message) => {
          pushLog("WARN", `Watch: ${message}`)
          notify("warning", "Watch hit a snag", message)
        },
        // Every look shows in the camera header and the system log, with
        // what he made of the board, so silence reads as "nothing worth
        // saying" rather than "not working".
        onLook: (looking, result) => {
          useSpatial.getState().setWatchLooking(looking)
          if (!looking && result && !result.spoke) {
            const seen = result.notes.replace(/\s+/g, " ").trim()
            pushLog("NONE", `Watch: looked, nothing to say${seen ? ` · ${seen.slice(0, 90)}` : ""}`)
          }
        },
      },
      level
    )
    const first = !spatial.watching
    spatial.setWatching(level)
    pushLog("OK", `Watching the board (${level})`)
    if (first) notify("info", "Watching the board", "Jarvis will speak up when he spots something worth saying.")
  }

  // A reply he cannot otherwise see goes in the showcase window: one that
  // says it is on screen when no window was opened (the lite models do
  // this), or a long one while the camera covers the chat or he is in the
  // workshop. Session only - unlike a showcase call, it is not saved to Drive.
  function showReplyIfHidden(asked: string, reply: string, results: { name: string; result: unknown }[]) {
    const shown = results.some((entry) => entry.name === "showcase" && (entry.result as { ok?: boolean } | null)?.ok)
    if (shown) return
    const body = reply.replace(/^\s*on (your )?screen(,\s*sir)?[.!]?\s*/i, "").trim()
    const claimed = /\b(on (your )?screen|in the window|displayed)\b/i.test(reply)
    const spatial = useSpatial.getState()
    const covered = spatial.cameraFocused || spatial.workshopOpen
    if ((claimed && body.length > 120) || (covered && body.length > 280)) {
      const title = asked.replace(/\s+/g, " ").trim()
      useShowcase.getState().add({
        kind: "text",
        title: title.length > 60 ? `${title.slice(0, 57)}...` : title || "Jarvis",
        content: body,
        time: clockTime(),
      })
      pushLog("NONE", "Reply put on screen")
    }
  }

  // An unprompted remark: a soft chime, then into the chat and spoken.
  function remark(message: string) {
    sfx.confirm()
    emitCore({ kind: "reply" })
    pushLog("OK", "Watch: Jarvis spoke up")
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "assistant", content: message, time: clockTime(), toolsUsed: ["watch"] },
    ])
    const voice = new SpeechQueue(token, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onAuthError,
    })
    voice.finish(message)
  }

  function snooze() {
    snoozeWatch(SNOOZE_MS)
    stopNarration()
    pushLog("NONE", "Watch snoozed for 15 minutes")
    notify("info", "Very good", "Jarvis will keep quiet for 15 minutes.")
  }

  async function toggleHands() {
    await setHands(useSpatial.getState().handsStatus !== "tracking")
  }

  async function setHands(on: boolean) {
    const tracking = useSpatial.getState().handsStatus === "tracking"
    if (on === tracking) return
    if (!on) {
      stopHands()
      pushLog("NONE", "Hand tracking off")
      return
    }
    // Hands need the camera; switching them on brings it up first.
    if (!useSpatial.getState().cameraOn) await setCamera(true)
    if (!useSpatial.getState().cameraOn) return
    try {
      await startHands()
      pushLog("OK", "Hand tracking on")
      notify("info", "Hands online", "Pinch to grab or tap. Pinch a hologram with both hands to resize it.")
    } catch {
      notify("warning", "Hand tracking failed", "The hand model could not load. Check the connection and try again.")
      pushLog("ERR", "Hand tracking failed to load")
    }
  }

  async function handleSend(text: string, viaVoice: boolean, look = false, attachments: Attachment[] = []) {
    if (useSpatial.getState().watching && !attachments.length && SNOOZE_PHRASE.test(text)) {
      snooze()
      return
    }
    // While the camera is on every message carries a frame, and Jarvis
    // decides whether the question needs it; the frame only goes on to
    // the vision model if he does, or if Look was pressed.
    const frame = useSpatial.getState().cameraOn ? captureFrame() : null
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        time: clockTime(),
        attachments: attachments.map(({ name, preview }) => ({ name, preview })),
      },
    ])
    setPending(true)
    setError(null)
    sfx.send()
    emitCore({ kind: "send" })
    pushLog("NONE", viaVoice ? "Voice command received" : "Command received")

    // The reply appears, and is spoken, while it is still being written.
    // Its message goes in empty and fills as text arrives; the voice line
    // (which the server sends first) is spoken a sentence at a time.
    const replyId = crypto.randomUUID()
    let replyShown = false
    const updateReply = (change: (message: ChatMessageData) => ChatMessageData) => {
      if (!replyShown) {
        replyShown = true
        setMessages((prev) => [
          ...prev,
          change({ id: replyId, role: "assistant", content: "", time: clockTime(), streaming: true }),
        ])
        return
      }
      setMessages((prev) => prev.map((m) => (m.id === replyId ? change(m) : m)))
    }
    // The bubble shows what he has said so far, a sentence at a time as
    // each is heard. Cut off (barge-in) or finished, it shows all of it.
    let interrupted = false
    const sayAll = (m: ChatMessageData) => (m.said !== undefined && m.spoken ? { ...m, said: m.spoken } : m)
    const voice = new SpeechQueue(token, {
      onSay: (sentence) =>
        updateReply((m) => ({ ...m, said: m.said ? `${m.said} ${sentence}` : sentence })),
      onStart: () => setSpeaking(true),
      onEnd: (completed) => {
        if (!completed) interrupted = true
        if (replyShown) updateReply(sayAll)
        setSpeaking(false)
        // After a spoken exchange the mic reopens for the answer, unless
        // the speech was cut off by a barge-in (which opens it itself).
        if (completed && viaVoice) micRef.current?.startRecording()
      },
      onAuthError,
    })

    try {
      const result = await invokeStream(
        text,
        sessionId,
        token,
        { image: frame?.base64, look, consoleState: consoleState(), attachments },
        (event) => {
          if (event.type === "text") updateReply((m) => ({ ...m, content: m.content + event.delta }))
          else if (event.type === "reset") updateReply((m) => ({ ...m, content: "" }))
          else if (event.type === "spoken") {
            voice.push(event.delta)
            updateReply((m) => ({ ...m, spoken: (m.spoken ?? "") + event.delta, said: m.said ?? "" }))
          }
          else if (event.type === "tool") {
            // Acted on the moment each tool finishes, not at the end: a
            // panel or workshop change lands while he is still talking.
            handleToolResults([{ name: event.name, result: event.result }])
            emitCore({ kind: "tool", name: event.name })
          }
        }
      )
      voice.finish(result.spoken)
      setContext(result.context_turns, result.context_window)
      // One line per turn in the system log: which step cost what, so a
      // slow reply can be pinned on the model, a tool, or memory.
      if (result.timings?.length) {
        const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
        const steps = result.timings
          .filter((t) => t.step !== "total")
          .map((t) => `${(t.model ?? t.name ?? t.step).replace("gemini-", "")} ${secs(t.ms)}`)
        const total = result.timings.find((t) => t.step === "total")
        pushLog("NONE", `${steps.join(" · ")}${total ? ` = ${secs(total.ms)}` : ""}`)
      }
      emitCore({ kind: "reply" })
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
      // The finished reply replaces what streamed in: the server's final
      // text is the authoritative one (tags stripped, whitespace settled).
      updateReply((m) => {
        const finished = {
          ...m,
          content: result.response,
          spoken: result.spoken,
          toolsUsed: result.tools_used,
          streaming: false,
          // No voice line: the screen text is the reply, as before. Cut off
          // already: nothing more will be heard, so show the rest.
          said: result.spoken?.trim() ? (interrupted ? result.spoken : (m.said ?? "")) : undefined,
        }
        return finished
      })

      showReplyIfHidden(text, result.response, result.tool_results)

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
      voice.stop()
      if (replyShown) updateReply((m) => sayAll({ ...m, streaming: false }))
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
  // Captioned in the camera window, so a reply can be read without
  // looking away from the board.
  const lastReply = messages.findLast((message) => message.role === "assistant")

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
          onSend={(message, viaVoice, attachments) => handleSend(message, viaVoice, false, attachments)}
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
        <div className={activeTab === "notes" ? "" : "hidden"}>
          <NotesPanel token={token} onAuthError={onAuthError} />
        </div>
      </DataWindow>

      <HologramLayer />
      <ShowcaseWindow />
      <Workshop token={token} />
      <CameraPreview
        lookDisabled={pending}
        onLook={() => handleSend("What do you see?", false, true)}
        onToggleHands={toggleHands}
        onSetWatch={(level) => void setWatch(level)}
        onSnooze={snooze}
        onClose={toggleCamera}
        onCoreToggle={handleReactorToggle}
        caption={lastReply ? { id: lastReply.id, text: lastReply.said ?? lastReply.content } : null}
      />
      <HandCursors />

      <SettingsPanel token={token} sessionId={sessionId} onSignOut={onSignOut} />

      {standby && (
        <button
          type="button"
          onClick={wake}
          className="fixed inset-0 flex cursor-pointer flex-col items-center justify-center"
          style={{ zIndex: 2000, background: "#020306", border: 0, gap: "var(--sp-3)" }}
          aria-label="Wake J.A.R.V.I.S."
        >
          <span className="t-header" style={{ color: "var(--accent)", fontSize: 18, letterSpacing: "0.3em" }}>
            J.A.R.V.I.S.
          </span>
          <span className="t-time">STANDING BY · CLICK TO RESUME</span>
        </button>
      )}
      <GlobalEffects />
    </div>
  )
}
