"""Five MCU builds for the workshop: Ultron, the arc reactor, War Machine's
shoulder gun, a web shooter and an Iron Man faceplate. Each is a real
project - Louisiana Tech parts, wiring, an UNO sketch, printed parts and
where everything sits - worn in the camera try-on with its actions.

    python scripts/seed_mcu_projects.py --check      # checks and BOM, no save
    python scripts/seed_mcu_projects.py --json out   # normalized rows as JSON
    python scripts/seed_mcu_projects.py              # save (needs Supabase env)
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.tools import workshop_project as wp  # noqa: E402


def chain(pin: str, resistors: list[str], end: str, color: str) -> list[dict]:
    """pin -> R -> R ... -> end, as wires."""
    wires = []
    prev = pin
    for r in resistors:
        wires.append({"a": prev, "b": f"{r}.1", "color": color})
        prev = f"{r}.2"
    wires.append({"a": prev, "b": end, "color": color})
    return wires


def power(bat: str = "BAT") -> list[dict]:
    return [{"a": f"{bat}.+", "b": "U1.VIN", "color": "red"}, {"a": f"{bat}.-", "b": "U1.GND", "color": "black"}]


def gnd(ref: str) -> dict:
    return {"a": ref, "b": "U1.GND", "color": "black"}


def res(rid: str, ohms: int, group: str) -> dict:
    return {"id": rid, "type": "resistor", "props": {"ohms": ohms}, "group": group}


# --- 1. Ultron -------------------------------------------------------------------

ULTRON_HEAD = r"""// Ultron's head: a tall, narrow skull with a long chin, its eye slots and
// mouth slit cut clean through for the red LEDs behind them. Hollow and
// open underneath for the neck shaft. Modelled as it sits on the
// turntable (front is -y); print it upright, tree supports in the slots.
$fn = 64;
module skull(k = 0) {
  hull() {
    translate([0, 4, 92]) scale([1, 1.12, 0.78]) sphere(r = 38 - k);
    translate([0, -6, 58]) sphere(r = 35 - k);
    translate([0, -20, 12]) scale([0.5, 0.65, 0.5]) sphere(r = 22 - k);
    translate([0, 14, 18]) cylinder(r = 20 - k, h = 12);
  }
}
difference() {
  skull();
  skull(2.4);
  // Eye slots, raked down toward the nose.
  for (s = [-1, 1]) translate([s * 15, -40, 72]) rotate([0, s * 14, 0]) cube([20, 24, 5.5], center = true);
  // The mouth.
  translate([0, -36, 36]) cube([20, 24, 2.4], center = true);
  // Neck opening.
  translate([0, 0, -1]) cylinder(d = 26, h = 40);
}
// Cheek plates: the angular ridges either side of the mouth.
for (s = [-1, 1]) intersection() {
  skull();
  translate([s * 22, -30, 46]) rotate([0, 0, s * 30]) cube([4, 30, 34], center = true);
}
"""

ULTRON_BASE = r"""// Turntable base: a drum holding the UNO on its floor, the servo standing
// above it on two beams with its horn at the centre, and the 608 bearing
// in a seat on top for the head's neck. A window in front for the
// PING))), a cable slot at the back.
$fn = 96;
H = 58; R = 55; T = 2.4;
difference() {
  cylinder(r = R, h = H);
  translate([0, 0, T]) cylinder(r = R - T, h = H);
  for (x = [-12.5, 12.5]) translate([x, -R + 3, 15]) rotate([90, 0, 0]) cylinder(d = 17, h = 10, center = true);
  translate([-8, R - 5, -1]) cube([16, 10, 12]);
}
// Servo beams, under its mounting tabs.
for (x = [-20.1, 8.9]) translate([x - 2, -48, 32]) cube([4, 96, 2.5]);
// Bearing seat on a three-armed spider.
translate([0, 0, H - 7]) difference() {
  union() {
    cylinder(d = 30, h = 7);
    for (a = [90, 210, 330]) rotate(a) translate([0, -4, 3]) cube([R - 1, 8, 4]);
  }
  translate([0, 0, -1]) cylinder(d = 22.2, h = 9);
}
"""

ULTRON_CODE = r"""// ULTRON SENTRY
// A head on a turntable that keeps watch over the desk. It sweeps slowly
// round on a continuous servo, noting home each turn as the neck's magnet
// passes the hall sensor; the PING))) in its base looks for someone. When
// it finds you it stops dead, its eyes flare and it speaks (piezo and
// serial). Lose it for two seconds and it goes back to searching.
#include <Servo.h>

const int HOME = 2;       // hall sensor, open collector: LOW at the magnet
const int EYE_L = 5;      // PWM pins clear of timer 1 (Servo) and timer 2 (tone)
const int EYE_R = 6;
const int PING_PIN = 7;
const int PIEZO = 8;
const int NECK = 9;

const int STOP = 90;      // a continuous servo holds still at 90
const int SWEEP = 97;     // a slow turn
const long NEAR_CM = 80;

Servo neck;
bool watching = false;
unsigned long lastSeen = 0;

