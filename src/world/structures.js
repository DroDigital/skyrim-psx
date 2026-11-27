// Procedurally modelled architecture & props for the vale: Nordic longhouses, a smithy,
// palisades, bandit tents, the barrow and its standing stones, ruins and shrines.
// Each maker returns a "piece": geometry in local space + colliders / lights / emitters that
// the world placer transforms into world space.
import * as THREE from 'three';
import { Builder, boxGeo, roofGeo, cylGeo, rockGeo } from './builder.js';
import { psxMaterial } from '../render/psxMaterial.js';

export function makeMaterials(T) {
  const M = {
    planks: psxMaterial({ map: T.planks, vertexColors: true }),
    logs: psxMaterial({ map: T.logs, vertexColors: true }),
    thatch: psxMaterial({ map: T.thatch, vertexColors: true, side: THREE.DoubleSide }),
    shingles: psxMaterial({ map: T.shingles, vertexColors: true, side: THREE.DoubleSide }),
    stone: psxMaterial({ map: T.stone, vertexColors: true }),
    rock: psxMaterial({ map: T.rock, vertexColors: true }),
    daub: psxMaterial({ map: T.daub, vertexColors: true }),
    cloth: psxMaterial({ map: T.cloth, vertexColors: true, side: THREE.DoubleSide }),
    canvas: psxMaterial({ map: T.canvas, vertexColors: true, side: THREE.DoubleSide }),
    metal: psxMaterial({ map: T.metal, vertexColors: true }),
    bark: psxMaterial({ map: T.bark, vertexColors: true }),
    rune: psxMaterial({ map: T.rune, vertexColors: true, emissive: 0x3fb8ff, emissiveMask: true }),
    runeRed: psxMaterial({ map: T.rune, vertexColors: true, emissive: 0xff5a2a, emissiveMask: true }),
    chest: psxMaterial({ map: T.chest, vertexColors: true }),
    hay: psxMaterial({ map: T.hay, vertexColors: true }),
    fur: psxMaterial({ map: T.fur, vertexColors: true }),
    coals: psxMaterial({ map: T.rock, vertexColors: true, emissive: 0xff5a14 }),
    spirit: psxMaterial({ map: T.rock, vertexColors: true, emissive: 0x4fc8ff }),
    gold: psxMaterial({ map: T.metal, vertexColors: true, tint: 0xd8a84a, emissive: 0x2a1a00 }),
  };
  return M;
}

const piece = () => ({ b: new Builder(), colliders: [], lights: [], fires: [], smoke: [], wisps: [], interact: [] });

