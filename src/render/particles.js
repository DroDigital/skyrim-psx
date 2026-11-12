// Particles.
//  * ParticleSystem: pooled CPU-simulated billboards (fire, embers, sparks, blood, smoke, magic)
//    rendered as point sprites — square "PS1 pixels" or soft discs depending on the mix.
//  * WeatherSnow: 7k flakes animated entirely on the GPU, wrapped in a box around the camera.
import * as THREE from 'three';
import { G } from './psxMaterial.js';

const vert = /* glsl */`
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 96.0);
}`;
const frag = /* glsl */`
uniform float uSoft;
uniform vec3 uFogColor;
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = vColor.a;
  if (uSoft > 0.5) { a *= smoothstep(0.5, 0.15, length(c)); }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb * (ADDITIVE ? a : 1.0), ADDITIVE ? 1.0 : a);
}`;

export const particleUniforms = { uScale: { value: 300 }, uSoft: { value: 0 } };

class Pool {
  constructor(max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.baseCol = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr); g.setAttribute('aColor', this.colAttr); g.setAttribute('aSize', this.sizeAttr);
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...particleUniforms, uFogColor: G.uFogColor },
      vertexShader: vert,
      fragmentShader: frag.replaceAll('ADDITIVE', additive ? 'true' : 'false'),
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav = 0, drag = 0, grow = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.baseCol[i * 4] = r; this.baseCol[i * 4 + 1] = g; this.baseCol[i * 4 + 2] = b; this.baseCol[i * 4 + 3] = a;
    this.baseSize[i] = size; this.life[i] = 0; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }
  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this._kill(i); continue; }
      const t = this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col[i * 4] = this.baseCol[i * 4]; this.col[i * 4 + 1] = this.baseCol[i * 4 + 1]; this.col[i * 4 + 2] = this.baseCol[i * 4 + 2];
      this.col[i * 4 + 3] = this.baseCol[i * 4 + 3] * fade;
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t);
      i++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = true;
    this.posAttr.clearUpdateRanges(); this.posAttr.addUpdateRange(0, this.count * 3);
    this.colAttr.clearUpdateRanges(); this.colAttr.addUpdateRange(0, this.count * 4);
    this.sizeAttr.clearUpdateRanges(); this.sizeAttr.addUpdateRange(0, this.count);
  }
  _kill(i) {
    const j = --this.count;
    if (i === j) return;
    const c3 = (arr) => { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; };
    const c4 = (arr) => { arr[i * 4] = arr[j * 4]; arr[i * 4 + 1] = arr[j * 4 + 1]; arr[i * 4 + 2] = arr[j * 4 + 2]; arr[i * 4 + 3] = arr[j * 4 + 3]; };
    c3(this.pos); c3(this.vel); c4(this.baseCol); c4(this.col);
    for (const a of [this.size, this.baseSize, this.life, this.maxLife, this.grav, this.drag, this.grow]) a[i] = a[j];
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene) {
    this.add = new Pool(5000, true);
    this.alpha = new Pool(3000, false);
    scene.add(this.add.points, this.alpha.points);
  }
  update(dt) { this.add.update(dt); this.alpha.update(dt); }

  fire(x, y, z, intensity = 1) {
    const n = Math.floor(intensity * 1.6 + Math.random());
    for (let k = 0; k < n; k++) {
      const hot = Math.random();
      const sp = 0.22 * Math.sqrt(intensity);
      this.add.spawn(x + rnd(-sp, sp), y + rnd(0, 0.15), z + rnd(-sp, sp), rnd(-0.15, 0.15), rnd(1.0, 2.0) * (0.7 + intensity * 0.2), rnd(-0.15, 0.15),
        2.0 + hot * 1.4, 0.7 + hot * 0.6, 0.18 + hot * 0.1, 0.9, rnd(0.16, 0.3) * Math.sqrt(intensity), rnd(0.4, 0.75), -0.4, 0.6, -0.75);
    }
    if (Math.random() < 0.08 * intensity) // ember
      this.add.spawn(x, y + 0.3, z, rnd(-0.6, 0.6), rnd(2, 4), rnd(-0.6, 0.6), 3, 1.2, 0.3, 1, 0.08, rnd(1.2, 2.2), 0.4, 0.3);
    if (Math.random() < 0.12 * intensity) // smoke
      this.alpha.spawn(x + rnd(-0.2, 0.2), y + 1.2, z + rnd(-0.2, 0.2), rnd(-0.1, 0.3), rnd(0.8, 1.4), rnd(-0.1, 0.3), 0.18, 0.17, 0.16, 0.35, rnd(0.8, 1.2), rnd(3, 5), -0.05, 0.1, 2.5);
  }
  chimney(x, y, z) {
    if (Math.random() < 0.15) this.alpha.spawn(x, y, z, rnd(0.1, 0.4), rnd(0.8, 1.2), rnd(-0.1, 0.2), 0.3, 0.3, 0.3, 0.3, rnd(1, 1.5), rnd(4, 7), -0.03, 0.05, 3);
  }
  blood(x, y, z, dir, n = 14) {
    for (let i = 0; i < n; i++)
      this.alpha.spawn(x, y, z, dir.x * rnd(1, 4) + rnd(-1.5, 1.5), rnd(0.5, 3.5), dir.z * rnd(1, 4) + rnd(-1.5, 1.5), 0.45, 0.02, 0.02, 1, rnd(0.07, 0.14), rnd(0.4, 0.8), 12, 0.5);
  }
  sparks(x, y, z, n = 12, col = [3, 2, 1]) {
    for (let i = 0; i < n; i++)
      this.add.spawn(x, y, z, rnd(-4, 4), rnd(0, 5), rnd(-4, 4), col[0], col[1], col[2], 1, rnd(0.05, 0.1), rnd(0.2, 0.5), 9, 1);
  }
  bones(x, y, z, n = 14) {
    for (let i = 0; i < n; i++)
      this.alpha.spawn(x, y, z, rnd(-2, 2), rnd(1, 4), rnd(-2, 2), 0.6, 0.58, 0.5, 1, rnd(0.08, 0.16), rnd(0.5, 1), 10, 0.4);
  }
  frost(x, y, z, n = 10) {
    for (let i = 0; i < n; i++)
      this.add.spawn(x + rnd(-0.4, 0.4), y + rnd(-0.4, 0.4), z + rnd(-0.4, 0.4), rnd(-1, 1), rnd(-0.5, 1.2), rnd(-1, 1), 0.6, 1.2, 2.2, 0.8, rnd(0.08, 0.2), rnd(0.4, 1), 0.5, 1);
  }
  explosion(x, y, z, scale = 1) {
    for (let i = 0; i < 70 * scale; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2, s = rnd(2, 9) * scale;
      this.add.spawn(x, y, z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + 2, Math.sin(a) * Math.cos(b) * s, 3.5, 1.4, 0.35, 1, rnd(0.25, 0.6) * scale, rnd(0.3, 0.8), 3, 2.5, -0.5);
    }
    for (let i = 0; i < 20 * scale; i++)
      this.alpha.spawn(x, y, z, rnd(-2, 2), rnd(0.5, 3), rnd(-2, 2), 0.12, 0.1, 0.09, 0.6, rnd(0.8, 1.6) * scale, rnd(1.2, 2.5), -0.3, 1.5, 2);
  }
  magicTrail(x, y, z, col = [3, 1.4, 0.4]) {
    for (let i = 0; i < 3; i++)
      this.add.spawn(x + rnd(-0.1, 0.1), y + rnd(-0.1, 0.1), z + rnd(-0.1, 0.1), rnd(-0.4, 0.4), rnd(-0.2, 0.6), rnd(-0.4, 0.4), col[0], col[1], col[2], 1, rnd(0.15, 0.3), rnd(0.2, 0.45), 0, 1, -0.6);
  }
  dust(x, y, z, n = 8) {
    for (let i = 0; i < n; i++)
      this.alpha.spawn(x + rnd(-0.3, 0.3), y + 0.1, z + rnd(-0.3, 0.3), rnd(-1.2, 1.2), rnd(0.2, 1), rnd(-1.2, 1.2), 0.5, 0.47, 0.42, 0.4, rnd(0.3, 0.6), rnd(0.6, 1.2), 0.3, 2, 1.5);
  }
  wisp(x, y, z) {
    this.add.spawn(x + rnd(-0.5, 0.5), y + rnd(0, 1.5), z + rnd(-0.5, 0.5), rnd(-0.2, 0.2), rnd(0.2, 0.6), rnd(-0.2, 0.2), 0.4, 1.0, 1.8, 0.8, rnd(0.08, 0.16), rnd(1, 2), -0.1, 0.2);
  }
  heal(x, y, z) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add.spawn(x + Math.cos(a) * 0.6, y + rnd(0, 1.8), z + Math.sin(a) * 0.6, 0, rnd(0.6, 1.5), 0, 0.5, 2.2, 0.6, 1, rnd(0.08, 0.15), rnd(0.6, 1.2), -0.3, 0.5);
    }
  }
  ring(x, y, z, radius, col, n = 60) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.add.spawn(x + Math.cos(a) * 0.5, y, z + Math.sin(a) * 0.5, Math.cos(a) * radius * 2.5, rnd(0.2, 1.2), Math.sin(a) * radius * 2.5, col[0], col[1], col[2], 1, rnd(0.2, 0.4), rnd(0.35, 0.55), 0, 3);
    }
  }
}