long distanceCm() {
  pinMode(PING_PIN, OUTPUT);
  digitalWrite(PING_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(PING_PIN, HIGH);
  delayMicroseconds(5);
  digitalWrite(PING_PIN, LOW);
  pinMode(PING_PIN, INPUT);
  long us = pulseIn(PING_PIN, HIGH, 25000);
  return us ? us / 29 / 2 : 999;
}

void eyes(int level) {
  analogWrite(EYE_L, level);
  analogWrite(EYE_R, level);
}

void speak() {
  // Three falling notes, low.
  const int notes[] = {220, 196, 147};
  for (int i = 0; i < 3; i++) {
    tone(PIEZO, notes[i], 180);
    delay(220);
  }
}

void setup() {
  pinMode(HOME, INPUT_PULLUP);
  pinMode(EYE_L, OUTPUT);
  pinMode(EYE_R, OUTPUT);
  neck.attach(NECK);
  neck.write(STOP);
  Serial.begin(115200);
  Serial.println("ULTRON ONLINE");
  for (int i = 0; i <= 255; i += 5) {
    eyes(i);
    delay(10);
  }
}

void loop() {
  long cm = distanceCm();
  if (cm < NEAR_CM) {
    neck.write(STOP);
    if (!watching) {
      watching = true;
      eyes(255);
      Serial.print("I SEE YOU. ");
      Serial.print(cm);
      Serial.println(" CM");
      speak();
    }
    lastSeen = millis();
    eyes(200 + random(56));  // a flicker while it stares
  } else {
    if (watching && millis() - lastSeen > 2000) {
      watching = false;
      Serial.println("SEARCHING");
    }
    if (!watching) {
      neck.write(SWEEP);
      eyes(60 + (int)(50 * sin(millis() / 400.0)));  // breathing while it searches
      if (digitalRead(HOME) == LOW) Serial.println("HOME");
    }
  }
  delay(40);
}
"""

ultron = {
    "name": "Ultron Sentry",
    "goal": "Ultron's head on a turntable that watches the desk: it sweeps round on a continuous servo, finds you with a PING))) sensor, stops, flares its red eyes and speaks.",
    "status": "design",
    "notes": (
        "Desk piece: runs off the 9V wall supply into VIN.\n"
        "Every servo Tech stocks is continuous rotation, so the head sweeps at a set speed and the hall sensor marks home once a turn (glue a magnet in the neck shaft).\n"
        "Eyes: two red LEDs, each through two 100 ohm resistors in series (about 15 mA).\n"
        "Eye PWM on D5/D6: Servo takes timer 1 (D9/D10) and tone() timer 2 (D3/D11).\n"
        "Print the head in silver silk PLA, the base in matte black.\n"
        "Simulator: set PING distance under 80 cm and he stops and stares; over 80 and he searches.\n"
        "Try-on: DESK. Point at him and he fires his eye beam."
    ),
    "parts": [
        {"id": "U1", "type": "uno", "group": "Base"},
        {"id": "PWR", "type": "supply_9v", "group": "Base"},
        {"id": "SRV", "type": "servo", "group": "Base", "label": "Neck"},
        {"id": "BRG", "type": "bearing_608", "group": "Base"},
        {"id": "PING", "type": "ping", "group": "Base", "label": "Presence sensor"},
        {"id": "HAL", "type": "hall", "group": "Base", "label": "Home sensor"},
        {"id": "PZ", "type": "piezo", "group": "Base"},
        {"id": "L1", "type": "led", "props": {"color": "red"}, "group": "Head", "label": "Left eye"},
        {"id": "L2", "type": "led", "props": {"color": "red"}, "group": "Head", "label": "Right eye"},
        res("R1", 100, "Head"), res("R2", 100, "Head"), res("R3", 100, "Head"), res("R4", 100, "Head"),
    ],
    "wires": power("PWR")
    + [
        {"a": "SRV.SIG", "b": "U1.D9", "color": "orange"},
        {"a": "SRV.V+", "b": "U1.5V", "color": "red"},
        gnd("SRV.GND"),
        {"a": "PING.SIG", "b": "U1.D7", "color": "white"},
        {"a": "PING.5V", "b": "U1.5V", "color": "red"},
        gnd("PING.GND"),
        {"a": "HAL.VCC", "b": "U1.5V", "color": "red"},
        gnd("HAL.GND"),
        {"a": "HAL.OUT", "b": "U1.D2", "color": "yellow"},
        {"a": "PZ.+", "b": "U1.D8", "color": "orange"},
        gnd("PZ.-"),
    ]
    + chain("U1.D5", ["R1", "R2"], "L1.A", "red")
    + [gnd("L1.K")]
    + chain("U1.D6", ["R3", "R4"], "L2.A", "red")
    + [gnd("L2.K")],
    "code": ULTRON_CODE,
    "printed": [
        {"name": "Ultron head", "code": ULTRON_HEAD, "group": "Head", "material": "silk", "color": "#b4bac2", "notes": ["Hollow, 2.4 mm wall", "Eye slots for 5 mm LEDs", "Print upright, tree supports"]},
        {"name": "Turntable base", "code": ULTRON_BASE, "group": "Base", "material": "matte", "color": "#1d1f23", "notes": ["110 mm drum, UNO on the floor", "Servo beams + 608 seat", "PING))) window in front"]},
    ],
    "layout": {
        "Turntable base": {"pos": [0, 0, 0], "rot": [0, 0, 0]},
        "U1": {"pos": [0, 0, 2.4], "rot": [0, 0, 0]},
        "SRV": {"pos": [-5.6, 0, 20], "rot": [0, 0, 0]},
        "BRG": {"pos": [0, 0, 51], "rot": [0, 0, 0]},
        "Ultron head": {"pos": [0, 0, 60], "rot": [0, 0, 0]},
        "L1": {"pos": [-15, -27, 132], "rot": [90, 0, 0]},
        "L2": {"pos": [15, -27, 132], "rot": [90, 0, 0]},
        "PING": {"pos": [0, -38, 15], "rot": [90, 0, 0]},
        "HAL": {"pos": [24, 30, 36], "rot": [0, 0, 0]},
        "PZ": {"pos": [30, 22, 20], "rot": [0, 0, 0]},
        "R1": {"pos": [-32, -22, 22], "rot": [0, 0, 0]},
        "R2": {"pos": [-32, -17, 22], "rot": [0, 0, 0]},
        "R3": {"pos": [-32, -12, 22], "rot": [0, 0, 0]},
        "R4": {"pos": [-32, -7, 22], "rot": [0, 0, 0]},
        "PWR": {"pos": [100, 40, 0], "rot": [0, 0, 0]},
    },
    "wear": {
        "anchor": "desk",
        "offset": [0, 0, 0],
        "rot": [0, 0, 0],
        "scale": 1,
        "actions": [
            {"name": "Eyes", "kind": "glow", "cue": "button", "at": [0, -40, 132], "dir": [0, -1, 0], "color": "#ff2a14"},
            {"name": "Eye beam", "kind": "beam", "cue": "point", "at": [0, -42, 132], "dir": [0, -1, 0.04], "color": "#ff4a2a", "charge": 0.4},
        ],
    },
}

# --- 2. Arc reactor ----------------------------------------------------------------

REACTOR_HOUSING = r"""// Reactor housing: the casing round the light, printed face up. Six LED
// holes on a 56 mm circle and the core's hole in the back plate, ten
// coil blocks standing proud round the rim, and the face open for the
// clear diffuser ring and core lens. Two strap screw holes in the back.
$fn = 96;
D = 80; H = 18;
difference() {
  union() {
    cylinder(d = D, h = H - 4);
    cylinder(d = D - 8, h = H);
    for (a = [0 : 36 : 359]) rotate(a) translate([D / 2 - 10, -5, H - 1]) cube([8, 10, 4]);
  }
  translate([0, 0, 3]) cylinder(d = D - 12, h = H + 4);
  for (a = [0 : 60 : 359]) rotate(a) translate([28, 0, -1]) cylinder(d = 5.2, h = 5);
  translate([0, 0, -1]) cylinder(d = 5.2, h = 5);
  for (a = [90, 270]) rotate(a) translate([18, 0, -1]) cylinder(d = 3.2, h = 5);
}
// Coil spokes behind the diffuser: the windings' look.
for (a = [18 : 36 : 359]) rotate(a) translate([20, -1.5, 3]) cube([14, 3, 8]);
"""

REACTOR_DIFFUSER = r"""// Diffuser ring: clear, over the six LEDs; pressed into the housing.
$fn = 96;
difference() {
  cylinder(d = 67, h = 4);
  translate([0, 0, -1]) cylinder(d = 38, h = 6);
}
"""

REACTOR_CORE = r"""// Core lens: clear, over the RGB core.
$fn = 64;
cylinder(d1 = 26, d2 = 22, h = 6);
"""

REACTOR_CODE = r"""// ARC REACTOR
// Six white LEDs behind a clear ring and an RGB core. It idles with a
// slow pulse, the pot setting how bright. Hold the button and it charges:
// the ring locks full, the core runs from arc blue to white and the whine
// rises; let go past half charge and it fires the unibeam - three
// flashes and a long burst. The piezo is driven by hand (no tone()):
// tone() would take timer 2 and with it PWM on D3 and D11.

const int RING_A = 3;     // two LEDs on each ring pin
const int RING_B = 5;
const int RING_C = 6;
const int CORE_R = 9;
const int CORE_G = 10;
const int CORE_B = 11;
const int BUTTON = 2;
const int PIEZO = 8;
const int DIAL = A0;

int charge = 0;

void buzz(int hz, int ms) {
  long half = 500000L / hz;
  long cycles = (long)hz * ms / 1000;
  for (long i = 0; i < cycles; i++) {
    digitalWrite(PIEZO, HIGH);
    delayMicroseconds(half);
    digitalWrite(PIEZO, LOW);
    delayMicroseconds(half);
  }
}

void ring(int level) {
  analogWrite(RING_A, level);
  analogWrite(RING_B, level);
  analogWrite(RING_C, level);
}

void core(int r, int g, int b) {
  analogWrite(CORE_R, r);
  analogWrite(CORE_G, g);
  analogWrite(CORE_B, b);
}

void unibeam() {
  Serial.println("UNIBEAM");
  for (int i = 0; i < 3; i++) {
    ring(255);
    core(255, 255, 255);
    buzz(2000, 40);
    ring(0);
    core(0, 0, 0);
    delay(30);
  }
  ring(255);
  core(255, 255, 255);
  buzz(1400, 350);
}

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(PIEZO, OUTPUT);
  pinMode(RING_A, OUTPUT);
  pinMode(RING_B, OUTPUT);
  pinMode(RING_C, OUTPUT);
  pinMode(CORE_R, OUTPUT);
  pinMode(CORE_G, OUTPUT);
  pinMode(CORE_B, OUTPUT);
  Serial.begin(115200);
  Serial.println("REACTOR ONLINE");
  for (int i = 0; i <= 255; i += 3) {
    ring(i);
    core(0, i / 2, i);
    delay(8);
  }
}

