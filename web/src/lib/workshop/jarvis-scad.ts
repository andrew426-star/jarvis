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
// ==== functional detail ==================================================================
// What turns a blocky part into one that is made to be used: edges that
// are rounded or chamfered, screws that have bosses to go into, ribs where
// a face would flex, slots for straps and ties, channels where the wiring
// runs, vents over what gets warm, snaps for lids, and labels. Every
// module is millimetres, z up; "cut" modules are meant for difference().

// ---- edges ------------------------------------------------------------------------
// A box with every edge filleted to radius r.
module rounded_box(size = [40, 30, 20], r = 2, center = false) {
  rr = max(0.01, min(r, min(size) / 2 - 0.01));
  // Minkowski of a box and a sphere: a hull of eight corner spheres is
  // the same shape, but CGAL's hull fails on some sizes (an assertion),
  // which made shell_box() come out solid.
  translate(center ? -size / 2 : [0, 0, 0])
    minkowski() {
      translate([rr, rr, rr]) cube([size.x - 2 * rr, size.y - 2 * rr, size.z - 2 * rr]);
      sphere(r = rr, $fn = 16);
    }
}

// A box with every edge chamfered by c at 45 degrees.
module chamfer_box(size = [40, 30, 20], c = 1, center = false) {
  cc = min(c, min(size) / 2 - 0.01);
  translate(center ? -size / 2 : [0, 0, 0]) hull() {
    translate([cc, cc, 0]) cube([size.x - 2 * cc, size.y - 2 * cc, size.z]);
    translate([cc, 0, cc]) cube([size.x - 2 * cc, size.y, size.z - 2 * cc]);
    translate([0, cc, cc]) cube([size.x, size.y - 2 * cc, size.z - 2 * cc]);
  }
}

// A plate with corners rounded in plan and its top edge chamfered.
module rounded_plate(size = [60, 40, 3], r = 4, chamfer = 0.6, center = true) {
  ch = min(chamfer, size.z / 2);
  translate(center ? [-size.x / 2, -size.y / 2, 0] : [0, 0, 0])
    hull() for (x = [r, size.x - r], y = [r, size.y - r]) translate([x, y, 0]) {
      cylinder(r = r, h = size.z - ch, $fn = 32);
      cylinder(r = r - ch, h = size.z, $fn = 32);
    }
}

// A rounded box hollowed to wall thickness, open on top unless closed.
module shell_box(size = [60, 40, 25], wall = 2, r = 3, open_top = true) {
  difference() {
    rounded_box(size, r);
    translate([wall, wall, wall]) rounded_box([size.x - 2 * wall, size.y - 2 * wall, size.z - (open_top ? 0 : 2 * wall) + (open_top ? r + 1 : 0)], max(0.5, r - wall));
  }
}

// ---- fastening --------------------------------------------------------------------
// A screw post with a flared base (a fillet where it meets the floor).
// hole: 2.6 for an M3 self-tapping screw, 2.2 for M2.5, 3.4 for a through bolt.
module screw_boss(h = 8, d = 7, hole = 2.6, flare = 2) {
  difference() {
    union() {
      cylinder(d = d, h = h, $fn = 32);
      cylinder(d1 = d + 2 * flare, d2 = d, h = flare, $fn = 32);
    }
    translate([0, 0, 1.2]) cylinder(d = hole, h = h, $fn = 20);
    // A lead-in chamfer so the screw finds the hole.
    translate([0, 0, h - 0.6]) cylinder(d1 = hole, d2 = hole + 1.2, h = 0.61, $fn = 20);
  }
}

// A boss for a melt-in brass insert (M3 x 5.7: 4.0 mm hole, 5.8 deep).
module insert_boss(h = 8, insert = [4.0, 5.8], d = 8, flare = 2) {
  difference() {
    union() {
      cylinder(d = d, h = h, $fn = 32);
      cylinder(d1 = d + 2 * flare, d2 = d, h = flare, $fn = 32);
    }
    translate([0, 0, h - insert[1]]) cylinder(d = insert[0], h = insert[1] + 1, $fn = 24);
  }
}

// cut: a countersunk clearance hole through t, head at the top (z = t).
module cs_hole(t = 4, d = 3.4, head = 6.6) {
  translate([0, 0, -1]) cylinder(d = d, h = t + 2, $fn = 20);
  translate([0, 0, t - (head - d) / 2]) cylinder(d1 = d, d2 = head, h = (head - d) / 2 + 0.01, $fn = 24);
  translate([0, 0, t]) cylinder(d = head, h = 1, $fn = 24);
}

