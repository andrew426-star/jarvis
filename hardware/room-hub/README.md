# Room Hub

Jarvis's hands in the dorm room. An ESP32 checks in every 3 seconds. It
reports temperature, light, the door and whether anyone is in the room,
and runs whatever Jarvis queued for it: lamp, fan, overhead light, and the
desk strip's brightness. Jarvis's side is the `home` tool
(`app/tools/home.py`).

Ultron drafted the printed parts (hub enclosure, switch-pusher mount, door
housings). The parts, wiring and firmware were finished outside the
workshop and passed its checks with no errors.

## Nothing touches mains or the walls

- **Lamp and fan** plug into two **Digital Loggers IoT Power Relays**:
  UL-listed outlets switched by a low-voltage signal. The ESP32 only ever
  sees 3.3 V. Do not swap in a bare relay module on 120 V.
- **Overhead light**: a servo in a printed mount, stuck beside the wall
  rocker with command strips, presses it on and off. It detaches between
  presses, so the switch still works by hand.
- **Desk strip**: 12 V, dimmed by a logic-level MOSFET on the low side.

## Wiring

| From | To | Why |
|---|---|---|
| 5 V 4 A supply + / − | ESP32 5V / GND, and servo V+ / GND | The servo stalls at about 2.5 A, so it gets the supply, never the board's pin |
| ESP32 IO26 | Servo SIG | Wall-switch pusher |
| ESP32 IO16 / IO17 | IoT relay 1 / 2 control **+** (control **−** to GND) | Lamp, fan |
| ESP32 IO25 → 100 Ω → MOSFET G; 10 kΩ G → GND | | PWM dimming; the pull-down keeps the strip off at boot |
| 12 V supply + → strip +; strip − → MOSFET D; MOSFET S → GND | | One ground shared with the ESP32 |
| PIR VCC 5V, AL → IO32 | | Pulled up inside; LOW on motion |
| Hall VCC 5V, OUT → IO33 | | Pulled up inside; LOW while the door magnet is near |
| 3V3 → photoresistor → IO34 → 10 kΩ → GND | | Light level (ADC1) |
| 3V3 → thermistor → IO35 → 10 kΩ → GND | | Temperature, B = 3950 (ADC1) |

The workshop's four remaining warnings are these off-board loads (the
strip, the two IoT relays), which its parts library has no type for.

## Setup

1. Set `JARVIS_DEVICE_TOKEN` on the server if it is not already set.
2. In `room-hub.ino`, fill in the WiFi network, password and device token.
   Build it in the Arduino IDE with the ESP32 core, ESP32Servo and
   ArduinoJson 7. Campus WiFi with a sign-in page will not work; use a
   phone hotspot or a network that takes a plain password.
3. Tune `SERVO_ON` / `SERVO_OFF` to your switch: press, look, adjust.
4. To show it in Ultron's workshop:
   `python scripts/import_project.py hardware/room-hub/project.json`
   (run it where the Supabase settings are).

Then say "lights on" or "dim the desk to 30", or ask how warm the room is.