void loop() {
  float dial = 0.15 + 0.85 * analogRead(DIAL) / 1023.0;
  bool held = digitalRead(BUTTON) == LOW;
  if (held) {
    if (charge < 255) charge += 3;
    buzz(300 + charge * 4, 12);
  } else if (charge > 0) {
    if (charge > 128) unibeam();
    charge = 0;
  }
  float pulse = held ? 1.0 : 0.78 + 0.22 * sin(millis() / 700.0);
  ring((int)(255 * dial * pulse));
  core((int)(charge * dial), (int)((120 + charge / 2) * dial), (int)(255 * dial));
  delay(15);
}
"""

ring_parts = []
ring_layout = {}
ring_wires = []
for k in range(6):
    a = math.radians(k * 60)
    led = f"L{k + 1}"
    r1, r2 = f"R{2 * k + 1}", f"R{2 * k + 2}"
    pin = ("U1.D3", "U1.D5", "U1.D6")[k // 2]
    ring_parts += [{"id": led, "type": "led", "props": {"color": "white"}, "group": "Reactor"}, res(r1, 100, "Pack"), res(r2, 100, "Pack")]
    ring_layout[led] = {"pos": [round(28 * math.cos(a), 2), -3, round(28 * math.sin(a), 2)], "rot": [90, 0, 0]}
    ring_layout[r1] = {"pos": [-30 + k * 6, -40, -290], "rot": [0, 0, 90]}
    ring_layout[r2] = {"pos": [-27 + k * 6, -40, -290], "rot": [0, 0, 90]}
    ring_wires += chain(pin, [r1, r2], f"{led}.A", "white") + [gnd(f"{led}.K")]

reactor = {
    "name": "Arc Reactor",
    "goal": "A chest-worn arc reactor: six white LEDs behind a clear ring round an RGB core, a slow idle pulse, a brightness dial, and a button that charges and fires the unibeam.",
    "status": "design",
    "notes": (
        "Worn on the chest on a strap; the UNO, battery, dial and piezo ride in a belt pack (group Pack).\n"
        "Each white LED has two 100 ohm resistors in series (about 10 mA), two LEDs per pin: 20 mA a pin.\n"
        "Core: RGB with 200 ohm on red, 100 ohm on green and blue.\n"
        "The piezo is bit-banged: tone() would take timer 2 and PWM on D3/D11 with it.\n"
        "Print the housing in metal-finish PLA, the diffuser and core lens in clear PETG.\n"
        "Simulator: turn the pot for brightness; hold the button past half charge, then release.\n"
        "Try-on: CHEST. Raise a hand above your shoulder for the unibeam."
    ),
    "parts": [
        {"id": "U1", "type": "uno", "group": "Pack"},
        {"id": "BAT", "type": "battery_6aa", "group": "Pack"},
        {"id": "DIAL", "type": "pot", "group": "Pack", "label": "Brightness"},
        {"id": "PZ", "type": "piezo", "group": "Pack"},
        {"id": "SW1", "type": "button", "group": "Reactor", "label": "Unibeam"},
        {"id": "CORE", "type": "rgb_led", "group": "Reactor", "label": "Core"},
        res("R13", 100, "Pack"), res("R14", 100, "Pack"), res("R15", 100, "Pack"), res("R16", 100, "Pack"),
    ]
    + ring_parts,
    "wires": power()
    + ring_wires
    + chain("U1.D9", ["R13", "R14"], "CORE.R", "red")
    + chain("U1.D10", ["R15"], "CORE.G", "green")
    + chain("U1.D11", ["R16"], "CORE.B", "blue")
    + [
        gnd("CORE.COM"),
        {"a": "SW1.1", "b": "U1.D2", "color": "yellow"},
        gnd("SW1.2"),
        {"a": "DIAL.1", "b": "U1.5V", "color": "red"},
        gnd("DIAL.2"),
        {"a": "DIAL.W", "b": "U1.A0", "color": "white"},
        {"a": "PZ.+", "b": "U1.D8", "color": "orange"},
        gnd("PZ.-"),
    ],
    "code": REACTOR_CODE,
    "printed": [
        {"name": "Reactor housing", "code": REACTOR_HOUSING, "group": "Reactor", "material": "metal", "color": "#8e949c", "notes": ["80 mm, 18 deep", "6 LED holes on 56 mm + core", "Print face up"]},
        {"name": "Diffuser ring", "code": REACTOR_DIFFUSER, "group": "Reactor", "material": "clear", "color": "#bfe4ff", "notes": ["Clear PETG, 4 mm", "Press fit"]},
        {"name": "Core lens", "code": REACTOR_CORE, "group": "Reactor", "material": "clear", "color": "#d8f0ff", "notes": ["Clear PETG"]},
    ],
    "layout": {
        **ring_layout,
        "Reactor housing": {"pos": [0, 0, 0], "rot": [90, 0, 0]},
        "Diffuser ring": {"pos": [0, -14, 0], "rot": [90, 0, 0]},
        "Core lens": {"pos": [0, -12, 0], "rot": [90, 0, 0]},
        "CORE": {"pos": [0, -3, 0], "rot": [90, 0, 0]},
        "SW1": {"pos": [0, -8, -44], "rot": [90, 0, 0]},
        "U1": {"pos": [0, -30, -330], "rot": [90, 0, 0]},
        "BAT": {"pos": [85, -35, -330], "rot": [90, 0, 0]},
        "DIAL": {"pos": [-60, -30, -320], "rot": [90, 0, 0]},
        "PZ": {"pos": [-60, -30, -350], "rot": [90, 0, 0]},
        "R13": {"pos": [10, -40, -290], "rot": [0, 0, 90]},
        "R14": {"pos": [13, -40, -290], "rot": [0, 0, 90]},
        "R15": {"pos": [16, -40, -290], "rot": [0, 0, 90]},
        "R16": {"pos": [19, -40, -290], "rot": [0, 0, 90]},
    },
    "wear": {
        "anchor": "chest",
        "group": "Reactor",
        "offset": [0, 0, 0],
        "rot": [0, 0, 0],
        "scale": 1,
        "actions": [
            {"name": "Reactor", "kind": "glow", "cue": "button", "at": [0, -18, 0], "dir": [0, -1, 0], "color": "#a8e0ff"},
            {"name": "Unibeam", "kind": "beam", "cue": "raise", "at": [0, -20, 0], "dir": [0, -1, 0], "color": "#d8f4ff", "charge": 0.6},
        ],
    },
}

# --- 3. War Machine ------------------------------------------------------------------

WM_SADDLE = r"""// Shoulder saddle: a curved plate that sits over the top of the shoulder
// (a 60 mm radius, front to back), straps through four slots, and a
// tower in the middle holding the pan servo upright, horn at the top.
// Modelled as worn: origin on top of the shoulder, front -y.
$fn = 96;
difference() {
  union() {
    intersection() {
      translate([0, 0, -60]) rotate([90, 0, 0]) difference() {
        cylinder(r = 64, h = 110, center = true);
        cylinder(r = 60, h = 112, center = true);
      }
      translate([-70, -60, -30]) cube([140, 120, 40]);
    }
    translate([-20, -15, 2]) cube([40, 30, 40]);
  }
  // The servo's pocket, open at the top.
  translate([-17.6, -6.6, 6]) cube([24, 13.2, 40]);
  // Strap slots.
  for (x = [-46, 46], y = [-35, 35]) translate([x, y, -10]) cube([6, 22, 40], center = true);
}
"""

WM_HOUSING = r"""// Gun housing: the box round the N20 that spins the barrels, sat on the
// pan servo's horn. Open at the front for the barrel hub, a vent along
// each side, a rail on top. Modelled as worn (front -y).
$fn = 48;
difference() {
  hull() {
    translate([-18, -30, 0]) cube([36, 70, 26]);
    translate([-14, -30, 26]) cube([28, 64, 4]);
  }
  translate([-15, -32, 3]) cube([30, 66, 24]);
  for (s = [-1, 1]) for (y = [-10 : 10 : 30]) translate([s * 18, y, 15]) cube([6, 4, 14], center = true);
  translate([0, 0, -1]) cylinder(d = 8, h = 5);
}
translate([-4, -26, 30]) cube([8, 58, 4]);
"""

WM_BARRELS = r"""// Barrel cluster: six barrels round a hub, spun by the N20 on a D bore
// at the back, held by a front and rear clamp ring. Printed standing on
// its back end.
$fn = 32;
L = 110;
difference() {
  union() {
    for (a = [0 : 60 : 359]) rotate(a) translate([9, 0, 0]) cylinder(d = 7, h = L);
    cylinder(d = 12, h = L - 10);
    for (z = [8, L - 22]) translate([0, 0, z]) cylinder(d = 28, h = 6);
  }
  for (a = [0 : 60 : 359]) rotate(a) translate([9, 0, 6]) cylinder(d = 4, h = L);
  translate([0, 0, -1]) difference() {
    cylinder(d = 3.2, h = 10);
    translate([1, -2, -1]) cube([2, 4, 12]);
  }
}
"""

WM_CODE = r"""// WAR MACHINE SHOULDER GUN
// A rotary barrel cluster on a pan servo over the shoulder. The dial pans
// it (centre holds still; either side turns that way, faster further out:
// the servo is continuous). Hold the trigger and the barrels spin up
// through the MOSFET; once they are at speed the muzzle LED strobes and
// the piezo rattles. The red laser sight is always on.
#include <Servo.h>

