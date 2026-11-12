// The heart of the look: one hand-written uber-shader used by every lit surface.
//
//  1997 tricks                         | modern tricks
//  ------------------------------------+---------------------------------------------
//  vertex snapping to a coarse grid    | PCF soft shadow maps from the sun
//  affine (non-perspective) UVs        | analytic exponential height fog w/ sun in-scatter
//  per-vertex Gouraud lighting         | optional per-pixel lighting + rim light
//  vertex-colour baked AO              | GPU wind + player-interaction foliage bending
//  nearest-neighbour texels            | noise dissolve with emissive burn edge (feeds bloom)
//
// Everything that is global (sun, fog, lights, shadow map, PSX knobs) lives in one shared
// uniform block so a graphics-mix switch is just a handful of uniform writes.
import * as THREE from 'three';

export const MAX_POINT_LIGHTS = 8;

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uSkyAmb: { value: new THREE.Color(0.35, 0.42, 0.55) },
  uGroundAmb: { value: new THREE.Color(0.18, 0.16, 0.13) },
  uPointPos: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Vector4(0, -999, 0, 1)) },
  uPointCol: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Vector3()) },
  uFogColor: { value: new THREE.Color(0.6, 0.68, 0.78) },
  uFogDensity: { value: 0.012 },
  uFogHeightFalloff: { value: 0.045 },
  uFogBase: { value: 0 },
  uSnapRes: { value: new THREE.Vector2(160, 120) },
  uSnapOn: { value: 1 },
  uAffine: { value: 1 },
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 1 },
  uShadowSoft: { value: 1.5 },
  uShadowTexel: { value: 1 / 2048 },
  uWind: { value: 1 },
  uPlayerPos: { value: new THREE.Vector3() },
  uColorSteps: { value: 0 },         // per-vertex light banding (0 = off)
  uRim: { value: 0 },
  uSnowCover: { value: 0 },
};

const COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec4 uPointPos[${MAX_POINT_LIGHTS}];
uniform vec3 uPointCol[${MAX_POINT_LIGHTS}];
uniform float uColorSteps;

void psxLight(vec3 P, vec3 N, out vec3 sun, out vec3 other) {
  float ndl = max(dot(N, uSunDir), 0.0);
  sun = uSunColor * ndl;
  other = mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    vec3 d = uPointPos[i].xyz - P;
    float dist = length(d);
    float att = clamp(1.0 - dist / uPointPos[i].w, 0.0, 1.0);
    att *= att;
    float l = max(dot(N, d / max(dist, 1e-3)), 0.0) * 0.8 + 0.2;
    other += uPointCol[i] * att * l;
  }
  if (uColorSteps > 0.5) {
    sun = floor(sun * uColorSteps + 0.5) / uColorSteps;
    other = floor(other * uColorSteps + 0.5) / uColorSteps;
  }
}
`;

const VERT = /* glsl */`
${COMMON}
#include <common>
#include <skinning_pars_vertex>

uniform vec2 uSnapRes;
uniform float uSnapOn;
uniform float uWind;
uniform vec3 uPlayerPos;
uniform mat4 uShadowMatrix;
uniform vec2 uUvScale;

#ifdef TERRAIN
attribute vec4 splat;
varying vec4 vSplat;
#endif
#ifdef GRASS
uniform sampler2D uHeightTex;
uniform vec4 uHeightInfo;
uniform vec2 uGrassCenter;
uniform float uGrassSpacing;
uniform float uGrassGrid;
varying float vGrassTint;
#endif

varying vec2 vUv;
varying vec3 vUvAffine;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying vec3 vSunL;
varying vec3 vOtherL;
varying vec4 vShadowCoord;

