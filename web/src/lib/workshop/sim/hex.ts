/** An Intel HEX image (what avr-gcc writes) as the UNO's 32 KB of flash,
 *  in the 16-bit words avr8js runs. */
export function loadHex(hex: string): Uint16Array {
  const flash = new Uint8Array(0x8000)
  let base = 0
  for (const raw of hex.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith(":")) continue
    const count = parseInt(line.slice(1, 3), 16)
    const address = parseInt(line.slice(3, 7), 16)
    const type = parseInt(line.slice(7, 9), 16)
    if (type === 0) {
      for (let i = 0; i < count; i += 1) {
        const at = base + address + i
        if (at < flash.length) flash[at] = parseInt(line.slice(9 + i * 2, 11 + i * 2), 16)
      }
    } else if (type === 2) {
      base = parseInt(line.slice(9, 13), 16) << 4
    } else if (type === 4) {
      base = parseInt(line.slice(9, 13), 16) << 16
    } else if (type === 1) {
      break
    }
  }
  return new Uint16Array(flash.buffer)
}