const int TRIGGER = 2;
const int LASER = 4;
const int SPIN = 5;      // MOSFET gate (PWM, timer 0)
const int MUZZLE = 6;    // PWM, timer 0
const int PIEZO = 8;
const int PAN = 9;
const int AIM = A0;

Servo pan;
int spin = 0;
long rounds = 0;

void setup() {
  pinMode(TRIGGER, INPUT_PULLUP);
  pinMode(LASER, OUTPUT);
  pinMode(SPIN, OUTPUT);
  pinMode(MUZZLE, OUTPUT);
  pan.attach(PAN);
  pan.write(90);
  Serial.begin(115200);
  Serial.println("WAR MACHINE ARMED");
  digitalWrite(LASER, HIGH);
}

void loop() {
  int speed = map(analogRead(AIM), 0, 1023, 60, 120);
  if (abs(speed - 90) < 5) speed = 90;
  pan.write(speed);

  bool firing = digitalRead(TRIGGER) == LOW;
  // Spin up before firing, wind down after.
  spin = firing ? min(255, spin + 15) : max(0, spin - 8);
  analogWrite(SPIN, spin);

  if (firing && spin > 200) {
    analogWrite(MUZZLE, random(120, 256));
    tone(PIEZO, random(90, 160), 15);
    rounds++;
    if (rounds % 25 == 0) {
      Serial.print("ROUNDS ");
      Serial.println(rounds);
    }
  } else {
    analogWrite(MUZZLE, 0);
  }
  delay(20);
}
"""

war_machine = {
    "name": "War Machine Shoulder Gun",
    "goal": "War Machine's shoulder-mounted rotary gun: a six-barrel cluster spun by an N20 through a MOSFET, panned by a servo on a shoulder saddle, with a laser sight, a strobing muzzle LED and a rattling piezo.",
    "status": "design",
    "notes": (
        "Worn on the right shoulder (flip in the try-on for the left), strapped through the saddle's four slots; the UNO and battery go in a back pack (group Pack).\n"
        "N20 on the UNO's 5V through the logic-level MOSFET: 100 ohm gate resistor, 10k pull-down, flyback diode across the motor.\n"
        "The pan servo is continuous: the dial sets speed and direction, centre is stop.\n"
        "Print the saddle in matte black, the housing and barrels in gunmetal metal-finish PLA.\n"
        "Simulator: hold the trigger and watch the motor spin up before the muzzle strobes.\n"
        "Try-on: SHOULDER. Raise a hand above your shoulder to fire."
    ),
    "parts": [
        {"id": "U1", "type": "uno", "group": "Pack"},
        {"id": "BAT", "type": "battery_6aa", "group": "Pack"},
        {"id": "Q1", "type": "mosfet", "group": "Pack", "label": "Barrel motor driver"},
        {"id": "D1", "type": "diode", "group": "Pack", "label": "Flyback"},
        {"id": "AIMPOT", "type": "pot", "group": "Pack", "label": "Pan dial"},
        {"id": "SW1", "type": "button", "group": "Pack", "label": "Trigger"},
        {"id": "PZ", "type": "piezo", "group": "Pack"},
        res("R1", 100, "Pack"), res("R2", 10000, "Pack"), res("R3", 100, "Pack"), res("R4", 100, "Pack"), res("R5", 100, "Pack"), res("R6", 100, "Pack"),
        {"id": "SRV", "type": "servo", "group": "Gun", "label": "Pan"},
        {"id": "M1", "type": "dc_motor", "group": "Gun", "label": "Barrel spin"},
        {"id": "L1", "type": "led", "props": {"color": "red"}, "group": "Gun", "label": "Laser sight"},
        {"id": "L2", "type": "led", "props": {"color": "yellow"}, "group": "Gun", "label": "Muzzle flash"},
    ],
    "wires": power()
    + [
        {"a": "M1.+", "b": "U1.5V", "color": "red"},
        {"a": "M1.-", "b": "Q1.D", "color": "blue"},
        gnd("Q1.S"),
        {"a": "Q1.G", "b": "R1.1", "color": "green"},
        {"a": "R1.2", "b": "U1.D5", "color": "green"},
        {"a": "R2.1", "b": "Q1.G", "color": "green"},
        gnd("R2.2"),
        {"a": "D1.A", "b": "Q1.D", "color": "blue"},
        {"a": "D1.K", "b": "U1.5V", "color": "red"},
        {"a": "SRV.SIG", "b": "U1.D9", "color": "orange"},
        {"a": "SRV.V+", "b": "U1.5V", "color": "red"},
        gnd("SRV.GND"),
        {"a": "SW1.1", "b": "U1.D2", "color": "yellow"},
        gnd("SW1.2"),
        {"a": "AIMPOT.1", "b": "U1.5V", "color": "red"},
        gnd("AIMPOT.2"),
        {"a": "AIMPOT.W", "b": "U1.A0", "color": "white"},
        {"a": "PZ.+", "b": "U1.D8", "color": "orange"},
        gnd("PZ.-"),
    ]
    + chain("U1.D4", ["R3", "R4"], "L1.A", "red")
    + [gnd("L1.K")]
    + chain("U1.D6", ["R5", "R6"], "L2.A", "yellow")
    + [gnd("L2.K")],
    "code": WM_CODE,
    "printed": [
        {"name": "Shoulder saddle", "code": WM_SADDLE, "group": "Gun", "material": "matte", "color": "#25282d", "notes": ["60 mm radius over the shoulder", "Servo tower, 4 strap slots"]},
        {"name": "Gun housing", "code": WM_HOUSING, "group": "Gun", "material": "metal", "color": "#5c6169", "notes": ["Holds the N20", "Sits on the pan horn"]},
        {"name": "Barrel cluster", "code": WM_BARRELS, "group": "Gun", "material": "metal", "color": "#33363b", "notes": ["6 barrels, 110 long", "D bore for the N20 shaft", "Print standing on its back"]},
    ],
    "layout": {
        "Shoulder saddle": {"pos": [0, 0, 0], "rot": [0, 0, 0]},
        "SRV": {"pos": [-5.6, 0, 14], "rot": [0, 0, 0]},
        "Gun housing": {"pos": [0, 0, 48], "rot": [0, 0, 0]},
        "M1": {"pos": [0, -18, 57], "rot": [0, 0, -90]},
        "Barrel cluster": {"pos": [0, -40, 63], "rot": [90, 0, 0]},
        "L1": {"pos": [20, -28, 72], "rot": [90, 0, 0]},
        "L2": {"pos": [0, -146, 63], "rot": [90, 0, 0]},
        "U1": {"pos": [130, 110, -120], "rot": [90, 0, 0]},
        "BAT": {"pos": [130, 115, -60], "rot": [90, 0, 0]},
        "Q1": {"pos": [100, 100, -150], "rot": [0, 0, 0]},
        "D1": {"pos": [108, 100, -150], "rot": [0, 0, 0]},
        "R1": {"pos": [116, 100, -150], "rot": [0, 0, 0]},
        "R2": {"pos": [116, 96, -150], "rot": [0, 0, 0]},
        "R3": {"pos": [116, 92, -150], "rot": [0, 0, 0]},
        "R4": {"pos": [116, 88, -150], "rot": [0, 0, 0]},
        "R5": {"pos": [116, 84, -150], "rot": [0, 0, 0]},
        "R6": {"pos": [116, 80, -150], "rot": [0, 0, 0]},
        "AIMPOT": {"pos": [160, 90, -150], "rot": [0, 0, 0]},
        "SW1": {"pos": [175, 90, -150], "rot": [0, 0, 0]},
        "PZ": {"pos": [190, 90, -150], "rot": [0, 0, 0]},
    },
    "wear": {
        "anchor": "shoulder",
        "group": "Gun",
        "offset": [0, 0, 0],
        "rot": [0, 0, 0],
        "scale": 1,
        "actions": [
            {"name": "Fire", "kind": "projectile", "cue": "raise", "at": [0, -152, 63], "dir": [0, -1, 0], "color": "#ffcc66", "burst": 24, "charge": 0.05},
        ],
    },
}

# --- 4. Web shooter --------------------------------------------------------------------

WS_BAND = r"""// Wrist band: an oval ring round the wrist (64 x 44 inside, 3 mm wall,
// 30 wide), the shooter riding on its underside. Modelled as worn: the
// arm along x, the back of the hand +z.
$fn = 96;
rotate([0, 90, 0]) linear_extrude(height = 30, center = true) difference() {
  scale([25, 35]) circle(r = 1);
  scale([22, 32]) circle(r = 1);
}
"""

WS_BODY = r"""// Shooter body: the capsule under the wrist with its tapered nozzle,
// and the saddle that joins it to the band. Modelled lying along x,
// nozzle forward.
$fn = 48;
difference() {
  union() {
    hull() {
      sphere(r = 9);
      translate([34, 0, 0]) sphere(r = 9);
    }
    translate([40, 0, 0]) rotate([0, 90, 0]) cylinder(d1 = 9, d2 = 4.5, h = 10);
    translate([-6, -10, 6]) cube([24, 20, 5]);
  }
  translate([40, 0, 0]) rotate([0, 90, 0]) cylinder(d = 1.6, h = 12);
}
"""

WS_RING = r"""// Cartridge ring: six cartridges on a turning ring round the forearm,
// just behind the band; a magnet pocket in each for the hall sensor.
// Modelled as worn, the ring round the x axis.
$fn = 64;
rotate([0, 90, 0]) difference() {
  cylinder(r = 37, h = 6, center = true);
  cylinder(r = 33, h = 7, center = true);
}
for (a = [0 : 60 : 359]) rotate([a, 0, 0]) translate([0, 0, 40]) difference() {
  rotate([0, 90, 0]) cylinder(d = 9, h = 16, center = true);
  translate([0, 0, 3]) cylinder(d = 3.2, h = 3);
}
"""

WS_TRIGGER = r"""// Palm trigger: holds the mini limit switch where the middle and ring
// fingers fold onto it (the thwip), with a slot for a finger strap.
difference() {
  translate([-14, -12, 0]) cube([28, 24, 10]);
  translate([-10.5, -3.5, 4]) cube([21, 7, 7]);
  translate([-15, -6, 1.5]) cube([30, 12, 2]);
}
"""

WS_CODE = r"""// WEB SHOOTER
// A Homecoming-style wrist shooter: six cartridges on a turning ring, a
// trigger in the palm under the middle and ring fingers (the thwip), and
// a mode button stepping through web types, shown on the RGB LED. Each
// shot plays the thwip and turns the ring on to the next cartridge,
// found by the hall sensor (a magnet in every cartridge). Empty, the mode
// button reloads.
#include <Servo.h>

