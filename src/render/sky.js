// Sky + time-of-day + weather.
// The sky dome is a single fragment shader: gradient atmosphere, HDR sun disc (feeds bloom
// and the god-ray pass), a cratered moon, twinkling star field, scrolling fbm clouds and a
// ray-marched aurora curtain at night. The Environment class drives every lighting uniform so
// fog, ambient and sky always agree.
import * as THREE from 'three';
import { G } from './psxMaterial.js';
import { smoothstep, lerp } from '../core/rng.js';

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to far plane
}`;

const skyFrag = /* glsl */`
uniform vec3 uZenith, uHorizon, uGroundCol, uSunDirSky, uMoonDir, uSunGlow;
uniform float uStars, uAurora, uClouds, uTime, uSunVis, uCloudDark;
varying vec3 vDir;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGroundCol, smoothstep(0.0, -0.12, h));

  // sun
  float sd = max(dot(d, uSunDirSky), 0.0);
  col += uSunGlow * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.6) ;
  col += uSunGlow * smoothstep(0.9993, 0.9996, sd) * 30.0 * uSunVis;

  // stars
  if (uStars > 0.01 && h > 0.0) {
    vec2 sp = vec2(atan(d.z, d.x) * 120.0, asin(clamp(d.y, -1.0, 1.0)) * 120.0);
    vec2 cell = floor(sp);
    float r = h21(cell);
    if (r > 0.985) {
      vec2 c = fract(sp) - 0.5;
      float tw = 0.6 + 0.4 * sin(uTime * (2.0 + r * 6.0) + r * 100.0);
      col += vec3(0.8, 0.85, 1.0) * smoothstep(0.25, 0.0, length(c)) * uStars * tw * (r - 0.985) * 120.0 * smoothstep(0.0, 0.25, h);
    }
  }

  // moon
  float md = dot(d, uMoonDir);
  if (md > 0.9985) {
    vec2 mp = vec2(dot(d, normalize(cross(uMoonDir, vec3(0,1,0)))), d.y - uMoonDir.y) * 600.0;
    float crater = fbm(mp * 0.25);
    col = mix(col, vec3(0.75, 0.78, 0.85) * (0.7 + crater * 0.6) * 1.6, smoothstep(0.9985, 0.9990, md) * uStars);
  }
  col += vec3(0.3, 0.38, 0.55) * pow(max(md, 0.0), 300.0) * uStars * 0.5;

  // aurora: march a few horizontal sheets and accumulate banded noise
  if (uAurora > 0.01 && h > 0.02) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float ph = 1.0 + (fi + h21(gl_FragCoord.xy) ) * 0.045;
      vec2 p = d.xz * (ph / d.y) * 0.9;
      p += vec2(uTime * 0.012, uTime * 0.004);
      float w = n2(p * 0.6 + vec2(0.0, uTime * 0.02)) * 2.0;
      float band = fbm(vec2(p.x * 0.8 + w, p.y * 0.25));
      band = pow(1.0 - abs(band - 0.5) * 2.0, 6.0);
      vec3 c = mix(vec3(0.1, 1.0, 0.45), vec3(0.6, 0.2, 1.0), fi / 18.0);
      acc += c * band * (1.0 - fi / 18.0) * 0.12;
    }
    col += acc * uAurora * smoothstep(0.02, 0.25, h);
  }

  // clouds on a virtual plane
  if (h > 0.0) {
    vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime * 0.01, uTime * 0.004);
    float c = fbm(cp);
    float cov = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.35, c);
    vec3 cc = mix(uHorizon * 1.05, vec3(1.0) * (uSunGlow * 0.15 + uZenith * 0.6 + 0.12), 0.5) * (1.0 - uCloudDark * 0.6);
    cc += uSunGlow * pow(sd, 4.0) * 0.4 * (1.0 - c);
    col = mix(col, cc, cov * smoothstep(0.0, 0.18, h) * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGroundCol: { value: new THREE.Color() },
      uSunDirSky: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() }, uSunGlow: { value: new THREE.Color() },
      uStars: { value: 0 }, uAurora: { value: 0 }, uClouds: { value: 0.4 }, uTime: G.uTime, uSunVis: { value: 1 }, uCloudDark: { value: 0 },
    },
    vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

const C = (h) => new THREE.Color(h);
const PAL = {
  dayZen: C(0x3a6aa6), dayHor: C(0xb5cadb), duskZen: C(0x3b4a7a), duskHor: C(0xe38d55), nightZen: C(0x03050c), nightHor: C(0x1a2742),
  daySun: new THREE.Color(1.0, 0.94, 0.82).multiplyScalar(2.4), duskSun: new THREE.Color(1.0, 0.5, 0.25).multiplyScalar(1.8), moon: new THREE.Color(0.32, 0.42, 0.72).multiplyScalar(0.95),
};
const tmp = new THREE.Color(), tmp2 = new THREE.Color();

export const WEATHERS = ['clear', 'snow', 'mist'];