export function longhouse(rng, { w = 7, len = 11, big = false } = {}) {
  const P = piece(), b = P.b;
  const wallH = big ? 3.4 : 2.8, roofH = big ? 4.4 : 3.6;
  b.box('stone', w + 0.4, 0.7, len + 0.4, { y: -0.3, color: 0x9a948a });
  b.box('logs', w, wallH, len, { y: 0.4, color: 0xd8c8b0, ao: 0.4 });
  // corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('logs', 0.5, wallH + 0.3, 0.5, { x: sx * w / 2, z: sz * len / 2, y: 0.3, color: 0x9a8070 });
  // roof
  const roofKey = rng.chance(0.5) ? 'thatch' : 'shingles';
  b.add(roofKey, roofGeo(w, roofH, len, 0.7), { y: wallH + 0.4, color: 0xffffff, ao: 0.6 });
  // ridge beam + crossed gable beams (the Nordic "horns")
  b.box('logs', 0.35, 0.35, len + 1.6, { y: wallH + 0.4 + roofH - 0.1, color: 0x8a7060 });
  for (const sz of [-1, 1]) {
    const z = sz * (len / 2 + 0.85);
    b.add('logs', boxGeo(0.28, 2.6, 0.28), { x: -0.55, y: wallH + 0.4 + roofH + 0.25, z, rz: 0.75, color: 0x8a7060 });
    b.add('logs', boxGeo(0.28, 2.6, 0.28), { x: 0.55, y: wallH + 0.4 + roofH + 0.25, z, rz: -0.75, color: 0x8a7060 });
  }
  // door + frame on the +z gable
  b.box('planks', 1.4, 2.1, 0.15, { z: len / 2 + 0.05, y: 0.4, color: 0x6a5040 });
  b.box('logs', 1.9, 0.3, 0.3, { z: len / 2 + 0.1, y: 2.5, color: 0x8a7060 });
  // shuttered windows
  for (const sx of [-1, 1]) b.box('planks', 0.12, 0.8, 1.1, { x: sx * (w / 2 + 0.05), y: 1.5, z: rng.float(-2, 2), color: 0x504030 });
  // chimney
  const cx = rng.float(-1, 1), cz = -len / 4;
  b.box('stone', 0.9, wallH + roofH + 0.9, 0.9, { x: cx, z: cz, y: 0.2, color: 0xb0aaa0 });
  P.smoke.push({ x: cx, y: wallH + roofH + 1.3, z: cz });
  // door torch
  b.box('logs', 0.12, 0.6, 0.12, { x: 1.2, z: len / 2 + 0.3, y: 1.8, rx: 0.4, color: 0x5a4030 });
  P.fires.push({ x: 1.2, y: 2.45, z: len / 2 + 0.52, s: 0.35 });
  P.lights.push({ x: 1.2, y: 2.6, z: len / 2 + 0.9, color: [2.2, 1.1, 0.4], radius: 9, flicker: 1 });
  P.colliders.push({ t: 'box', x: 0, z: 0, hw: w / 2 + 0.2, hd: len / 2 + 0.2, h: 6 });
  P.door = { x: 0, z: len / 2 + 1.5 };
  return P;
}

export function smithy(rng) {
  const P = piece(), b = P.b;
  b.box('stone', 7, 0.3, 6, { y: -0.2, color: 0x8a847a });
  for (const [x, z] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]]) b.box('logs', 0.4, 3.2, 0.4, { x, z, color: 0x8a7060 });
  b.add('shingles', roofGeo(6.4, 2.2, 5.6, 0.6), { y: 3.2, ry: Math.PI / 2 });
  b.box('logs', 6.6, 2.2, 0.3, { z: -2.8, color: 0xa08a70 }); // back wall
  // forge
  b.box('stone', 2.2, 1.1, 1.6, { x: -1.6, z: -1.6, color: 0xa09890 });
  b.add('coals', rockGeo(0.55, 0, 7, 0.4), { x: -1.6, y: 1.15, z: -1.6, color: 0xffffff, ao: 0 });
  b.box('stone', 0.9, 3.5, 0.9, { x: -1.6, z: -2.2, y: 1.1, color: 0x8a847a });
  P.fires.push({ x: -1.6, y: 1.3, z: -1.6, s: 0.5 });
  P.lights.push({ x: -1.6, y: 2, z: -0.8, color: [3.2, 1.3, 0.35], radius: 11, flicker: 1 });
  P.smoke.push({ x: -1.6, y: 4.8, z: -2.2 });
  // anvil
  b.box('logs', 0.6, 0.6, 0.6, { x: 1, z: 0, color: 0x6a5040 });
  b.box('metal', 0.9, 0.35, 0.4, { x: 1, z: 0, y: 0.6, color: 0x707880 });
  b.box('metal', 0.3, 0.2, 0.3, { x: 1.55, z: 0, y: 0.75, color: 0x707880 });
  // weapon rack
  b.box('logs', 2, 0.15, 0.15, { x: 1.5, z: -2.4, y: 1.6, color: 0x6a5040 });
  for (let i = 0; i < 4; i++) b.box('metal', 0.08, 1.4, 0.2, { x: 0.8 + i * 0.45, z: -2.3, y: 0.3, rz: 0.05, color: 0xc0c8d0 });
  P.colliders.push({ t: 'box', x: 0, z: -2.8, hw: 3.3, hd: 0.3, h: 4 });
  P.colliders.push({ t: 'box', x: -1.6, z: -1.6, hw: 1.1, hd: 0.8, h: 2 });
  P.colliders.push({ t: 'circle', x: 1, z: 0, r: 0.5, h: 1 });
  return P;
}

