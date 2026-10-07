import type { AVRTWI, TWIEventHandler } from "avr8js"

// The UNO's I2C bus (A4 SDA, A5 SCL) in the simulation: the ATmega's TWI
// peripheral (avr8js) talking to the project's I2C parts, emulated at the
// register level. An address nothing answers NACKs, as on the bench, so
// Wire returns an error instead of hanging the sketch.

export interface I2CDevice {
  address: number
  /** A transfer to this device is starting (write: master sends). */
  begin?(write: boolean): void
  write(byte: number): void
  read(): number
}

export class I2CBus implements TWIEventHandler {
  private device: I2CDevice | null = null

  constructor(
    private readonly twi: AVRTWI,
    private readonly devices: I2CDevice[]
  ) {}

  start(): void {
    this.twi.completeStart()
  }

  stop(): void {
    this.device = null
    this.twi.completeStop()
  }

  connectToSlave(addr: number, write: boolean): void {
    this.device = this.devices.find((d) => d.address === addr) ?? null
    this.device?.begin?.(write)
    this.twi.completeConnect(!!this.device)
  }

  writeByte(value: number): void {
    this.device?.write(value)
    this.twi.completeWrite(!!this.device)
  }

  readByte(): void {
    this.twi.completeRead(this.device ? this.device.read() & 0xff : 0xff)
  }
}

/** A MAX17048 fuel gauge (address 0x36): VCELL (0x02), SOC (0x04),
 *  VERSION (0x08), from the charge the panel's slider sets. A register
 *  pointer set by the first byte written, auto-incrementing on reads. */
export function max17048(percent: () => number): I2CDevice {
  let pointer = 0
  let first = false
  const register = (reg: number): number => {
    const pct = Math.min(100, Math.max(0, percent()))
    // A LiPo's rest voltage, roughly linear between 3.3 V empty and 4.2 V full.
    const volts = 3.3 + 0.9 * (pct / 100)
    if (reg === 0x02) return Math.round(volts / 78.125e-6) & 0xffff
    if (reg === 0x04) return Math.round(pct * 256) & 0xffff
    if (reg === 0x08) return 0x0012
    if (reg === 0x0c) return 0x971c // CONFIG at power-on
    return 0
  }
  return {
    address: 0x36,
    begin(write) {
      first = write
    },
    write(byte) {
      if (first) {
        pointer = byte
        first = false
      }
    },
    read() {
      // Registers are 16 bits, high byte first: even pointer high, odd low.
      const value = register(pointer & 0xfe)
      const byte = pointer & 1 ? value & 0xff : value >> 8
      pointer += 1
      return byte
    },
  }
}
