// Tiny procedural modelling kit. Shapes are emitted as flat-shaded, non-indexed triangles
// with world-scaled UVs and per-vertex colour (used for baked AO / tinting), then merged per
// material so a whole building is a handful of draw calls — the way PS1 art was batched.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();

function finalize(g, color, shadeBottom = 0) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  // vertex colours are linear multipliers (hex/255), not sRGB-decoded — keeps tints bright
  if (typeof color === 'number') _c.setHex(color, THREE.LinearSRGBColorSpace); else _c.set(color);
  const pos = g.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i)); }
  for (let i = 0; i < n; i++) {
    const t = maxY > minY ? (pos.getY(i) - minY) / (maxY - minY) : 1;
    const ao = 1 - shadeBottom * (1 - t);
    col[i * 3] = _c.r * ao; col[i * 3 + 1] = _c.g * ao; col[i * 3 + 2] = _c.b * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

function xform(g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

export function boxGeo(w, h, d, ts = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // faces: +x,-x,+y,-y,+z,-z (4 verts each) -> scale UVs by real size
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / ts, uv.getY(i) * dims[f][1] / ts);
  }
  return g;
}

// gable roof prism: width along x, length along z, apex height h
export function roofGeo(w, h, len, overhang = 0.4, ts = 2) {
  const hw = w / 2 + overhang, hl = len / 2 + overhang;
  const sl = Math.hypot(hw, h) / ts, L = (len + overhang * 2) / ts;
  const pos = [], uv = [];
  const tri = (a, b, c, ua, ub, uc) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
  // left slope (faces -x,+y)
  tri([-hw, 0, -hl], [0, h, hl], [0, h, -hl], [0, 0], [sl, L], [sl, 0]);
  tri([-hw, 0, -hl], [-hw, 0, hl], [0, h, hl], [0, 0], [0, L], [sl, L]);
  // right slope (faces +x,+y)
  tri([hw, 0, hl], [0, h, -hl], [0, h, hl], [0, L], [sl, 0], [sl, L]);
  tri([hw, 0, hl], [hw, 0, -hl], [0, h, -hl], [0, L], [0, 0], [sl, 0]);
  // gables
  const gw = w / 2, gz = len / 2;
  tri([-gw, 0, gz], [gw, 0, gz], [0, h * (gw / hw), gz], [0, 0], [w / ts, 0], [w / 2 / ts, h / ts]);
  tri([gw, 0, -gz], [-gw, 0, -gz], [0, h * (gw / hw), -gz], [0, 0], [w / ts, 0], [w / 2 / ts, h / ts]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export function cylGeo(rt, rb, h, seg = 6, ts = 2) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * Math.max(rt, rb)) / ts, uv.getY(i) * h / ts);
  return g;
}

export function rockGeo(r, detail = 0, seed = 1, squash = 0.7) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = cache.get(key); if (k === undefined) { k = 0.75 + rnd() * 0.5; cache.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * squash, p.getZ(i) * k);
  }
  // spherical-ish uv from position
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i)) / 2; uv[i * 2 + 1] = p.getY(i) / 2; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Collects shapes per material key and merges them. */
export class Builder {
  constructor() { this.parts = new Map(); }
  add(key, geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, color = 0xffffff, ao = 0.35 } = {}) {
    const g = finalize(xform(geo, x, y, z, rx, ry, rz, sx, sy, sz), color, ao);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }
  box(key, w, h, d, o = {}) { return this.add(key, boxGeo(w, h, d, o.ts), { ...o, y: (o.y ?? 0) + h / 2 }); }
  build(materials) {
    const group = new THREE.Group();
    for (const [key, geos] of this.parts) {
      const g = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(g, materials[key]);
      mesh.name = key;
      group.add(mesh);
    }
    return group;
  }
  // build into a single merged geometry per key, transformed into world space by `matrix`
  geometries() {
    const out = {};
    for (const [key, geos] of this.parts) out[key] = mergeGeometries(geos, false);
    return out;
  }
}

export { xform, finalize };
