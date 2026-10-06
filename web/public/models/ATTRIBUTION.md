# 3D model attribution

`uno-r3.glb` and `uno-r3-board.json` - the workshop's Arduino UNO R3 - are
built by `scripts/build-uno-model.mjs` from:

- **Arduino UNO Rev3 CAD files (A000066)**, by Arduino, licensed under the
  [Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).
  Source: https://docs.arduino.cc/hardware/uno-rev3/ - the board outline,
  copper, pads, vias, silkscreen and the placement of every component.
- **KiCad 3D models library**, by the KiCad library contributors, licensed under
  [CC-BY-SA 4.0](https://www.kicad.org/libraries/license/) (some model files
  also carry the GPL notice of the scripts that generated them). Source:
  https://gitlab.com/kicad/libraries/kicad-packages3D - the component models
  (DIP-28 and its socket, pin sockets and headers, SMD passives, LEDs, diodes,
  SOT/MSOP/QFN packages, crystals, the barrel jack and the reset switch).

Changes: the board data was extracted from the Eagle board file; the KiCad
STEP models were tessellated (OpenCascade, via occt-import-js), placed at the
board file's positions and merged by material. The USB-B socket and the
polyfuse are modelled in `lib/workshop/project/genuine.ts`.

These two files are shared under the same license, CC BY-SA 4.0.