const int TRIGGER = 2;   // limit switch in the palm, to GND
const int INDEX = 3;     // hall sensor, LOW at a cartridge's magnet
const int MODE = 4;      // button on the band, to GND
const int LED_R = 5;
const int LED_G = 6;
const int LED_B = 7;
const int PIEZO = 8;
const int RING = 9;

const char* const NAMES[] = {"WEB LINE", "TASER WEB", "SPLIT WEB", "RICOCHET WEB"};
const byte COLORS[4][3] = {{1, 1, 1}, {0, 0, 1}, {0, 1, 0}, {1, 1, 0}};

Servo ring;
int mode = 0;
int shots = 6;
bool lastTrigger = HIGH;
bool lastMode = HIGH;

void show() {
  digitalWrite(LED_R, COLORS[mode][0]);
  digitalWrite(LED_G, COLORS[mode][1]);
  digitalWrite(LED_B, COLORS[mode][2]);
}

void thwip() {
  for (int f = 3000; f > 600; f -= 150) {
    tone(PIEZO, f, 4);
    delay(4);
  }
  noTone(PIEZO);
}

void advance() {
  // Off this cartridge's magnet, then on to the next one.
  ring.write(100);
  unsigned long start = millis();
  while (digitalRead(INDEX) == LOW && millis() - start < 300) {}
  while (digitalRead(INDEX) == HIGH && millis() - start < 1500) {}
  ring.write(90);
}