// ---------- GPU weather ----------
const snowVert = /* glsl */`
uniform float uTime;
uniform float uAmount;
uniform float uScale;
uniform vec3 uCam;
uniform float uWind;
attribute float aRand;
varying float vA;
void main() {
  vec3 box = vec3(70.0, 40.0, 70.0);
  vec3 p = position * box;
  p.y -= uTime * (1.6 + aRand * 1.2);
  p.x += uTime * 0.9 * uWind + sin(uTime * 1.3 + aRand * 40.0) * 0.6;
  p.z += uTime * 0.35 * uWind + cos(uTime * 1.1 + aRand * 31.0) * 0.6;
  p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.05 + aRand * 0.04) * uScale / -mv.z, 1.0, 2.5 * uScale / 135.0);
  vA = step(aRand, uAmount) * smoothstep(60.0, 20.0, -mv.z);
}`;
const snowFrag = /* glsl */`
varying float vA;
uniform float uSoft;
void main() {
  float a = vA;
  if (uSoft > 0.5) a *= smoothstep(0.5, 0.2, length(gl_PointCoord - 0.5));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * 1.3, a * 0.9);
}`;

export class WeatherSnow {
  constructor(scene, count = 7000) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), r = new Float32Array(count);
    for (let i = 0; i < count; i++) { p[i * 3] = Math.random(); p[i * 3 + 1] = Math.random(); p[i * 3 + 2] = Math.random(); r[i] = Math.random(); }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(r, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uAmount: { value: 0 }, uScale: particleUniforms.uScale, uCam: { value: new THREE.Vector3() }, uWind: G.uWind, uSoft: particleUniforms.uSoft },
      vertexShader: snowVert, fragmentShader: snowFrag, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    scene.add(this.points);
  }
  update(cam, amount) {
    this.mat.uniforms.uCam.value.copy(cam.position);
    this.mat.uniforms.uAmount.value = amount;
    this.points.visible = amount > 0.01;
  }
}
