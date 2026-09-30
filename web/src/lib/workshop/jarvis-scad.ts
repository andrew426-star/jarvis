// jarvis.scad: the OpenSCAD library every workshop compile can include
// (`include <jarvis.scad>`). Printable parts Jarvis designs are OpenSCAD
// programs, usually built from these modules, compiled in the browser
// (lib/workshop/openscad.ts). Units are millimetres, Z is up, the part's
// floor sits on z = 0 - exactly what a slicer expects.
//
// Hardware dimensions are the typical published figures; clones vary by a
// millimetre or so, so check tight fits with calipers.
//
// Mirrored in app/tools/console_control.py (SCAD_GUIDE), which is how
// Jarvis learns these signatures - keep the two in step.

export const JARVIS_SCAD = String.raw`
// ---- hardware presets ---------------------------------------------------------
// board(name) = [[pcb_x, pcb_y], [[hole_x, hole_y], ...] from the lower-left, hole_d, tallest_part]
function board(name) =
  name == "arduino_uno"    ? [[68.6, 53.3], [[14, 2.5], [15.3, 50.7], [66.1, 7.6], [66.1, 35.5]], 3.2, 15] :
  name == "arduino_mega"   ? [[101.6, 53.3], [[14, 2.5], [15.3, 50.7], [66.1, 7.6], [66.1, 35.5], [90.2, 50.7], [96.5, 2.5]], 3.2, 15] :
  name == "esp32_devkit"   ? [[55, 28], [[2.5, 2.5], [52.5, 2.5], [2.5, 25.5], [52.5, 25.5]], 3, 10] :
  name == "raspberry_pi_4" ? [[85, 56], [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]], 2.7, 18] :
  name == "pca9685"        ? [[62.2, 25.4], [[3.1, 3.1], [59.1, 3.1], [3.1, 22.3], [59.1, 22.3]], 2.7, 14] :
  name == "l298n"          ? [[43, 43], [[3, 3], [40, 3], [3, 40], [40, 40]], 3, 27] :
  name == "lm2596"         ? [[43, 21], [[6.5, 2.5], [36.5, 18.5]], 3, 14] :
  undef;

// servo(name) = [[body_x, body_y, body_z], tab_hole_spacing, hole_pair_spacing (0 = one per tab), hole_d, tab_length]
function servo(name) =
  name == "sg90"   ? [[22.5, 12.2, 22.7], 27.8, 0, 2, 32.2] :
  name == "mg90s"  ? [[22.8, 12.2, 22.5], 27.8, 0, 2, 32.5] :
  name == "mg996r" ? [[40.7, 19.7, 29], 49.5, 10, 4.2, 54.5] :
  name == "ds3218" ? [[40, 20, 28], 49.5, 10, 4.2, 54] :
  undef;

// NEMA 17 stepper face: [face, hole_spacing, hole_d, boss_d]
NEMA17 = [42.3, 31, 3.4, 22.4];

$fn = 48;

// ---- enclosure --------------------------------------------------------------------
// A box with posts for boards and openings for cables, plus a friction-fit lid.
//   inner    [x, y, z] inside dimensions
//   boards   [[name, [x, y] board-centre offset from the floor centre, standoff], ...]
//            name may instead be [[pcb_x, pcb_y], [[hx, hy], ...], hole_d, height]
//   cutouts  [[side, shape, size, [along, up]], ...]
//            side: "front" (-y) | "back" | "left" (-x) | "right"
//            shape "rect" with size [w, h], or "circle" with size = diameter
//            along = offset along the wall from its centre, up = height of the
//            opening's centre above the floor
module enclosure_body(inner = [120, 80, 45], wall = 2.4, floor_t = 2.4, boards = [], cutouts = []) {
  W = inner.x + 2 * wall; D = inner.y + 2 * wall; H = inner.z + floor_t;
  difference() {
    union() {
      difference() {
        translate([-W / 2, -D / 2, 0]) cube([W, D, H]);
        translate([-inner.x / 2, -inner.y / 2, floor_t]) cube([inner.x, inner.y, H]);
      }
      for (b = boards) _board_posts(b, floor_t, false);
    }
    for (b = boards) _board_posts(b, floor_t, true);
    for (c = cutouts) _cutout(c, W, D, wall, floor_t);
  }
}

module _board_posts(b, floor_t, pilots) {
  spec = is_string(b[0]) ? board(b[0]) : b[0];
  size = spec[0]; holes = spec[1]; hole_d = spec[2];
  at = is_undef(b[1]) ? [0, 0] : b[1];
  standoff = is_undef(b[2]) ? 5 : b[2];
  for (h = holes)
    translate([at.x - size.x / 2 + h.x, at.y - size.y / 2 + h.y, floor_t - 0.01])
      if (pilots) translate([0, 0, 0.8]) cylinder(d = hole_d * 0.84, h = standoff + 1);
      else cylinder(d = 6.4, h = standoff);
}

module _cutout(c, W, D, wall, floor_t) {
  side = c[0]; shape = c[1]; size = c[2]; pos = c[3];
  depth = wall * 3;
  z = floor_t + pos[1];
  if (side == "front" || side == "back")
    translate([pos[0], (side == "front" ? -1 : 1) * (D / 2 - wall / 2), z])
      rotate([90, 0, 0])
        if (shape == "circle") cylinder(d = size, h = depth, center = true);
        else cube([size[0], size[1], depth], center = true);
  else
    translate([(side == "left" ? -1 : 1) * (W / 2 - wall / 2), pos[0], z])
      rotate([0, 90, 0])
        if (shape == "circle") cylinder(d = size, h = depth, center = true);
        else cube([size[1], size[0], depth], center = true);
}

// The lid, printed lip-up: a plate, a lip that drops inside the walls with
// clearance each side, and optional vent slots.
module enclosure_lid(inner = [120, 80, 45], wall = 2.4, lid_t = 2.4, lip_h = 5, clearance = 0.3, vents = true) {
  W = inner.x + 2 * wall; D = inner.y + 2 * wall;
  lx = inner.x - 2 * clearance; ly = inner.y - 2 * clearance;
  difference() {
    union() {
      translate([-W / 2, -D / 2, 0]) cube([W, D, lid_t]);
      difference() {
        translate([-lx / 2, -ly / 2, lid_t - 0.01]) cube([lx, ly, lip_h]);
        translate([-lx / 2 + 1.6, -ly / 2 + 1.6, lid_t]) cube([lx - 3.2, ly - 3.2, lip_h + 1]);
      }
    }
    if (vents) {
      n = max(2, floor((inner.x - 20) / 8));
      for (i = [0 : n - 1])
        translate([-(n - 1) * 4 + i * 8 - 1.5, -min(40, inner.y * 0.4) / 2, -1])
          cube([3, min(40, inner.y * 0.4), lid_t + 2]);
    }
  }
}

// Body and lid side by side, ready to print as one plate.
module enclosure(inner = [120, 80, 45], wall = 2.4, floor_t = 2.4, boards = [], cutouts = [], vents = true) {
  enclosure_body(inner, wall, floor_t, boards, cutouts);
  translate([inner.x + 2 * wall + 15, 0, 0]) enclosure_lid(inner, wall, vents = vents);
}

// ---- servo mount --------------------------------------------------------------------
// A plate the servo drops into, hanging by its tabs, with two base holes.
module servo_mount(name = "mg996r", t = 4) {
  s = servo(name); body = s[0]; spacing = s[1]; pair = s[2]; hole_d = s[3]; tab = s[4];
  L = tab + 14; W = body.y + 18;
  difference() {
    translate([-L / 2, -W / 2, 0]) cube([L, W, t]);
    translate([-(body.x + 0.6) / 2, -(body.y + 0.6) / 2, -1]) cube([body.x + 0.6, body.y + 0.6, t + 2]);
    for (sx = [-1, 1]) for (py = (pair > 0 ? [-pair / 2, pair / 2] : [0]))
      translate([sx * spacing / 2, py, -1]) cylinder(d = hole_d * 0.9, h = t + 2);
    for (sx = [-1, 1]) translate([sx * (L / 2 - 4), W / 2 - 4, -1]) cylinder(d = 3.4, h = t + 2);
  }
}

// ---- arm link -----------------------------------------------------------------------
// A flat link with rounded ends. end_a/end_b: "horn" (servo horn hub and
// four screw holes on a 14mm circle) or "hole".
module arm_link(length = 100, width = 20, t = 5, hole_d = 3.2, end_a = "horn", end_b = "hole", lightening = true) {
  difference() {
    hull() for (x = [-length / 2, length / 2]) translate([x, 0, 0]) cylinder(d = width, h = t);
    for (e = [[-length / 2, end_a], [length / 2, end_b]]) translate([e[0], 0, -1]) {
      if (e[1] == "horn") {
        cylinder(d = 7.5, h = t + 2);
        for (a = [45 : 90 : 315]) rotate(a) translate([7, 0, 0]) cylinder(d = 2, h = t + 2);
      } else cylinder(d = hole_d, h = t + 2);
    }
    if (lightening && length > 50)
      hull() for (x = [-(length / 2 - width * 1.1), length / 2 - width * 1.1])
        translate([x, 0, -1]) cylinder(d = width * 0.35, h = t + 2);
  }
}

// ---- base plate / turntable -----------------------------------------------------------
module base_plate(d = 140, t = 6, center_hole = 8, nema17 = false, bolts = 4, bolt_circle = 0, bolt_d = 3.4) {
  bc = bolt_circle > 0 ? bolt_circle : d - 20;
  difference() {
    cylinder(d = d, h = t, $fn = 96);
    if (nema17) {
      translate([0, 0, -1]) cylinder(d = NEMA17[3] + 0.6, h = t + 2);
      for (sx = [-1, 1], sy = [-1, 1]) translate([sx * NEMA17[1] / 2, sy * NEMA17[1] / 2, -1]) cylinder(d = NEMA17[2], h = t + 2);
    } else if (center_hole > 0) translate([0, 0, -1]) cylinder(d = center_hole, h = t + 2);
    if (bolts > 0) for (i = [0 : bolts - 1]) rotate(i * 360 / bolts) translate([bc / 2, 0, -1]) cylinder(d = bolt_d, h = t + 2);
  }
}

// ---- L-bracket ------------------------------------------------------------------------
module l_bracket(width = 30, leg_a = 40, leg_b = 40, t = 4, hole_d = 3.4, holes = 2) {
  difference() {
    union() {
      cube([leg_a, width, t]);
      cube([t, width, leg_b]);
      // Gusset in the corner.
      translate([t, width / 2 + t / 2, t]) rotate([90, 0, 0])
        linear_extrude(t) polygon([[0, 0], [min(leg_a, leg_b) * 0.3, 0], [0, min(leg_a, leg_b) * 0.3]]);
    }
    if (holes > 0) for (i = [1 : holes]) {
      f = i / (holes + 1);
      translate([t + (leg_a - t) * f, width / 4, -1]) cylinder(d = hole_d, h = t + 2);
      translate([-1, width * 3 / 4, t + (leg_b - t) * f]) rotate([0, 90, 0]) cylinder(d = hole_d, h = t + 2);
    }
  }
}
`
