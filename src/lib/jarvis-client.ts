const API_URL = process.env.NEXT_PUBLIC_JARVIS_API_URL

export class JarvisAuthError extends Error {
  constructor() {
    super("Missing or invalid access token.")
    this.name = "JarvisAuthError"
  }
}

export class JarvisApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "JarvisApiError"
  }
}

export class JarvisNetworkError extends Error {
  constructor() {
    super("Could not reach J.A.R.V.I.S. — check your connection.")
    this.name = "JarvisNetworkError"
  }
}

async function extractErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === "string") return body.detail
  } catch {
    // response wasn't JSON — fall through to the generic message
  }
  return `Request failed (${res.status}).`
}

async function jarvisFetch(path: string, token: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    })
  } catch {
    throw new JarvisNetworkError()
  }

  if (res.status === 401) throw new JarvisAuthError()
  if (!res.ok) throw new JarvisApiError(await extractErrorDetail(res))
  return res
}

export async function verifyToken(token: string): Promise<void> {
  await jarvisFetch("/auth/verify", token, { method: "GET" })
}

export interface InvokeResult {
  response: string
  tools_used: string[]
  session_id: string
}

export async function invoke(
  message: string,
  sessionId: string,
  token: string
): Promise<InvokeResult> {
  const res = await jarvisFetch("/invoke", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  return res.json()
}

export async function speak(text: string, token: string, voiceId?: string): Promise<Blob> {
  const res = await jarvisFetch("/speak", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId }),
  })
  return res.blob()
}
