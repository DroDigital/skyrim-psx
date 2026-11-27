// Seeded heightfield terrain for one region ("Rimehold Vale").
// A bowl of ridged mountains surrounds a rolling valley; points of interest get flattened
// plateaus, a lake is carved out, and dirt roads are painted between landmarks.
// The mesh carries a 4-way splat attribute (grass / rock / snow / dirt) and baked vertex AO.
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { psxMaterial } from '../render/psxMaterial.js';
import { smoothstep, clamp, lerp } from '../core/rng.js';
import { G } from '../render/psxMaterial.js';

export const WORLD_HALF = 340;   // mesh extent
export const PLAY_RADIUS = 212;  // walkable radius
export const WATER_LEVEL = 3.0;

export class Terrain {
  constructor(rng, layout) {
    this.rng = rng;
    this.layout = layout;
    const r = rng.fork('noise');
    this.n1 = createNoise2D(() => r.next());
    this.n2 = createNoise2D(() => r.next());
    this.n3 = createNoise2D(() => r.next());
    this.N = 200;
    this.size = WORLD_HALF * 2;
    this.cell = this.size / this.N;
    this.heights = new Float32Array((this.N + 1) * (this.N + 1));
    // target heights for flattened POIs come from the un-flattened field
    for (const f of layout.flats) f.h = Math.max(this.baseHeight(f.x, f.z), WATER_LEVEL + 1.2) + (f.raise || 0);
    for (let j = 0; j <= this.N; j++) for (let i = 0; i <= this.N; i++) {
      const x = -WORLD_HALF + i * this.cell, z = -WORLD_HALF + j * this.cell;
      this.heights[j * (this.N + 1) + i] = this.fullHeight(x, z);
    }
  }