void setup() {
  pinMode(TRIGGER, INPUT_PULLUP);
  pinMode(INDEX, INPUT_PULLUP);
  pinMode(MODE, INPUT_PULLUP);
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  ring.attach(RING);
  ring.write(90);
  Serial.begin(115200);
  Serial.println("WEB SHOOTER READY");
  show();
}

void loop() {
  bool m = digitalRead(MODE);
  if (lastMode == HIGH && m == LOW) {
    if (shots == 0) {
      shots = 6;
      Serial.println("RELOADED");
    } else {
      mode = (mode + 1) % 4;
      Serial.println(NAMES[mode]);
    }
    show();
    tone(PIEZO, 1500, 40);
  }
  lastMode = m;

  bool t = digitalRead(TRIGGER);
  if (lastTrigger == HIGH && t == LOW) {
    if (shots > 0) {
      Serial.print("THWIP: ");
      Serial.println(NAMES[mode]);
      thwip();
      shots--;
      advance();
    } else {
      Serial.println("CARTRIDGES EMPTY");
      tone(PIEZO, 200, 300);
    }
  }
  lastTrigger = t;
  delay(10);
}
"""

web_shooter = {
    "name": "Web Shooter",
    "goal": "Spider-Man's wrist web shooter: a palm trigger the middle and ring fingers fold onto, six cartridges on a servo-turned ring indexed by a hall sensor, web modes on an RGB LED, and the thwip on a piezo.",
    "status": "design",
    "notes": (
        "Worn on the wrist; the UNO, battery, servo and piezo ride on a forearm bracer (group Bracer).\n"
        "The ring turns on the continuous servo through a printed gear (not drawn yet) until the hall sensor sees the next cartridge's magnet.\n"
        "Mode LED is switched digitally (no PWM), so Servo (timer 1) and tone() (timer 2) never clash with it.\n"
        "RGB: 200 ohm on red, 100 ohm on green and blue.\n"
        "Print the band and trigger in matte black, the shooter in silver silk, the cartridge ring in red PETG.\n"
        "Simulator: press the trigger to fire; the mode button changes web type, and reloads once empty.\n"
        "Try-on: WRIST. Fold your middle and ring fingers in, index and pinky out, to thwip; make a fist to turn the ring."
    ),
    "parts": [
        {"id": "U1", "type": "uno", "group": "Bracer"},
        {"id": "BAT", "type": "battery_6aa", "group": "Bracer"},
        {"id": "SRV", "type": "servo", "group": "Bracer", "label": "Ring drive"},
        {"id": "PZ", "type": "piezo", "group": "Bracer"},
        res("R1", 100, "Bracer"), res("R2", 100, "Bracer"), res("R3", 100, "Bracer"), res("R4", 100, "Bracer"),
        {"id": "SW1", "type": "limit_switch", "group": "Shooter", "label": "Palm trigger"},
        {"id": "SW2", "type": "button", "group": "Shooter", "label": "Mode"},
        {"id": "HAL", "type": "hall", "group": "Shooter", "label": "Cartridge index"},
        {"id": "MODE", "type": "rgb_led", "group": "Shooter", "label": "Mode light"},
    ],
    "wires": power()
    + [
        {"a": "SW1.COM", "b": "U1.D2", "color": "yellow"},
        gnd("SW1.NO"),
        {"a": "HAL.VCC", "b": "U1.5V", "color": "red"},
        gnd("HAL.GND"),
        {"a": "HAL.OUT", "b": "U1.D3", "color": "white"},
        {"a": "SW2.1", "b": "U1.D4", "color": "yellow"},
        gnd("SW2.2"),
        {"a": "PZ.+", "b": "U1.D8", "color": "orange"},
        gnd("PZ.-"),
        {"a": "SRV.SIG", "b": "U1.D9", "color": "orange"},
        {"a": "SRV.V+", "b": "U1.5V", "color": "red"},
        gnd("SRV.GND"),
        gnd("MODE.COM"),
    ]
    + chain("U1.D5", ["R1", "R2"], "MODE.R", "red")
    + chain("U1.D6", ["R3"], "MODE.G", "green")
    + chain("U1.D7", ["R4"], "MODE.B", "blue"),
    "code": WS_CODE,
    "printed": [
        {"name": "Wrist band", "code": WS_BAND, "group": "Shooter", "material": "matte", "color": "#1b1c21", "notes": ["64 x 44 oval bore", "Print on its side"]},
        {"name": "Shooter body", "code": WS_BODY, "group": "Shooter", "material": "silk", "color": "#c3c7cd", "notes": ["Rides under the wrist", "1.6 mm nozzle"]},
        {"name": "Cartridge ring", "code": WS_RING, "group": "Shooter", "material": "petg", "color": "#b3202a", "notes": ["6 cartridges", "Magnet pocket in each"]},
        {"name": "Palm trigger", "code": WS_TRIGGER, "group": "Shooter", "material": "matte", "color": "#1b1c21", "notes": ["Pocket for the limit switch", "Finger strap slot"]},
    ],
    "layout": {
        "Wrist band": {"pos": [-5, 0, 0], "rot": [0, 0, 0]},
        "Shooter body": {"pos": [-10, 0, -34], "rot": [0, 0, 0]},
        "Cartridge ring": {"pos": [-30, 0, 0], "rot": [0, 0, 0]},
        "Palm trigger": {"pos": [62, 0, -24], "rot": [180, 0, 0]},
        "SW1": {"pos": [62, 0, -28], "rot": [180, 0, 0]},
        "SW2": {"pos": [-5, -36, 0], "rot": [90, 0, 0]},
        "HAL": {"pos": [-30, 0, 44], "rot": [0, 0, 0]},
        "MODE": {"pos": [-5, 0, 25], "rot": [0, 0, 0]},
        "U1": {"pos": [-110, 0, 34], "rot": [0, 0, 0]},
        "BAT": {"pos": [-110, 0, 52], "rot": [0, 0, 0]},
        "SRV": {"pos": [-60, 0, 30], "rot": [0, 0, 0]},
        "PZ": {"pos": [-150, 22, 32], "rot": [0, 0, 0]},
        "R1": {"pos": [-80, -24, 32], "rot": [0, 0, 0]},
        "R2": {"pos": [-80, -20, 32], "rot": [0, 0, 0]},
        "R3": {"pos": [-80, -16, 32], "rot": [0, 0, 0]},
        "R4": {"pos": [-80, -12, 32], "rot": [0, 0, 0]},
    },
    "wear": {
        "anchor": "wrist",
        "group": "Shooter",
        "offset": [0, 0, 0],
        "rot": [0, 0, 0],
        "scale": 1,
        "actions": [
            {"name": "Web", "kind": "projectile", "cue": "thwip", "at": [40, 0, -34], "dir": [1, 0, -0.25], "color": "#f4f4ee", "charge": 0.4},
            {"name": "Cartridges", "kind": "deploy", "cue": "fist", "at": [-30, 0, 0], "targets": ["Cartridge ring"], "turn": [60, 0, 0]},
        ],
    },
}

# --- 5. Iron Man faceplate ----------------------------------------------------------------

FACEPLATE = r"""// Faceplate: the mask, modelled as worn - origin between the pupils, z
// up, front -y. An ellipsoid shell 2.4 mm thick that clears the nose,
// cut off behind the cheekbones and at the brow; raked eye slits for the
// white LEDs, the mouth line, and an arm each side back to the hinge at
// the temples (a 3 mm pin on the axis y = 40, z = 30). Print face down
// on a support bed, or split it at the mouth line.
$fn = 96;
C = [0, 32, -28];
R = [76, 88, 112];
T = 2.4;
difference() {
  union() {
    difference() {
      translate(C) scale(R) sphere(r = 1);
      translate(C) scale([R.x - T, R.y - T, R.z - T]) sphere(r = 1);
      translate([-100, 6, -200]) cube([200, 200, 400]);
      translate([-100, -100, 34]) cube([200, 200, 100]);
      translate([-100, -100, -300]) cube([200, 200, 195]);
    }
    for (s = [-1, 1]) hull() {
      translate([s * 70, 4, -10]) cube([4, 4, 20], center = true);
      translate([s * 70, 40, 30]) rotate([0, 90, 0]) cylinder(d = 12, h = 4, center = true);
    }
  }
  for (s = [-1, 1]) translate([s * 30, -50, 1]) rotate([0, s * -10, 0]) cube([30, 30, 8], center = true);
  translate([0, -50, -66]) cube([44, 40, 2.4], center = true);
  for (s = [-1, 1]) translate([s * 70, 40, 30]) rotate([0, 90, 0]) cylinder(d = 3.2, h = 10, center = true);
}
"""

HEADBAND = r"""// Head band: a ring round the head at the brow, carrying the hinge
// posts at the temples on the faceplate's axis (y = 40, z = 30). The
// servo clips to the right post, the hall sensor beside it. Modelled as
// worn.
$fn = 128;
translate([0, 88, 22]) linear_extrude(height = 18) difference() {
  scale([76, 100]) circle(r = 1);
  scale([72, 96]) circle(r = 1);
}
for (s = [-1, 1]) difference() {
  hull() {
    translate([s * 64, 40, 31]) cube([6, 12, 18], center = true);
    translate([s * 76, 40, 30]) rotate([0, 90, 0]) cylinder(d = 12, h = 8, center = true);
  }
  translate([s * 76, 40, 30]) rotate([0, 90, 0]) cylinder(d = 3.2, h = 12, center = true);
}
"""

FACE_CODE = r"""// IRON MAN FACEPLATE
// The faceplate on a hinge at the temples, flipped up and down by a
// continuous servo on the head band: the button toggles it. Closing, it
// runs until the hall sensor at the hinge sees the plate's magnet;
// opening, it runs a timed lift. The eyes fade up white once it is down
// and out as it lifts, and the piezo chirps the power-up.
#include <Servo.h>

