import * as THREE from "three"

// The hologram's surface: light, not paint. Bright where a surface turns
// away from the eye (a fresnel rim, so a form reads by its silhouette),
// fine scanlines running up it, a brighter band sweeping slowly through,
// and the faint flicker of a projection - added onto whatever is behind,
// never hiding it (additive, no depth write). Clipped like any material,
// so the stage's scan can cut it; instanced meshes work too.
//
// One clock for every hologram, read when three uploads the uniform, so
// the stage, the gallery, the folder's viewer and the try-on all animate
// without each having to tick it.

export const holoClock = {
  get value() {
    return performance.now() / 1000
  },
}

const vertexShader = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vNormalView;
varying vec3 vToEye;
varying vec3 vWorld;
void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vNormalView = normalize(transformedNormal);
  vToEye = -mvPosition.xyz;
  vec4 world = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    world = instanceMatrix * world;
  #endif
  vWorld = (modelMatrix * world).xyz;
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uDensity;
#include <clipping_planes_pars_fragment>
varying vec3 vNormalView;
varying vec3 vToEye;
varying vec3 vWorld;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  #include <clipping_planes_fragment>
  vec3 n = normalize(vNormalView);
  vec3 v = normalize(vToEye);
  float rim = pow(1.0 - abs(dot(n, v)), 2.4);
  // Fine scanlines, drifting up.
  float lines = pow(0.5 + 0.5 * sin((vWorld.y * uDensity - uTime * 0.6) * 6.2831853), 10.0);
  // A brighter band sweeping up through the form every few seconds.
  float band = exp(-pow((fract(vWorld.y * 0.35 - uTime * 0.12) - 0.5) * 22.0, 2.0));
  // Projection flicker, stepped like a refresh rather than smooth.
  float flicker = 0.92 + 0.08 * hash(floor(uTime * 20.0));
  float alpha = (0.035 + rim * 0.7 + lines * 0.05 + band * 0.18) * flicker * uOpacity;
  vec3 color = uColor * (0.55 + rim * 1.15 + band * 0.7);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Fade a hologram fill, the shader's or a plain additive one. `level`
 *  is 0-1 (the shader's own brightness at 1). */
export function setHoloOpacity(material: THREE.Material, level: number) {
  const shader = material as THREE.ShaderMaterial
  if (shader.uniforms?.uOpacity) shader.uniforms.uOpacity.value = level
  else material.opacity = 0.07 * level
}

/** A hologram surface in `color`. `density`: scanlines per scene unit. */
export function holoMaterial(color: number, { opacity = 1, density = 40 } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: holoClock,
      uOpacity: { value: opacity },
      uDensity: { value: density },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    clipping: true,
  })
}