  fbm(n, x, z, oct) { let s = 0, a = 1, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, z * f); norm += a; a *= 0.5; f *= 2.03; } return s / norm; }
  ridged(x, z) { let s = 0, a = 1, f = 1, norm = 0; for (let i = 0; i < 5; i++) { s += a * (1 - Math.abs(this.n2(x * f, z * f))); norm += a; a *= 0.5; f *= 2.1; } return Math.pow(s / norm, 2); }

  baseHeight(x, z) {
    const L = this.layout;
    const r = Math.hypot(x - L.village.x * 0.3, z - L.village.z * 0.3);
    let h = 7 + this.fbm(this.n1, x * 0.005, z * 0.005, 4) * 9 + this.fbm(this.n3, x * 0.03, z * 0.03, 2) * 1.2;
    const ridge = this.ridged(x * 0.007, z * 0.007);
    h += ridge * 16 * smoothstep(50, 150, r);
    h += smoothstep(150, 250, r) * (30 + ridge * 70);
    // lake basin
    const ld = Math.hypot(x - L.lake.x, z - L.lake.z) / L.lake.r;
    h = lerp(h, WATER_LEVEL - 5, 1 - smoothstep(0.35, 1.25, ld));
    // barrow mound
    const bd = Math.hypot(x - L.barrow.x, z - L.barrow.z);
    h += 9 * Math.exp(-(bd * bd) / (2 * 30 * 30));
    return h;
  }

  fullHeight(x, z) {
    let h = this.baseHeight(x, z);
    for (const f of this.layout.flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      const t = 1 - smoothstep(f.r, f.r * 1.9, d);
      if (t > 0) h = lerp(h, f.h, t);
    }
    // roads sit slightly into the ground
    h -= this.roadAmount(x, z) * 0.25;
    return h;
  }

  roadAmount(x, z) {
    let best = 1e9;
    for (const s of this.layout.roads) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const t = clamp(((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = s.ax + dx * t, pz = s.az + dz * t;
      const wob = this.n3(x * 0.05, z * 0.05) * 1.2;
      best = Math.min(best, Math.hypot(x - px, z - pz) + wob);
    }
    return 1 - smoothstep(1.4, 3.0, best);
  }

  // triangle-accurate height lookup (matches the rendered mesh exactly)
  heightAt(x, z) {
    const N = this.N;
    const gx = clamp((x + WORLD_HALF) / this.cell, 0, N - 1e-4), gz = clamp((z + WORLD_HALF) / this.cell, 0, N - 1e-4);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const H = this.heights, W = N + 1;
    const h00 = H[j * W + i], h10 = H[j * W + i + 1], h01 = H[(j + 1) * W + i], h11 = H[(j + 1) * W + i + 1];
    if (fx + fz < 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.0;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }
  slopeAt(x, z) { return 1 - this.normalAt(x, z).y; }

  buildMesh(textures) {
    const N = this.N, W = N + 1;
    const pos = new Float32Array(W * W * 3), nor = new Float32Array(W * W * 3), col = new Float32Array(W * W * 3), spl = new Float32Array(W * W * 4), uv = new Float32Array(W * W * 2);
    const H = this.heights;
    const h = (i, j) => H[clamp(j, 0, N) * W + clamp(i, 0, N)];
    this.splatCache = new Float32Array(W * W * 4);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * W + i;
      const x = -WORLD_HALF + i * this.cell, z = -WORLD_HALF + j * this.cell, y = H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      const nx = h(i - 1, j) - h(i + 1, j), nz = h(i, j - 1) - h(i, j + 1), ny = 2 * this.cell;
      const nl = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / nl; nor[k * 3 + 1] = ny / nl; nor[k * 3 + 2] = nz / nl;
      uv[k * 2] = x / 4; uv[k * 2 + 1] = z / 4;

      // baked AO: compare against the average of a ring of neighbours
      let avg = 0, cnt = 0;
      for (let dj = -3; dj <= 3; dj += 3) for (let di = -3; di <= 3; di += 3) { if (di || dj) { avg += h(i + di, j + dj); cnt++; } }
      avg /= cnt;
      const ao = clamp(1 - (avg - y) * 0.06, 0.55, 1.08);
      // macro colour variation breaks visible tiling
      const mv = 0.88 + this.n3(x * 0.012, z * 0.012) * 0.12;
      col[k * 3] = ao * mv; col[k * 3 + 1] = ao * (mv * 0.98 + 0.02); col[k * 3 + 2] = ao * mv * 0.97;

      const slope = 1 - nor[k * 3 + 1];
      const nn = this.n1(x * 0.04, z * 0.04);
      let rock = smoothstep(0.17, 0.32, slope + nn * 0.04);
      let snow = smoothstep(36, 50, y + nn * 7) * (1 - rock * 0.55);
      let dirt = Math.max(this.roadAmount(x, z), smoothstep(WATER_LEVEL + 1.4, WATER_LEVEL + 0.2, y));
      for (const f of this.layout.flats) if (f.dirt) dirt = Math.max(dirt, (1 - smoothstep(f.r * 0.5, f.r * 1.1, Math.hypot(x - f.x, z - f.z))) * f.dirt);
      dirt *= (1 - rock) * (1 - snow);
      let grass = Math.max(0, 1 - rock - snow - dirt);
      const sum = grass + rock + snow + dirt + 1e-5;
      spl[k * 4] = grass / sum; spl[k * 4 + 1] = rock / sum; spl[k * 4 + 2] = snow / sum; spl[k * 4 + 3] = dirt / sum;
      this.splatCache.set([spl[k * 4], spl[k * 4 + 1], spl[k * 4 + 2], spl[k * 4 + 3]], k * 4);
    }
    const idx = new Uint32Array(N * N * 6);
    let p = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * W + i, b = j * W + i + 1, c = (j + 1) * W + i, d = (j + 1) * W + i + 1;
      // (00,01,10) and (01,11,10) — wound counter-clockwise seen from above
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = c; idx[p++] = d; idx[p++] = b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mat = psxMaterial({ map: textures.grass, terrain: [textures.rock, textures.snow, textures.dirt], vertexColors: true, uvScale: 1 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    this.mesh = mesh;
    return mesh;
  }

  splatAt(x, z) {
    const N = this.N, W = N + 1;
    const i = clamp(Math.round((x + WORLD_HALF) / this.cell), 0, N), j = clamp(Math.round((z + WORLD_HALF) / this.cell), 0, N);
    const k = (j * W + i) * 4, s = this.splatCache;
    return { grass: s[k], rock: s[k + 1], snow: s[k + 2], dirt: s[k + 3] };
  }
}

// ---------------- water ----------------
const waterVert = /* glsl */`
uniform float uTime; uniform vec2 uSnapRes; uniform float uSnapOn;
attribute float aDepth;
varying vec3 vWorld; varying float vDepth; varying vec2 vUv;
void main() {
  vec3 p = position;
  float w = sin(p.x * 0.35 + uTime * 1.1) * 0.06 + cos(p.z * 0.29 + uTime * 0.9) * 0.06;
  p.y += w * smoothstep(0.0, 1.5, aDepth);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz; vDepth = aDepth; vUv = wp.xz * 0.06;
  vec4 clip = projectionMatrix * viewMatrix * wp;
  if (uSnapOn > 0.5 && clip.w > 0.0) { vec2 n = clip.xy / clip.w; n = floor(n * uSnapRes + 0.5) / uSnapRes; clip.xy = n * clip.w; }
  gl_Position = clip;
}`;
const waterFrag = /* glsl */`
uniform sampler2D map; uniform float uTime; uniform vec3 uSunDir, uSunColor, uSkyAmb, uFogColor; uniform float uFogDensity, uFogHeightFalloff, uFogBase;
varying vec3 vWorld; varying float vDepth; varying vec2 vUv;
void main() {
  vec3 t1 = texture2D(map, vUv + vec2(uTime * 0.012, uTime * 0.007)).rgb;
  vec3 t2 = texture2D(map, vUv * 1.7 - vec2(uTime * 0.009, -uTime * 0.011)).rgb;
  vec3 tex = (t1 + t2) * 0.5;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vec3((t1.r - t2.r) * 0.6, 1.0, (t1.g - t2.g) * 0.6));
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.8 + 0.08;
  vec3 deep = vec3(0.02, 0.07, 0.1), shallow = vec3(0.12, 0.3, 0.32);
  vec3 body = mix(shallow, deep, smoothstep(0.0, 4.0, vDepth)) * (uSkyAmb * 1.4 + uSunColor * 0.35) + tex * 0.06;
  vec3 refl = uFogColor * 1.1;
  vec3 col = mix(body, refl, fres);
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 120.0) * 3.0;
  float foam = smoothstep(0.55, 0.0, vDepth) * (0.55 + 0.45 * sin(vDepth * 18.0 - uTime * 2.4));
  col = mix(col, vec3(0.85, 0.9, 0.95) * (uSkyAmb + uSunColor * 0.6), clamp(foam, 0.0, 1.0) * 0.7);
  vec3 rd = vWorld - cameraPosition; float t = length(rd); rd /= t;
  float b = uFogHeightFalloff; float ry = abs(rd.y) < 1e-3 ? 1e-3 : rd.y;
  float fog = clamp((uFogDensity / b) * exp(-(cameraPosition.y - uFogBase) * b) * (1.0 - exp(-t * ry * b)) / ry, 0.0, 1.0);
  col = mix(col, uFogColor, fog);
  float a = clamp(0.55 + smoothstep(0.0, 2.5, vDepth) * 0.4 + fres * 0.2, 0.0, 0.97);
  gl_FragColor = vec4(col, a);
}`;

export function buildWater(terrain, textures) {
  const L = terrain.layout.lake;
  const size = L.r * 3.2, seg = 48;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  g.translate(L.x, WATER_LEVEL, L.z);
  const pos = g.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = WATER_LEVEL - terrain.heightAt(pos.getX(i), pos.getZ(i));
  g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: textures.water }, uTime: G.uTime, uSunDir: G.uSunDir, uSunColor: G.uSunColor, uSkyAmb: G.uSkyAmb, uFogColor: G.uFogColor,
      uFogDensity: G.uFogDensity, uFogHeightFalloff: G.uFogHeightFalloff, uFogBase: G.uFogBase, uSnapRes: G.uSnapRes, uSnapOn: G.uSnapOn },
    vertexShader: waterVert, fragmentShader: waterFrag, transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 5;
  return m;
}