export function bonfire() {
  const P = piece(), b = P.b;
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; b.add('rock', rockGeo(0.35, 0, i + 3), { x: Math.cos(a) * 1.3, z: Math.sin(a) * 1.3, y: 0.1, color: 0x9a948a }); }
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; b.add('logs', cylGeo(0.13, 0.15, 1.8, 5), { x: Math.cos(a) * 0.35, z: Math.sin(a) * 0.35, y: 0.5, rx: Math.sin(a) * 0.9, rz: -Math.cos(a) * 0.9, color: 0x6a5040 }); }
  b.add('coals', rockGeo(0.6, 0, 3, 0.3), { y: 0.05, ao: 0 });
  P.fires.push({ x: 0, y: 0.35, z: 0, s: 1.6 });
  P.lights.push({ x: 0, y: 1.6, z: 0, color: [4.5, 2.0, 0.6], radius: 16, flicker: 1.3 });
  P.colliders.push({ t: 'circle', x: 0, z: 0, r: 1.4, h: 1 });
  return P;
}

export function campfire() {
  const P = piece(), b = P.b;
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; b.add('rock', rockGeo(0.22, 0, i + 11), { x: Math.cos(a) * 0.75, z: Math.sin(a) * 0.75, y: 0.05, color: 0x8a847a }); }
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; b.add('logs', cylGeo(0.08, 0.1, 1.1, 5), { x: Math.cos(a) * 0.2, z: Math.sin(a) * 0.2, y: 0.3, rx: Math.sin(a) * 0.9, rz: -Math.cos(a) * 0.9, color: 0x5a4030 }); }
  P.fires.push({ x: 0, y: 0.2, z: 0, s: 0.9 });
  P.lights.push({ x: 0, y: 1.2, z: 0, color: [3.4, 1.5, 0.45], radius: 12, flicker: 1.2 });
  P.colliders.push({ t: 'circle', x: 0, z: 0, r: 0.8, h: 1 });
  // log seats
  for (const a of [0.4, 2.5, 4.4]) b.add('logs', cylGeo(0.22, 0.22, 1.8, 6), { x: Math.cos(a) * 2.2, z: Math.sin(a) * 2.2, y: 0.2, rz: Math.PI / 2, ry: -a + Math.PI / 2, color: 0x7a6050 });
  return P;
}

export function tent(rng, { big = false } = {}) {
  const P = piece(), b = P.b;
  const w = big ? 4.2 : 3, h = big ? 2.8 : 2.1, len = big ? 5 : 3.6;
  b.add('canvas', roofGeo(w, h, len, 0.05), { color: big ? 0xa04030 : 0xd0c0a0, ao: 0.5 });
  b.box('logs', 0.12, h + 0.3, 0.12, { z: len / 2 + 0.05, color: 0x6a5040 });
  b.box('logs', 0.12, h + 0.3, 0.12, { z: -len / 2 - 0.05, color: 0x6a5040 });
  b.box('fur', w * 0.7, 0.08, len * 0.8, { y: 0.02, color: 0xa09080 });
  P.colliders.push({ t: 'box', x: 0, z: 0, hw: w / 2, hd: len / 2, h: 3 });
  if (big) {
    b.box('logs', 0.1, 4.2, 0.1, { x: w / 2 + 0.6, z: len / 2, color: 0x5a4030 });
    b.add('cloth', boxGeo(0.02, 1.4, 0.9), { x: w / 2 + 0.6, y: 3.3, z: len / 2 + 0.5, color: 0x8a1a12 });
  }
  return P;
}