void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #include <skinbase_vertex>
  #include <skinning_vertex>
  #include <skinnormal_vertex>

  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  wn = normalize(mat3(modelMatrix) * wn);

  #ifdef WIND
    // height-weighted sway; phase from world position so a forest ripples like a wave front
    float h = max(position.y, 0.0);
    float k = h * h * 0.0035 * uWind;
    float ph = uTime * 1.3 + wp.x * 0.07 + wp.z * 0.05;
    wp.x += (sin(ph) + 0.4 * sin(ph * 2.7)) * k;
    wp.z += cos(ph * 0.8) * k * 0.6;
  #endif
  #ifdef GRASS
    // GPU-driven grass field: instances are laid out on a grid that follows the camera;
    // each picks a stable jittered spot from a world-cell hash, reads terrain height & grass
    // density from a data texture, sways in the wind and parts around the player.
    float gid = float(gl_InstanceID);
    vec2 cell = vec2(mod(gid, uGrassGrid), floor(gid / uGrassGrid)) - uGrassGrid * 0.5;
    vec2 gp = uGrassCenter.xy + cell * uGrassSpacing;
    vec2 wc = floor(gp / uGrassSpacing + 0.5);
    vec3 hh = vec3(fract(sin(dot(wc, vec2(127.1, 311.7))) * 43758.5453), fract(sin(dot(wc, vec2(269.5, 183.3))) * 43758.5453), fract(sin(dot(wc, vec2(419.2, 371.9))) * 43758.5453));
    gp += (hh.xy - 0.5) * uGrassSpacing * 1.6;
    vec2 g = (gp - uHeightInfo.xy) / uHeightInfo.z;
    ivec2 gi = ivec2(floor(g));
    vec2 gf = fract(g);
    vec4 t00 = texelFetch(uHeightTex, gi, 0), t10 = texelFetch(uHeightTex, gi + ivec2(1, 0), 0);
    vec4 t01 = texelFetch(uHeightTex, gi + ivec2(0, 1), 0), t11 = texelFetch(uHeightTex, gi + ivec2(1, 1), 0);
    vec2 hm = (gf.x + gf.y < 1.0) ? t00.rg + (t10.rg - t00.rg) * gf.x + (t01.rg - t00.rg) * gf.y
                                  : t11.rg + (t01.rg - t11.rg) * (1.0 - gf.x) + (t10.rg - t11.rg) * (1.0 - gf.y);
    float camD = distance(gp, cameraPosition.xz);
    float fade = 1.0 - smoothstep(uGrassGrid * uGrassSpacing * 0.36, uGrassGrid * uGrassSpacing * 0.48, camD);
    float sc = step(hh.z * 0.9 + 0.1, hm.y) * fade * (0.55 + hh.z * 0.75);
    float ang = hh.x * 6.2831;
    vec3 lp = position * sc;
    lp.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * lp.xz;
    vec3 root = vec3(gp.x, hm.x - 0.04, gp.y);
    wp = vec4(root + lp, 1.0);
    float h = uv.y > 0.5 ? 1.0 : 0.0;
    float ph = uTime * 2.1 + root.x * 0.3 + root.z * 0.23;
    wp.x += sin(ph) * 0.16 * h * uWind * sc;
    wp.z += cos(ph * 0.7) * 0.11 * h * uWind * sc;
    vec3 away = root - uPlayerPos; away.y = 0.0;
    float push = (1.0 - smoothstep(0.0, 1.5, length(away))) * h * sc;
    wp.xz += normalize(away.xz + 1e-4) * push * 0.55;
    wp.y -= push * 0.3;
    wn = vec3(0.0, 1.0, 0.0);
    #ifdef USE_COLOR
      vGrassTint = 0.8 + hh.y * 0.4;
    #endif
  #endif

  vWorldPos = wp.xyz;
  vNormalW = wn;
  vUv = uv * uUvScale;
  #ifdef WORLD_UV
    vUv = wp.xz * uUvScale;
  #endif

  vec4 clip = projectionMatrix * viewMatrix * wp;
  // PS1 GTE had no sub-pixel precision: snap the projected vertex to a coarse grid
  if (uSnapOn > 0.5 && clip.w > 0.0) {
    vec2 ndc = clip.xy / clip.w;
    ndc = floor(ndc * uSnapRes + 0.5) / uSnapRes;
    clip.xy = ndc * clip.w;
  }
  gl_Position = clip;
  // affine texture mapping: interpolate uv*w and w, divide per-fragment -> screen-linear uvs
  vUvAffine = vec3(vUv * clip.w, clip.w);

  #ifdef USE_COLOR
    vColor = color;
  #else
    vColor = vec3(1.0);
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColor *= instanceColor;
  #endif
  #ifdef GRASS
    vColor *= vec3(vGrassTint * 1.05, vGrassTint, vGrassTint * 0.8);
  #endif
  #ifdef TERRAIN
    vSplat = splat;
  #endif

  vShadowCoord = uShadowMatrix * vec4(wp.xyz + wn * 0.08, 1.0);

  #ifndef PIXEL_LIGHTING
    psxLight(wp.xyz, wn, vSunL, vOtherL);
  #endif
}
`;

const FRAG = /* glsl */`
${COMMON}
uniform sampler2D map;
uniform vec3 uTint;
uniform float uDesat;
uniform vec3 uEmissive;
uniform float uEmissiveMask;
uniform float uAffine;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uFlash;
uniform float uAlphaTest;
uniform float uOpacity;
uniform float uSnowCover;
uniform float uRim;

