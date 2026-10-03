"use client"

// Files attached to a chat message. Images and PDFs travel as base64 and
// reach the model as they are; text-like files are read here and sent as
// text. Everything else is refused up front, with a reason, rather than
// failing on the server.

export interface Attachment {
  name: string
  mime: string
  /** Base64, without the data: prefix (images, PDFs). */
  data?: string
  /** File contents (text-like files). */
  text?: string
  /** Small data URL for the chat bubble (images only). */
  preview?: string
  /** Rough size, for the chip and the total limit. */
  bytes: number
}

export const MAX_ATTACHMENTS = 8
const MAX_TOTAL_BYTES = 12 * 1024 * 1024
const MAX_TEXT_BYTES = 800 * 1024
const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_RAW_IMAGE_BYTES = 10 * 1024 * 1024
// Photos from a phone are far larger than the model needs to read a label
// or a parts list; the long edge is brought down to this.
const MAX_IMAGE_EDGE = 2000

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]
const TEXT_EXTENSIONS = /\.(txt|md|csv|tsv|json|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|sh|sql|ini|toml|log|ino)$/i

export class AttachmentError extends Error {}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new AttachmentError(`${file.name} could not be read as an image.`))
    }
    image.src = url
  })
}

function drawn(image: HTMLImageElement, edge: number, quality: number): string {
  const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", quality)
}

export async function readAttachment(file: File): Promise<Attachment> {
  const mime = file.type || ""
  const heic = /^image\/hei[cf]$/.test(mime) || /\.(heic|heif)$/i.test(file.name)
  if (IMAGE_TYPES.includes(mime) || heic) {
    let image: HTMLImageElement
    try {
      image = await loadImage(file)
    } catch (err) {
      // iPhone photos: Safari can open HEIC, but Chrome and Edge on Windows
      // cannot, so there is no shrinking it or drawing a thumbnail here.
      // Gemini reads HEIC itself, so it goes as it is, shown as a name chip.
      if (!heic) throw err
      if (file.size > MAX_RAW_IMAGE_BYTES) throw new AttachmentError(`${file.name} is over 10 MB.`)
      const heif = /\.heif$/i.test(file.name) || mime === "image/heif"
      return {
        name: file.name,
        mime: heif ? "image/heif" : "image/heic",
        data: toBase64(await file.arrayBuffer()),
        bytes: file.size,
      }
    }
    const full = drawn(image, MAX_IMAGE_EDGE, 0.88)
    const data = full.slice(full.indexOf(",") + 1)
    return {
      name: file.name,
      mime: "image/jpeg",
      data,
      preview: drawn(image, 160, 0.7),
      bytes: Math.round((data.length * 3) / 4),
    }
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new AttachmentError(`${file.name} is over 10 MB.`)
    return { name: file.name, mime: "application/pdf", data: toBase64(await file.arrayBuffer()), bytes: file.size }
  }
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXTENSIONS.test(file.name)) {
    if (file.size > MAX_TEXT_BYTES) throw new AttachmentError(`${file.name} is too long to read in one message.`)
    return { name: file.name, mime: mime || "text/plain", text: await file.text(), bytes: file.size }
  }
  throw new AttachmentError(
    `${file.name} isn't a format Jarvis can read. Images, PDFs and text files (lists, CSV, code) work.`
  )
}

/** Adds files to a pending list, enforcing the count and size limits. */
export async function addAttachments(
  existing: Attachment[],
  files: File[]
): Promise<{ attachments: Attachment[]; problems: string[] }> {
  const attachments = [...existing]
  const problems: string[] = []
  for (const file of files) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      problems.push(`At most ${MAX_ATTACHMENTS} files per message.`)
      break
    }
    try {
      const attachment = await readAttachment(file)
      const total = attachments.reduce((sum, a) => sum + a.bytes, 0) + attachment.bytes
      if (total > MAX_TOTAL_BYTES) {
        problems.push(`${file.name} would take the message over 12 MB.`)
        continue
      }
      attachments.push(attachment)
    } catch (err) {
      problems.push(err instanceof AttachmentError ? err.message : `${file.name} could not be read.`)
    }
  }
  return { attachments, problems }
}