export function crate(rng, size = 0.9) {
  const P = piece();
  P.b.box('planks', size, size, size, { ry: rng.float(0, 1), color: 0xb09070, ts: 1 });
  P.colliders.push({ t: 'circle', x: 0, z: 0, r: size * 0.65, h: size });
  return P;
}
export function barrel(rng) {
  const P = piece();
  P.b.add('planks', cylGeo(0.42, 0.38, 1.1, 8, 1), { y: 0.55, color: 0xb08a60 });
  P.b.add('metal', cylGeo(0.44, 0.44, 0.08, 8), { y: 0.25, color: 0x606060 });
  P.b.add('metal', cylGeo(0.44, 0.44, 0.08, 8), { y: 0.85, color: 0x606060 });
  P.colliders.push({ t: 'circle', x: 0, z: 0, r: 0.45, h: 1.1 });
  return P;
}

export function stall(rng) {
  const P = piece(), b = P.b;
  for (const [x, z] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) b.box('logs', 0.18, 2.4, 0.18, { x, z, color: 0x7a6050 });
  b.box('planks', 3.2, 0.12, 1.4, { y: 1, z: 0.3, color: 0xa08060 });
  b.add('cloth', roofGeo(2.4, 0.8, 3.2, 0.2), { y: 2.4, ry: Math.PI / 2, color: [0x9a3a2a, 0x2a5a8a, 0x4a7a3a][rng.int(0, 2)] });
  for (let i = 0; i < 5; i++) b.add('hay', rockGeo(0.14, 0, i + 30), { x: -1.2 + i * 0.6, y: 1.16, z: 0.3, color: [0xd04a30, 0xe0b040, 0x70a040][i % 3] });
  P.colliders.push({ t: 'box', x: 0, z: 0.3, hw: 1.6, hd: 0.7, h: 1.2 });
  return P;
}

export function watchtower() {
  const P = piece(), b = P.b;
  for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.box('logs', 0.35, 7, 0.35, { x, z, color: 0x8a7060 });
  b.box('planks', 3.6, 0.25, 3.6, { y: 5.5, color: 0xa08060 });
  for (const s of [-1, 1]) { b.box('planks', 3.6, 1, 0.12, { y: 5.75, z: s * 1.8, color: 0x907050 }); b.box('planks', 0.12, 1, 3.6, { y: 5.75, x: s * 1.8, color: 0x907050 }); }
  b.add('shingles', roofGeo(3.8, 1.6, 3.8, 0.3), { y: 7 });
  b.add('logs', boxGeo(0.12, 6, 0.12), { x: 0.6, y: 2.75, z: 2.2, rx: -0.35, color: 0x7a6050 });
  b.add('logs', boxGeo(0.12, 6, 0.12), { x: -0.6, y: 2.75, z: 2.2, rx: -0.35, color: 0x7a6050 });
  P.fires.push({ x: 1.6, y: 6.6, z: 1.6, s: 0.4 });
  P.lights.push({ x: 1.6, y: 6.8, z: 1.6, color: [2.5, 1.2, 0.4], radius: 12, flicker: 1 });
  P.colliders.push({ t: 'box', x: 0, z: 0, hw: 1.5, hd: 1.5, h: 7 });
  return P;
}

export function standingStone(rng, { rune = true, h = 3.4, red = false } = {}) {
  const P = piece(), b = P.b;
  const g = boxGeo(1.0, h, 0.55, 1.6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0) p.setX(i, p.getX(i) * 0.7); }
  b.add(rune ? (red ? 'runeRed' : 'rune') : 'rock', g, { y: h / 2 - 0.2, rz: rng.float(-0.08, 0.08), rx: rng.float(-0.05, 0.05), color: 0xc0c0c8 });
  P.colliders.push({ t: 'circle', x: 0, z: 0, r: 0.65, h });
  return P;
}