uniform sampler2D uShadowMap;
uniform float uShadowOn;
uniform float uShadowSoft;
uniform float uShadowTexel;

uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uFogBase;

#ifdef TERRAIN
uniform sampler2D tex1;
uniform sampler2D tex2;
uniform sampler2D tex3;
varying vec4 vSplat;
#endif

varying vec2 vUv;
varying vec3 vUvAffine;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying vec3 vSunL;
varying vec3 vOtherL;
varying vec4 vShadowCoord;

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float shadowSample(vec2 uv, float z) {
  float d = texture2D(uShadowMap, uv).r;
  return z - 0.0015 > d ? 0.0 : 1.0;
}
float getShadow() {
  if (uShadowOn < 0.5) return 1.0;
  vec3 sc = vShadowCoord.xyz;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  // 12-tap rotated poisson PCF — a 2010s technique on a 1997 frame
  vec2 poisson[12];
  poisson[0] = vec2(-0.326, -0.406); poisson[1] = vec2(-0.840, -0.074); poisson[2] = vec2(-0.696, 0.457);
  poisson[3] = vec2(-0.203, 0.621); poisson[4] = vec2(0.962, -0.195); poisson[5] = vec2(0.473, -0.480);
  poisson[6] = vec2(0.519, 0.767); poisson[7] = vec2(0.185, -0.893); poisson[8] = vec2(0.507, 0.064);
  poisson[9] = vec2(0.896, 0.412); poisson[10] = vec2(-0.322, -0.933); poisson[11] = vec2(-0.792, -0.598);
  float ang = hash13(floor(vWorldPos * 8.0)) * 6.2831;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  float s = 0.0;
  for (int i = 0; i < 12; i++) s += shadowSample(sc.xy + rot * poisson[i] * uShadowTexel * uShadowSoft, sc.z);
  float sh = s / 12.0;
  // fade out at the edges of the cascade
  vec2 e = smoothstep(0.0, 0.06, sc.xy) * (1.0 - smoothstep(0.94, 1.0, sc.xy));
  return mix(1.0, sh, e.x * e.y);
}