const int TOGGLE = 2;    // button on the band, to GND
const int CLOSED = 3;    // hall sensor, LOW with the plate down
const int EYE_L = 5;
const int EYE_R = 6;
const int PIEZO = 8;
const int HINGE = 9;

const int STOP = 90;
const int LIFT = 120;
const int LOWER = 60;
const unsigned long LIFT_MS = 700;

Servo hinge;
bool down = true;
bool lastToggle = HIGH;

void eyes(int level) {
  analogWrite(EYE_L, level);
  analogWrite(EYE_R, level);
}

void powerUp() {
  for (int f = 400; f < 1800; f += 50) {
    tone(PIEZO, f, 8);
    delay(8);
  }
  for (int v = 0; v <= 255; v += 5) {
    eyes(v);
    delay(6);
  }
}

void lift() {
  for (int v = 255; v >= 0; v -= 15) {
    eyes(v);
    delay(5);
  }
  hinge.write(LIFT);
  delay(LIFT_MS);
  hinge.write(STOP);
  down = false;
  Serial.println("FACEPLATE UP");
}

void lower() {
  hinge.write(LOWER);
  unsigned long start = millis();
  while (digitalRead(CLOSED) == HIGH && millis() - start < 1500) {}
  hinge.write(STOP);
  down = true;
  Serial.println("FACEPLATE DOWN");
  powerUp();
}