export function barrowEntrance(rng) {
  const P = piece(), b = P.b;
  // mound face: big stacked rocks with a lintel doorway
  b.box('stone', 1.4, 4.2, 1.4, { x: -2.2, color: 0x8a8680 });
  b.box('stone', 1.4, 4.2, 1.4, { x: 2.2, color: 0x8a8680 });
  b.box('rune', 6.2, 1.1, 1.8, { y: 4.1, color: 0xb0b0b8 });
  b.box('planks', 3, 3.9, 0.3, { z: -0.4, color: 0x3a3028 }); // sealed door
  b.box('metal', 3.1, 0.25, 0.35, { z: -0.35, y: 1.2, color: 0x505860 });
  b.box('metal', 3.1, 0.25, 0.35, { z: -0.35, y: 2.8, color: 0x505860 });
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * 0.1 + (i / 13) * Math.PI * 0.8;
    b.add('rock', rockGeo(rng.float(1.6, 2.8), 0, i + 40, 0.8), { x: Math.cos(a) * 5.5, z: -Math.sin(a) * 3.5 - 1.5, y: rng.float(0.5, 2.5), color: 0x9a968e });
  }
  // braziers with spectral flames
  for (const s of [-1, 1]) {
    b.add('metal', cylGeo(0.5, 0.25, 0.6, 7), { x: s * 3.6, y: 1.1, z: 1.6, color: 0x4a4a4a });
    b.add('metal', cylGeo(0.12, 0.2, 0.9, 5), { x: s * 3.6, y: 0.45, z: 1.6, color: 0x4a4a4a });
    P.fires.push({ x: s * 3.6, y: 1.45, z: 1.6, s: 0.6, spirit: true });
    P.lights.push({ x: s * 3.6, y: 2.2, z: 1.6, color: [0.5, 1.6, 3.4], radius: 14, flicker: 0.8 });
  }
  P.colliders.push({ t: 'box', x: 0, z: -1.5, hw: 5.5, hd: 2.4, h: 6 });
  return P;
}

export function ruinWall(rng, len = 8) {
  const P = piece(), b = P.b;
  const segs = Math.ceil(len / 2);
  for (let i = 0; i < segs; i++) {
    const h = rng.float(0.8, 4.2);
    b.box('stone', 2, h, 0.9, { x: -len / 2 + 1 + i * 2, color: 0x9a968e, ao: 0.5 });
    if (rng.chance(0.4)) b.add('rock', rockGeo(0.6, 0, i + 60), { x: -len / 2 + 1 + i * 2 + rng.float(-1, 1), z: rng.float(0.8, 1.8) * (rng.chance(0.5) ? 1 : -1), y: 0.1 });
  }
  P.colliders.push({ t: 'box', x: 0, z: 0, hw: len / 2, hd: 0.5, h: 3 });
  return P;
}

export function ruinTower(rng) {
  const P = piece(), b = P.b;
  const r = 3.2;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const h = i < 6 ? rng.float(5, 11) : rng.float(1, 3);
    b.box('stone', 2.1, h, 1.1, { x: Math.cos(a) * r, z: Math.sin(a) * r, ry: -a + Math.PI / 2, color: 0xa09a90, ao: 0.5 });
    P.colliders.push({ t: 'box', x: Math.cos(a) * r, z: Math.sin(a) * r, hw: 1.05, hd: 0.55, rot: -a + Math.PI / 2, h });
  }
  b.box('stone', 6.4, 0.3, 6.4, { y: -0.1, color: 0x7a766e });
  return P;
}

export function arch(rng) {
  const P = piece(), b = P.b;
  b.box('stone', 1, 5, 1, { x: -2, color: 0xa09a90 });
  b.box('stone', 1, 5, 1, { x: 2, color: 0xa09a90 });
  b.box('rune', 5.2, 0.9, 1.1, { y: 5, color: 0xb8b8c0 });
  P.colliders.push({ t: 'circle', x: -2, z: 0, r: 0.7, h: 5 });
  P.colliders.push({ t: 'circle', x: 2, z: 0, r: 0.7, h: 5 });
  return P;
}