void main() {
  vec2 uvP = vUv;
  vec2 uvA = vUvAffine.xy / vUvAffine.z;
  vec2 uv = mix(uvP, uvA, uAffine);

  #ifdef TERRAIN
    vec4 c0 = texture2D(map, uv);
    vec4 c1 = texture2D(tex1, uv * 0.7);
    vec4 c2 = texture2D(tex2, uv * 0.8);
    vec4 c3 = texture2D(tex3, uv);
    // height-based splat blend: per-pixel noise sharpens transitions like a modern terrain shader
    float n = vnoise3(vWorldPos * 0.9) * 0.5 + vnoise3(vWorldPos * 0.21) * 0.5;
    vec4 w = vSplat * (0.6 + vec4(n, 1.0 - n, n * 0.8 + 0.2, 0.5 + n * 0.5));
    w = pow(max(w, 0.0), vec4(3.0));
    w /= max(dot(w, vec4(1.0)), 1e-4);
    vec4 tex = c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w;
  #else
    vec4 tex = texture2D(map, uv);
  #endif

  #ifdef ALPHA_TEST
    if (tex.a < uAlphaTest) discard;
  #endif

  // dissolve (death / spawn effect)
  float dn = 0.0;
  if (uDissolve > 0.0) {
    dn = vnoise3(vWorldPos * 4.0) * 0.7 + vnoise3(vWorldPos * 13.0) * 0.3;
    if (dn < uDissolve) discard;
  }

  vec3 albedo = tex.rgb;
  float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
  albedo = mix(albedo, vec3(lum), uDesat) * uTint * vColor;

  vec3 N = normalize(vNormalW);
  // snow accumulates on upward-facing surfaces when the weather turns
  float snowAmt = uSnowCover * smoothstep(0.55, 0.85, N.y) * smoothstep(0.35, 0.6, vnoise3(vWorldPos * 0.6));
  albedo = mix(albedo, vec3(0.82, 0.86, 0.92), snowAmt);

  vec3 sunL, otherL;
  #ifdef PIXEL_LIGHTING
    psxLight(vWorldPos, N, sunL, otherL);
  #else
    sunL = vSunL; otherL = vOtherL;
  #endif

  float sh = getShadow();
  vec3 lit = albedo * (sunL * sh + otherL);

  vec3 V = normalize(cameraPosition - vWorldPos);
  if (uRim > 0.0) {
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    lit += rim * uRim * (uSkyAmb * 0.6 + uSunColor * 0.25) * sh;
  }

  // emissive (alpha channel of runic textures can act as an emissive mask)
  float emMask = mix(1.0, tex.a, uEmissiveMask);
  lit += uEmissive * emMask * (uEmissiveMask > 0.5 ? (0.75 + 0.25 * sin(uTime * 2.0 + vWorldPos.y)) : 1.0);
  lit += uFlash * vec3(1.0, 0.85, 0.7);

  if (uDissolve > 0.0) {
    float edge = 1.0 - smoothstep(0.0, 0.06, dn - uDissolve);
    lit += uDissolveColor * edge * 6.0;
  }

  // analytic exponential height fog (Quilez) with sun in-scattering
  vec3 rd = vWorldPos - cameraPosition;
  float t = length(rd);
  rd /= max(t, 1e-4);
  float b = uFogHeightFalloff;
  float ry = abs(rd.y) < 1e-3 ? 1e-3 : rd.y;
  float fog = (uFogDensity / b) * exp(-(cameraPosition.y - uFogBase) * b) * (1.0 - exp(-t * ry * b)) / ry;
  fog = clamp(fog, 0.0, 1.0);
  float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 8.0);
  vec3 fogC = mix(uFogColor, uFogColor + uSunColor * 0.45, sunAmt);
  lit = mix(lit, fogC, fog);

  gl_FragColor = vec4(lit, uOpacity);
}
`;

/**
 * Create a PSX material.
 * @param {object} o
 *  map, tint, desat, emissive, emissiveMask, vertexColors, wind, grass, terrain (tex1..3),
 *  uvScale, worldUV, alphaTest, side, transparent, opacity, skinning(auto), rim
 */
export function psxMaterial(o = {}) {
  const defines = {};
  if (o.wind) defines.WIND = '';
  if (o.grass) defines.GRASS = '';
  if (o.terrain) defines.TERRAIN = '';
  if (o.worldUV) defines.WORLD_UV = '';
  if (o.alphaTest) defines.ALPHA_TEST = '';
  const uniforms = {
    ...G,
    map: { value: o.map || whiteTex() },
    tex1: { value: o.terrain ? o.terrain[0] : null },
    tex2: { value: o.terrain ? o.terrain[1] : null },
    tex3: { value: o.terrain ? o.terrain[2] : null },
    uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
    uDesat: { value: o.desat ?? 0 },
    uEmissive: { value: new THREE.Color(o.emissive ?? 0x000000) },
    uEmissiveMask: { value: o.emissiveMask ? 1 : 0 },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(o.dissolveColor ?? 0xff7a2a) },
    uFlash: { value: 0 },
    uAlphaTest: { value: o.alphaTest ?? 0.5 },
    uOpacity: { value: o.opacity ?? 1 },
    uUvScale: { value: new THREE.Vector2(...(Array.isArray(o.uvScale) ? o.uvScale : [o.uvScale ?? 1, o.uvScale ?? 1])) },
    uRim: o.rim !== undefined ? { value: o.rim } : G.uRim,
    ...(o.grass ? o.grass : {}),
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: !!o.vertexColors,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    depthWrite: o.depthWrite ?? !o.transparent,
  });
  m.userData.psx = true;
  allMaterials.add(m);
  return m;
}

export const allMaterials = new Set();
export function setPixelLighting(on) {
  for (const m of allMaterials) {
    const has = 'PIXEL_LIGHTING' in m.defines;
    if (on && !has) { m.defines.PIXEL_LIGHTING = ''; m.needsUpdate = true; }
    if (!on && has) { delete m.defines.PIXEL_LIGHTING; m.needsUpdate = true; }
  }
}

let _white;
function whiteTex() {
  if (_white) return _white;
  _white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  _white.needsUpdate = true;
  return _white;
}