void setup() {
  pinMode(TOGGLE, INPUT_PULLUP);
  pinMode(CLOSED, INPUT_PULLUP);
  pinMode(EYE_L, OUTPUT);
  pinMode(EYE_R, OUTPUT);
  hinge.attach(HINGE);
  hinge.write(STOP);
  Serial.begin(115200);
  Serial.println("SUIT ONLINE");
  powerUp();
}

void loop() {
  bool t = digitalRead(TOGGLE);
  if (lastToggle == HIGH && t == LOW) {
    if (down) lift();
    else lower();
  }
  lastToggle = t;
  delay(10);
}
"""

faceplate = {
    "name": "Iron Man Faceplate",
    "goal": "An Iron Man faceplate on a temple hinge that a servo on a head band flips up and down at the press of a button, white LED eyes that fade up as it closes, and a power-up chirp.",
    "status": "design",
    "notes": (
        "Worn on the face: the head band carries the hinge, servo and hall sensor; the UNO and battery sit at the back of the head (group Harness).\n"
        "The servo is continuous: it lifts for a timed 700 ms and lowers until the hall sensor sees the plate's magnet (glue it in the right hinge arm).\n"
        "Eyes: white LEDs through 100 ohm each (about 20 mA).\n"
        "Print the faceplate in gold silk PLA face down on supports (or split at the mouth line), the band in matte black.\n"
        "Measure your own face before printing: the shell assumes a 150 mm wide head and clears the nose by about 20 mm.\n"
        "Simulator: press the button to lift, again to lower (set the hall sensor's magnet to end the lower).\n"
        "Try-on: FACE. Open your mouth to flip the faceplate."
    ),
    "parts": [
        {"id": "U1", "type": "uno", "group": "Harness"},
        {"id": "BAT", "type": "battery_6aa", "group": "Harness"},
        {"id": "SRV", "type": "servo", "group": "Harness", "label": "Hinge"},
        {"id": "HAL", "type": "hall", "group": "Harness", "label": "Plate down"},
        {"id": "SW1", "type": "button", "group": "Harness", "label": "Toggle"},
        {"id": "PZ", "type": "piezo", "group": "Harness"},
        res("R1", 100, "Harness"), res("R2", 100, "Harness"),
        {"id": "L1", "type": "led", "props": {"color": "white"}, "group": "Faceplate", "label": "Right eye"},
        {"id": "L2", "type": "led", "props": {"color": "white"}, "group": "Faceplate", "label": "Left eye"},
    ],
    "wires": power()
    + [
        {"a": "SRV.SIG", "b": "U1.D9", "color": "orange"},
        {"a": "SRV.V+", "b": "U1.5V", "color": "red"},
        gnd("SRV.GND"),
        {"a": "HAL.VCC", "b": "U1.5V", "color": "red"},
        gnd("HAL.GND"),
        {"a": "HAL.OUT", "b": "U1.D3", "color": "white"},
        {"a": "SW1.1", "b": "U1.D2", "color": "yellow"},
        gnd("SW1.2"),
        {"a": "PZ.+", "b": "U1.D8", "color": "orange"},
        gnd("PZ.-"),
    ]
    + chain("U1.D5", ["R1"], "L1.A", "white")
    + [gnd("L1.K")]
    + chain("U1.D6", ["R2"], "L2.A", "white")
    + [gnd("L2.K")],
    "code": FACE_CODE,
    "printed": [
        {"name": "Faceplate", "code": FACEPLATE, "group": "Faceplate", "material": "silk", "color": "#d4a23c", "notes": ["2.4 mm shell, as worn", "Hinge pin on y 40, z 30", "Face down on supports"]},
        {"name": "Head band", "code": HEADBAND, "group": "Harness", "material": "matte", "color": "#1d1f23", "notes": ["Brow ring", "Hinge posts at the temples"]},
    ],
    "layout": {
        "Faceplate": {"pos": [0, 0, 0], "rot": [0, 0, 0]},
        "L1": {"pos": [-30, -34, 2], "rot": [90, 0, 0]},
        "L2": {"pos": [30, -34, 2], "rot": [90, 0, 0]},
        "Head band": {"pos": [0, 0, 0], "rot": [0, 0, 0]},
        "SRV": {"pos": [-64, 40, 24.4], "rot": [0, -90, 0]},
        "HAL": {"pos": [-72, 52, 18], "rot": [0, 0, 0]},
        "SW1": {"pos": [-62, 90, 42], "rot": [0, 0, 0]},
        "U1": {"pos": [0, 186, 30], "rot": [90, 0, 180]},
        "BAT": {"pos": [0, 190, -40], "rot": [90, 0, 0]},
        "PZ": {"pos": [45, 175, 40], "rot": [90, 0, 0]},
        "R1": {"pos": [-20, 178, 0], "rot": [0, 0, 0]},
        "R2": {"pos": [-20, 178, -5], "rot": [0, 0, 0]},
    },
    "wear": {
        "anchor": "face",
        "group": "Faceplate",
        "offset": [0, 0, 0],
        "rot": [0, 0, 0],
        "scale": 1,
        "actions": [
            {"name": "Faceplate", "kind": "deploy", "cue": "jaw", "at": [0, 40, 30], "targets": ["Faceplate"], "turn": [-80, 0, 0]},
        ],
    },
}

PROJECTS = [ultron, reactor, war_machine, web_shooter, faceplate]


def checked(raw: dict) -> tuple[dict, dict]:
    project, problems = wp.normalize(raw)
    return project, {"dropped": problems, "checks": wp.check(project), "bom": wp.bom(project)}


def main(argv: list[str]) -> None:
    if "--check" in argv or "--json" in argv:
        rows = []
        for raw in PROJECTS:
            project, report = checked(raw)
            b = report["bom"]
            print(f"\n== {project['name']}: {len(project['parts'])} parts, {len(project['wires'])} wires, ${b['estimated_total']:.2f}")
            for d in report["dropped"]:
                print("  DROPPED", d)
            for c in report["checks"]:
                print(f"  {c['level'].upper():8} {c['part']:6} {c['text']}")
            if b["not_stocked"]:
                print("  NOT STOCKED", b["not_stocked"])
            rows.append({"name": project["name"], "data": {k: v for k, v in project.items() if k != "id"}})
        if "--json" in argv:
            out = Path(argv[argv.index("--json") + 1])
            out.write_text(json.dumps(rows), encoding="utf-8")
            print(f"\nwrote {out}")
        return
    for raw in PROJECTS:
        found = wp.find_project(raw["name"])
        result = wp.save_project({**raw, "id": found["id"] if found else None})
        errors = [c for c in result["report"]["checks"] if c["level"] == "error"]
        print(result["project"]["name"], result["project"]["id"], "compile:", result["report"]["compile"].get("ok"), "errors:", len(errors))


if __name__ == "__main__":
    main(sys.argv[1:])