export function shrine(rng) {
  const P = piece(), b = P.b;
  b.add('rock', rockGeo(1.6, 0, 77, 0.35), { y: 0.1, color: 0x8a8680 });
  b.box('stone', 1.6, 0.4, 1.6, { y: 0.3, color: 0x9a968e });
  b.box('rune', 0.9, 2.4, 0.4, { y: 0.7, color: 0xc8c8d0 });
  b.add('spirit', new THREE.OctahedronGeometry(0.28, 0), { y: 3.6, ao: 0 });
  P.wisps.push({ x: 0, y: 2.4, z: 0 });
  P.lights.push({ x: 0, y: 3.5, z: 0.6, color: [0.6, 1.6, 3], radius: 10, flicker: 0.4 });
  P.colliders.push({ t: 'circle', x: 0, z: 0, r: 1.1, h: 3 });
  P.orb = { x: 0, y: 3.6, z: 0 };
  return P;
}

export function chestModel() {
  const b = new Builder();
  b.box('chest', 1.0, 0.55, 0.62, { color: 0xffffff, ao: 0.2, ts: 1 });
  const lid = new Builder();
  lid.add('chest', cylGeo(0.31, 0.31, 1.0, 6, 1), { rz: Math.PI / 2, y: 0, color: 0xddccbb, ao: 0 });
  return { body: b, lid };
}

export function torchPost() {
  const P = piece(), b = P.b;
  b.box('logs', 0.18, 2.2, 0.18, { color: 0x6a5040 });
  b.add('metal', cylGeo(0.16, 0.08, 0.25, 5), { y: 2.25, color: 0x404040 });
  P.fires.push({ x: 0, y: 2.35, z: 0, s: 0.35 });
  P.lights.push({ x: 0, y: 2.6, z: 0, color: [2.4, 1.1, 0.35], radius: 9, flicker: 1 });
  P.colliders.push({ t: 'circle', x: 0, z: 0, r: 0.2, h: 2 });
  return P;
}

export function fence(len = 4) {
  const P = piece(), b = P.b;
  for (let i = 0; i <= len / 2; i++) b.box('logs', 0.16, 1.2, 0.16, { x: -len / 2 + i * 2, color: 0x7a6050 });
  b.box('logs', len, 0.1, 0.1, { y: 0.9, color: 0x8a7060 });
  b.box('logs', len, 0.1, 0.1, { y: 0.5, color: 0x8a7060 });
  P.colliders.push({ t: 'box', x: 0, z: 0, hw: len / 2, hd: 0.15, h: 1.2 });
  return P;
}

export function hayBale() {
  const P = piece();
  P.b.add('hay', cylGeo(0.6, 0.6, 1.2, 8, 1), { rz: Math.PI / 2, y: 0.6, color: 0xffffff });
  P.colliders.push({ t: 'circle', x: 0, z: 0, r: 0.7, h: 1.2 });
  return P;
}

export function denBones(rng) {
  const P = piece(), b = P.b;
  for (let i = 0; i < 4; i++) b.add('rock', rockGeo(rng.float(1.2, 2.2), 0, i + 90, 0.75), { x: rng.float(-3, 3), z: rng.float(-3, 3), y: 0.4, color: 0x8a8680 });
  for (let i = 0; i < 8; i++) b.add('daub', cylGeo(0.05, 0.05, rng.float(0.5, 0.9), 4), { x: rng.float(-2, 2), z: rng.float(-2, 2), y: 0.05, rz: Math.PI / 2, ry: rng.float(0, 3), color: 0xe0d8c0 });
  return P;
}

export function sarcophagus() {
  const P = piece(), b = P.b;
  b.box('stone', 1.2, 0.9, 2.4, { color: 0x8a8680 });
  b.box('rune', 1.3, 0.25, 2.5, { y: 0.9, color: 0xb0b0b8 });
  P.colliders.push({ t: 'box', x: 0, z: 0, hw: 0.6, hd: 1.2, h: 1.2 });
  return P;
}