// cut: a hex nut trap (M3: 5.5 across flats, 2.4 thick) from z = 0 up.
module nut_trap(flats = 5.5, depth = 2.6) {
  cylinder(d = flats / cos(30) + 0.3, h = depth, $fn = 6);
}

// ---- stiffening -------------------------------------------------------------------
// A triangular rib along +x standing on z = 0, thickness t across y.
module rib(length = 20, height = 8, t = 1.6) {
  rotate([90, 0, 0]) linear_extrude(t, center = true)
    polygon([[0, 0], [length, 0], [length, 0.6], [0.6, height], [0, height]]);
}

// ---- straps, ties, snaps ----------------------------------------------------------
// cut: a slot for a strap w wide (gap thick), its length along y, through z.
module strap_slot(w = 25, gap = 3, depth = 20) {
  hull() for (y = [-w / 2 + gap / 2, w / 2 - gap / 2])
    translate([0, y, -depth / 2]) cylinder(d = gap, h = depth, $fn = 16);
}

// A zip-tie anchor: a bridge the tie threads under, on z = 0.
module tie_anchor(tie_w = 4, tie_t = 1.6) {
  difference() {
    translate([-(tie_w + 5) / 2, -3.5, 0]) rounded_box([tie_w + 5, 7, tie_t + 2.4], 1);
    translate([-tie_w / 2 - 0.3, -5, -0.01]) cube([tie_w + 0.6, 10, tie_t + 0.4]);
  }
}

// A cantilever snap hook standing up from z = 0, its barb facing +y,
// with a lead-in ramp on top; pairs with snap_window().
module snap_hook(length = 10, width = 6, t = 1.6, lip = 1) {
  translate([-width / 2, 0, 0]) {
    cube([width, t, length]);
    hull() {
      translate([0, t - 0.01, length - 2.4 * lip]) cube([width, 0.01, 2.4 * lip]);
      translate([0, t + lip - 0.01, length - 2.4 * lip]) cube([width, 0.01, 0.8 * lip]);
    }
  }
}

// cut: the window a snap hook's barb clicks into.
module snap_window(width = 6, lip = 1, wall = 2) {
  translate([-(width + 0.6) / 2, -0.01, 0]) cube([width + 0.6, wall + 0.02, 1.2 * lip + 0.4]);
}

// ---- wiring -----------------------------------------------------------------------
// cut: a round-bottomed channel along +x for a cable w across, d deep,
// its open top at z = 0 (put it at the surface it is cut into).
module cable_channel(length = 40, w = 6, d = 4) {
  hull() {
    translate([0, 0, -d + w / 2]) rotate([0, 90, 0]) cylinder(d = w, h = length, $fn = 20);
    translate([0, -w / 2, -0.01]) cube([length, w, 1]);
  }
}

// cut: a hole for a cable through a wall t thick, chamfered both faces.
module cable_hole(d = 6, t = 3) {
  translate([0, 0, -1]) cylinder(d = d, h = t + 2, $fn = 24);
  translate([0, 0, -0.01]) cylinder(d1 = d + 1.6, d2 = d, h = 0.8, $fn = 24);
  translate([0, 0, t - 0.79]) cylinder(d1 = d, d2 = d + 1.6, h = 0.8, $fn = 24);
}

// A C-clip that holds a cable of diameter d against a surface (z = 0).
module cable_clip(d = 5, t = 1.6, width = 6) {
  rotate([90, 0, 0]) linear_extrude(width, center = true) difference() {
    union() {
      translate([0, d / 2 + t]) circle(d = d + 2 * t, $fn = 32);
      translate([-(d + 2 * t) / 2 - 2, 0]) square([d + 2 * t + 4, t]);
    }
    translate([0, d / 2 + t]) circle(d = d, $fn = 32);
    // The mouth it snaps in through.
    translate([-d * 0.35, d / 2 + t]) square([d * 0.7, d]);
  }
}

// ---- vents ------------------------------------------------------------------------
// cut: a field of hexagonal vents filling size [x, y], centred, through t.
module hex_vents(size = [40, 20], cell = 6, wall = 1.6, t = 3) {
  pitch = cell + wall;
  intersection() {
    translate([-size.x / 2, -size.y / 2, -1]) cube([size.x, size.y, t + 2]);
    for (i = [-ceil(size.x / pitch) : ceil(size.x / pitch)], j = [-ceil(size.y / (pitch * 0.866)) : ceil(size.y / (pitch * 0.866))])
      translate([i * pitch + (j % 2) * pitch / 2, j * pitch * 0.866, -1])
        rotate(30) cylinder(d = cell / cos(30), h = t + 2, $fn = 6);
  }
}