export class Environment {
  constructor(sky) {
    this.sky = sky;
    this.time = 9.5; // hours
    this.daySpeed = 24 / (16 * 60); // one day per 16 real minutes
    this.weather = 'clear';
    this.weatherT = 0; // 0 clear .. 1 full weather
    this.snowCover = 0;
    this.sunDir = new THREE.Vector3();
    this.realSunDir = new THREE.Vector3();
    this.sunVisible = 1;
    this.fogMul = 1;
    this.auroraBoost = 1;
    this.exposure = 1;
  }
  setWeather(w) { this.weather = w; }
  get isNight() { return this.realSunDir.y < -0.05; }

  update(dt, fast) {
    this.time = (this.time + dt * this.daySpeed * (fast ? 60 : 1)) % 24;
    const target = this.weather === 'clear' ? 0 : 1;
    this.weatherT += Math.sign(target - this.weatherT) * Math.min(Math.abs(target - this.weatherT), dt * 0.25);
    if (this.weather === 'snow') this.snowCover = Math.min(1, this.snowCover + dt * 0.02);
    else this.snowCover = Math.max(0, this.snowCover - dt * 0.01);

    const ang = ((this.time - 6) / 24) * Math.PI * 2;
    const el = Math.sin(ang) * 1.05;
    const az = ang * 0.5 + 0.6;
    this.realSunDir.set(Math.cos(az) * Math.cos(el) , Math.sin(el), Math.sin(az) * Math.cos(el) * 0.7 + 0.3).normalize();
    const e = this.realSunDir.y;
    const moonDir = this.realSunDir.clone().multiplyScalar(-1); moonDir.y = Math.abs(moonDir.y) * 0.9 + 0.1; moonDir.normalize();

    const day = smoothstep(-0.02, 0.35, e);
    const dusk = (1 - smoothstep(0.05, 0.4, Math.abs(e - 0.02) + 0.05)) * 1.0;
    const night = 1 - smoothstep(-0.25, 0.0, e);
    const wT = this.weatherT;
    const mist = this.weather === 'mist' ? wT : 0, snow = this.weather === 'snow' ? wT : 0;

    // sky colours
    const zen = tmp.copy(PAL.nightZen).lerp(PAL.dayZen, day);
    zen.lerp(PAL.duskZen, dusk * 0.6);
    const hor = tmp2.copy(PAL.nightHor).lerp(PAL.dayHor, day);
    hor.lerp(PAL.duskHor, dusk * 0.75);
    const grey = new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(0.15 + day * 0.85);
    zen.lerp(grey, wT * 0.75); hor.lerp(grey, wT * 0.8);

    const u = this.sky.material.uniforms;
    u.uZenith.value.copy(zen);
    u.uHorizon.value.copy(hor);
    u.uGroundCol.value.copy(hor).multiplyScalar(0.55);
    u.uSunDirSky.value.copy(this.realSunDir);
    u.uMoonDir.value.copy(moonDir);
    const sunCol = new THREE.Color().copy(PAL.duskSun).lerp(PAL.daySun, smoothstep(0.05, 0.4, e));
    u.uSunGlow.value.copy(sunCol).multiplyScalar(smoothstep(-0.08, 0.04, e) * (1 - wT * 0.8));
    u.uStars.value = night * (1 - wT * 0.9);
    u.uAurora.value = night * (1 - wT * 0.9) * this.auroraBoost;
    u.uClouds.value = 0.35 + wT * 0.55;
    u.uCloudDark.value = wT;
    u.uSunVis.value = 1 - wT;

    // light: sun by day, moon by night
    const useMoon = e < -0.02;
    this.sunDir.copy(useMoon ? moonDir : this.realSunDir);
    G.uSunDir.value.copy(this.sunDir);
    const lightCol = useMoon ? PAL.moon.clone() : sunCol.clone().multiplyScalar(smoothstep(-0.02, 0.12, e));
    lightCol.multiplyScalar(1 - wT * 0.65);
    G.uSunColor.value.copy(lightCol);
    this.sunVisible = (useMoon ? 0 : smoothstep(-0.02, 0.1, e)) * (1 - wT);

    const ambDay = new THREE.Color(0.34, 0.42, 0.58), ambNight = new THREE.Color(0.15, 0.19, 0.32);
    G.uSkyAmb.value.copy(ambNight).lerp(ambDay, day).lerp(new THREE.Color(0.5, 0.36, 0.38), dusk * 0.25);
    G.uSkyAmb.value.lerp(new THREE.Color(0.45, 0.48, 0.52).multiplyScalar(0.2 + day * 0.8), wT * 0.5);
    G.uGroundAmb.value.copy(G.uSkyAmb.value).multiplyScalar(0.45).lerp(new THREE.Color(0.14, 0.11, 0.08), day * 0.5);

    G.uFogColor.value.copy(hor).lerp(zen, 0.15);
    this.exposure = 1 + night * 1.1 + wT * 0.15;
    G.uFogDensity.value = lerp(0.0065, 0.02, snow) * (1 + mist * 3.2) * this.fogMul * (1 + night * 0.5);
    G.uFogHeightFalloff.value = lerp(0.035, 0.02, mist);
    G.uWind.value = 1 + snow * 1.6;
    G.uSnowCover.value = this.snowCover;
  }
}