// ---- surface ----------------------------------------------------------------------
// cut: a panel line, a shallow V groove along +x at the surface (z = 0).
module panel_line(length = 40, w = 0.8, d = 0.5) {
  rotate([0, 90, 0]) rotate(45) translate([0, 0, 0]) linear_extrude(length) polygon([[-d, 0], [0, -w / 2 * 1.41], [d, 0], [0, w / 2 * 1.41]]);
}

// ---- labels -----------------------------------------------------------------------
// Raised lettering in a stroke font (no font files needed): A-Z, 0-9 and
// - . / + : on z = 0, size the cap height. Deboss it by subtracting it,
// translated down by its depth. Centred unless center = false.
module label(txt = "JARVIS", size = 5, depth = 0.6, stroke = 0, center = true) {
  s = size / 6;
  w = stroke > 0 ? stroke : max(0.5, size * 0.14);
  adv = 5.6 * s;
  total = len(txt) * adv - 1.6 * s;
  if (len(txt) > 0)
    translate(center ? [-total / 2, -size / 2, 0] : [0, 0, 0])
      for (i = [0 : len(txt) - 1]) translate([i * adv, 0, 0])
        for (line = _glyph(_upper(txt[i]))) for (k = [0 : len(line) - 2])
          hull() {
            translate([line[k].x * s, line[k].y * s, 0]) cylinder(d1 = w, d2 = w * 0.7, h = depth, $fn = 10);
            translate([line[k + 1].x * s, line[k + 1].y * s, 0]) cylinder(d1 = w, d2 = w * 0.7, h = depth, $fn = 10);
          }
}

function _upper(c) = let(o = ord(c)) (o >= 97 && o <= 122) ? chr(o - 32) : c;

// Strokes on a 4 x 6 grid.
_O = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
_P = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
function _glyph(c) =
  c == "A" ? [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]] :
  c == "B" ? [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]] :
  c == "C" ? [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]] :
  c == "D" ? [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]] :
  c == "E" ? [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]] :
  c == "F" ? [[[0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]] :
  c == "G" ? [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]] :
  c == "H" ? [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]] :
  c == "I" ? [[[1, 0], [3, 0]], [[2, 0], [2, 6]], [[1, 6], [3, 6]]] :
  c == "J" ? [[[0, 1], [1, 0], [2, 0], [3, 1], [3, 6]], [[2, 6], [4, 6]]] :
  c == "K" ? [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]] :
  c == "L" ? [[[0, 6], [0, 0], [4, 0]]] :
  c == "M" ? [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]] :
  c == "N" ? [[[0, 0], [0, 6], [4, 0], [4, 6]]] :
  c == "O" ? [_O] :
  c == "P" ? [_P] :
  c == "Q" ? [_O, [[2, 2], [4, 0]]] :
  c == "R" ? [_P, [[2, 3], [4, 0]]] :
  c == "S" ? [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]] :
  c == "T" ? [[[0, 6], [4, 6]], [[2, 6], [2, 0]]] :
  c == "U" ? [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]] :
  c == "V" ? [[[0, 6], [2, 0], [4, 6]]] :
  c == "W" ? [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]] :
  c == "X" ? [[[0, 0], [4, 6]], [[0, 6], [4, 0]]] :
  c == "Y" ? [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]] :
  c == "Z" ? [[[0, 6], [4, 6], [0, 0], [4, 0]]] :
  c == "0" ? [_O, [[0, 1], [4, 5]]] :
  c == "1" ? [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]] :
  c == "2" ? [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]] :
  c == "3" ? [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]], [[1, 3], [3, 3]]] :
  c == "4" ? [[[3, 0], [3, 6], [0, 2], [4, 2]]] :
  c == "5" ? [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]] :
  c == "6" ? [[[3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]] :
  c == "7" ? [[[0, 6], [4, 6], [1, 0]]] :
  c == "8" ? [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]] :
  c == "9" ? [[[4, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]] :
  c == "-" ? [[[1, 3], [3, 3]]] :
  c == "+" ? [[[2, 1], [2, 5]], [[0, 3], [4, 3]]] :
  c == "/" ? [[[0, 0], [4, 6]]] :
  c == "." ? [[[2, 0], [2, 0.05]]] :
  c == ":" ? [[[2, 1.5], [2, 1.55]], [[2, 4.5], [2, 4.55]]] :
  [];
`
