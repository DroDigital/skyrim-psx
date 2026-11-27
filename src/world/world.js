// Assembles one seeded region: layout → terrain → water → foliage → settlements & dungeons,
// and owns the dynamic light list, fire/smoke emitters and interactables.
import * as THREE from 'three';
import { Terrain, buildWater, WATER_LEVEL, PLAY_RADIUS } from './terrain.js';
import { Colliders } from './collision.js';
import { buildFoliage } from './foliage.js';
import * as S from './structures.js';
import { G, MAX_POINT_LIGHTS } from '../render/psxMaterial.js';
import { castShadows } from '../render/pipeline.js';

function polar(cx, cz, a, d) { return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d }; }

export function makeLayout(rng) {
  const r = rng.fork('layout');
  const village = { x: r.float(-15, 15), z: r.float(-15, 15) };
  const base = r.float(0, Math.PI * 2);
  const angs = [0, 1, 2, 3, 4].map((i) => base + (i / 5) * Math.PI * 2 + r.float(-0.25, 0.25));
  r.shuffle(angs);
  const lake = { ...polar(village.x, village.z, angs[0], r.float(85, 110)), r: r.float(30, 40) };
  const camp = polar(village.x, village.z, angs[1], r.float(110, 140));
  const barrow = polar(village.x, village.z, angs[2], r.float(145, 170));
  const ruins = polar(village.x, village.z, angs[3], r.float(105, 135));
  const grove = polar(village.x, village.z, angs[4], r.float(80, 120)); // wolf country
  const flats = [
    { ...village, r: 30, dirt: 0.5, nograss: true, clear: 1.15, id: 'village' },
    { ...camp, r: 14, dirt: 0.9, nograss: true, id: 'camp' },
    { ...barrow, r: 15, dirt: 0.4, raise: 2, id: 'barrow' },
    { ...ruins, r: 13, dirt: 0.5, id: 'ruins' },
  ];
  const shrines = [];
  for (let i = 0; i < 4; i++) {
    for (let t = 0; t < 30; t++) {
      const p = polar(village.x, village.z, r.float(0, 6.28), r.float(55, 175));
      if ([lake, camp, barrow, ruins].every((q) => Math.hypot(p.x - q.x, p.z - q.z) > 45) && shrines.every((s) => Math.hypot(p.x - s.x, p.z - s.z) > 50)) {
        shrines.push(p); flats.push({ ...p, r: 3.5, id: 'shrine' }); break;
      }
    }
  }
  const roads = [];
  const road = (a, b) => roads.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  for (const p of [camp, barrow, ruins]) {
    // a dog-leg so roads are not ruler straight
    const mid = { x: (village.x + p.x) / 2 + r.float(-20, 20), z: (village.z + p.z) / 2 + r.float(-20, 20) };
    road(village, mid); road(mid, p);
  }
  road(village, polar(village.x, village.z, angs[0], 60));
  return { village, lake, camp, barrow, ruins, grove, flats, shrines, roads };
}

export class World {
  constructor(rng, T, scene, onProgress = () => {}) {
    this.rng = rng;
    this.T = T;
    this.scene = scene;
    this.stats = {};
    this.colliders = new Colliders();
    this.layout = makeLayout(rng);
    this.lights = [];       // {pos, color, radius, flicker, phase, intensity}
    this.fires = [];        // {x,y,z,s,spirit}
    this.smoke = [];
    this.wisps = [];
    this.interactables = []; // {pos, radius, label, verb, onUse, enabled}
    this.group = new THREE.Group();
    this.dynamic = [];       // per-frame updaters
    this.spawns = { wolves: [], bandits: [], wights: [], sentinels: [], boss: null, npcs: {} };
    this.pois = [];

    onProgress(0.1, 'Raising mountains');
    this.terrain = new Terrain(rng, this.layout);
    const tmesh = this.terrain.buildMesh(T);
    castShadows(tmesh);
    this.group.add(tmesh);
    this.group.add(buildWater(this.terrain, T));
    onProgress(0.35, 'Growing pine forests');
    this.M = S.makeMaterials(T);
    this.group.add(buildFoliage(this, T));
    onProgress(0.6, 'Raising the longhouses');
    this.buildVillage();
    this.buildCamp();
    this.buildBarrow();
    this.buildRuins();
    this.buildShrines();
    this.buildChests();
    this.buildDens();
    scene.add(this.group);
    onProgress(0.8, 'Waking the dead');
  }

  h(x, z) { return this.terrain.heightAt(x, z); }

  place(P, x, z, rot = 0, { y = null, shadow = true, name } = {}) {
    const g = P.b.build(this.M);
    const yy = y ?? this.h(x, z);
    g.position.set(x, yy, z);
    g.rotation.y = rot;
    if (shadow) castShadows(g);
    this.group.add(g);
    const c = Math.cos(rot), s = Math.sin(rot);
    const tw = (lx, lz) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
    for (const col of P.colliders) {
      const p = tw(col.x, col.z);
      if (col.t === 'box') this.colliders.addBox(p.x, p.z, col.hw, col.hd, rot + (col.rot || 0), col.h, name);
      else this.colliders.addCircle(p.x, p.z, col.r, col.h, name);
    }
    for (const l of P.lights) { const p = tw(l.x, l.z); this.addLight(p.x, yy + l.y, p.z, l.color, l.radius, l.flicker); }
    for (const f of P.fires) { const p = tw(f.x, f.z); this.fires.push({ x: p.x, y: yy + f.y, z: p.z, s: f.s, spirit: f.spirit }); }
    for (const f of P.smoke) { const p = tw(f.x, f.z); this.smoke.push({ x: p.x, y: yy + f.y, z: p.z }); }
    for (const f of P.wisps) { const p = tw(f.x, f.z); this.wisps.push({ x: p.x, y: yy + f.y, z: p.z }); }
    const out = { group: g, y: yy, tw };
    if (P.door) out.door = tw(P.door.x, P.door.z);
    if (P.orb) { out.orb = g.children.find((m) => m.name === 'spirit'); }
    return out;
  }

  addLight(x, y, z, color, radius, flicker = 0) {
    const l = { pos: new THREE.Vector3(x, y, z), color: new THREE.Vector3(...color), radius, flicker, phase: Math.random() * 100, intensity: 1 };
    this.lights.push(l);
    return l;
  }

  buildVillage() {
    const r = this.rng.fork('village');
    const V = this.layout.village;
    const vy = this.h(V.x, V.z);
    this.pois.push({ name: 'Hrimvik', x: V.x, z: V.z, icon: '⌂', kind: 'village' });
    this.place(S.bonfire(), V.x, V.z);
    // longhouses in a loose ring facing the fire
    const houses = [];
    const n = 6;
    const roadAngles = this.layout.roads.filter((s) => Math.hypot(s.ax - V.x, s.az - V.z) < 1).map((s) => Math.atan2(s.bz - V.z, s.bx - V.x));
    for (let i = 0; i < n; i++) {
      let a = (i / n) * Math.PI * 2 + 0.3;
      // keep gaps where roads leave the village
      for (const ra of roadAngles) { let d = Math.atan2(Math.sin(a - ra), Math.cos(a - ra)); if (Math.abs(d) < 0.35) a += 0.45 * Math.sign(d || 1); }
      const d = i === 0 ? 17 : r.float(15, 19);
      const x = V.x + Math.cos(a) * d, z = V.z + Math.sin(a) * d;
      const rot = Math.atan2(V.x - x, V.z - z); // door (+z local) faces the fire
      const big = i === 0;
      const P = S.longhouse(r, { w: big ? 9 : r.float(6, 7.5), len: big ? 14 : r.float(9, 12), big });
      const placed = this.place(P, x, z, rot, { y: vy - 0.1, name: 'house' });
      houses.push({ ...placed, x, z, rot, big });
    }
    this.houses = houses;
    // smithy
    const sa = 0.3 + Math.PI / n;
    const sx = V.x + Math.cos(sa) * 9, sz = V.z + Math.sin(sa) * 9;
    this.place(S.smithy(r), sx, sz, Math.atan2(V.x - sx, V.z - sz) + Math.PI, { y: vy - 0.05 });
    this.spawns.npcs.smith = { x: sx + (V.x - sx) * 0.25, z: sz + (V.z - sz) * 0.25 };
    // market stall
    const ma = sa + Math.PI;
    const mx = V.x + Math.cos(ma) * 9, mz = V.z + Math.sin(ma) * 9;
    this.place(S.stall(r), mx, mz, Math.atan2(V.x - mx, V.z - mz), { y: vy - 0.05 });
    this.spawns.npcs.merchant = { x: mx + (V.x - mx) * 0.2, z: mz + (V.z - mz) * 0.2 };
    // elder by the great hall, innkeeper by the fire, hunter at the edge
    const hall = houses[0];
    this.spawns.npcs.elder = { x: hall.door.x, z: hall.door.z };
    this.spawns.npcs.hunter = { x: V.x + Math.cos(ma + 1.2) * 24, z: V.z + Math.sin(ma + 1.2) * 24 };
    this.spawns.npcs.villagers = [0, 1, 2].map((i) => ({ x: V.x + Math.cos(i * 2.1) * 5, z: V.z + Math.sin(i * 2.1) * 5 }));
    // props
    for (let i = 0; i < 14; i++) {
      const a = r.float(0, 6.28), d = r.float(6, 25), x = V.x + Math.cos(a) * d, z = V.z + Math.sin(a) * d;
      if (this.colliders.query(x, z, 2).size) continue;
      const P = r.pick([S.barrel, S.crate, S.hayBale, S.barrel])(r);
      this.place(P, x, z, r.float(0, 6.28), { y: vy - 0.05 });
    }
    // palisade ring with gates at roads, plus torches & a watchtower
    const stakes = [];
    const R = 31;
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * Math.PI * 2;
      let gate = false;
      for (const ra of roadAngles) if (Math.abs(Math.atan2(Math.sin(a - ra), Math.cos(a - ra))) < 0.12) gate = true;
      if (gate) continue;
      const x = V.x + Math.cos(a) * R, z = V.z + Math.sin(a) * R;
      stakes.push({ x, z, y: this.h(x, z), h: 3.2 + ((i * 37) % 10) / 10 });
      if (i % 2 === 0) this.colliders.addCircle(x, z, 0.75, 3, 'wall');
    }
    for (const ra of roadAngles) {
      for (const s of [-1, 1]) {
        const a = ra + s * 0.15, x = V.x + Math.cos(a) * R, z = V.z + Math.sin(a) * R;
        this.place(S.torchPost(), x, z);
      }
    }
    const st = new THREE.CylinderGeometry(0.22, 0.28, 1, 5); st.translate(0, 0.5, 0);
    const tip = new THREE.ConeGeometry(0.22, 0.6, 5); tip.translate(0, 1.3, 0);
    const stakeGeo = mergeSimple([st, tip]);
    const im = new THREE.InstancedMesh(stakeGeo, this.M.bark, stakes.length);
    const m4 = new THREE.Matrix4();
    stakes.forEach((s, i) => { m4.makeScale(1, s.h, 1).setPosition(s.x, s.y - 0.3, s.z); im.setMatrixAt(i, m4); });
    im.computeBoundingSphere();
    castShadows(im);
    this.group.add(im);
    if (roadAngles.length) {
      const a = roadAngles[0] + 0.28;
      this.place(S.watchtower(), V.x + Math.cos(a) * (R - 4), V.z + Math.sin(a) * (R - 4), -a);
      this.spawns.npcs.guards = [roadAngles[0], roadAngles[1] ?? roadAngles[0] + Math.PI].map((ra) => ({ x: V.x + Math.cos(ra) * (R - 2), z: V.z + Math.sin(ra) * (R - 2), a: ra }));
    } else this.spawns.npcs.guards = [];
  }

  buildCamp() {
    const r = this.rng.fork('camp');
    const C = this.layout.camp;
    const y = this.h(C.x, C.z);
    this.pois.push({ name: 'Bleakrock Camp', x: C.x, z: C.z, icon: '⚔', kind: 'camp' });
    this.place(S.campfire(), C.x, C.z, 0, { y });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r.float(-0.3, 0.3), d = i === 0 ? 8.5 : r.float(6.5, 9);
      const x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d;
      this.place(S.tent(r, { big: i === 0 }), x, z, Math.atan2(C.x - x, C.z - z), { y: y - 0.05 });
      if (i === 0) this.spawns.chief = { x: C.x + Math.cos(a) * 5, z: C.z + Math.sin(a) * 5 };
    }
    for (let i = 0; i < 8; i++) {
      const a = r.float(0, 6.28), d = r.float(3.5, 12), x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d;
      if (this.colliders.query(x, z, 1.6).size) continue;
      this.place(r.pick([S.crate, S.barrel])(r), x, z, r.float(0, 6), { y: this.h(x, z) });
    }
    for (let i = 0; i < 3; i++) { const a = r.float(0, 6.28); this.place(S.fence(4), C.x + Math.cos(a) * 13, C.z + Math.sin(a) * 13, -a + Math.PI / 2); }
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.6; this.spawns.bandits.push({ x: C.x + Math.cos(a) * 4, z: C.z + Math.sin(a) * 4, archer: i % 3 === 1 }); }
    this.chestSpots = [{ x: C.x + 2, z: C.z - 5.5, tier: 2 }];
  }

  buildBarrow() {
    const r = this.rng.fork('barrow');
    const B = this.layout.barrow;
    const y = this.h(B.x, B.z);
    const V = this.layout.village;
    const face = Math.atan2(V.x - B.x, V.z - B.z);
    this.pois.push({ name: 'Draugmoor Barrow', x: B.x, z: B.z, icon: '☗', kind: 'barrow' });
    const back = { x: B.x - Math.sin(face) * 9, z: B.z - Math.cos(face) * 9 };
    this.place(S.barrowEntrance(r), back.x, back.z, face, { y: this.h(back.x, back.z) });
    // ring of runed standing stones forms the boss arena
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = B.x + Math.cos(a) * 11, z = B.z + Math.sin(a) * 11;
      this.place(S.standingStone(r, { rune: i % 2 === 0, h: r.float(3, 4.5) }), x, z, -a + Math.PI / 2, { y: this.h(x, z) });
    }
    for (let i = 0; i < 3; i++) {
      const a = r.float(0, 6.28), d = r.float(4, 7);
      this.place(S.sarcophagus(), B.x + Math.cos(a) * d, B.z + Math.sin(a) * d, r.float(0, 6), { y: y + 0.0 });
    }
    this.addLight(B.x, y + 3, B.z, [0.3, 0.8, 1.6], 18, 0.3);
    this.spawns.boss = { x: B.x, z: B.z };
    for (let i = 0; i < 6; i++) {
      const a = r.float(0, 6.28), d = r.float(14, 30);
      this.spawns.wights.push({ x: B.x + Math.cos(a) * d, z: B.z + Math.sin(a) * d });
    }
    this.chestSpots.push({ x: back.x + Math.sin(face) * 3.2, z: back.z + Math.cos(face) * 3.2, tier: 4, rot: face });
  }

  buildRuins() {
    const r = this.rng.fork('ruins');
    const R = this.layout.ruins;
    this.pois.push({ name: 'The Old Watch', x: R.x, z: R.z, icon: '♜', kind: 'ruins' });
    this.place(S.ruinTower(r), R.x, R.z, r.float(0, 6));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r.float(-0.3, 0.3), d = r.float(8, 12);
      const x = R.x + Math.cos(a) * d, z = R.z + Math.sin(a) * d;
      this.place(i % 2 ? S.arch(r) : S.ruinWall(r, r.float(6, 10)), x, z, -a + Math.PI / 2);
    }
    this.spawns.sentinels.push({ x: R.x + 6, z: R.z + 2 });
    this.chestSpots.push({ x: R.x, z: R.z, tier: 3 });
  }

  buildShrines() {
    const r = this.rng.fork('shrines');
    this.shrines = [];
    for (const s of this.layout.shrines) {
      const placed = this.place(S.shrine(r), s.x, s.z, r.float(0, 6));
      this.shrines.push({ ...s, y: placed.y, used: false, orb: placed.orb });
      this.pois.push({ name: 'Rune Shrine', x: s.x, z: s.z, icon: 'ᛟ', kind: 'shrine', hidden: true });
    }
  }

  buildChests() {
    const r = this.rng.fork('chests');
    for (let i = 0; i < 7; i++) {
      for (let t = 0; t < 40; t++) {
        const a = r.float(0, 6.28), d = r.float(40, 190);
        const x = this.layout.village.x + Math.cos(a) * d, z = this.layout.village.z + Math.sin(a) * d;
        if (this.h(x, z) < WATER_LEVEL + 0.5 || this.terrain.slopeAt(x, z) > 0.25 || this.colliders.query(x, z, 2).size) continue;
        this.chestSpots.push({ x, z, tier: r.int(0, 2), rot: r.float(0, 6) });
        break;
      }
    }
    this.chestSpots.push({ x: this.layout.village.x + 3, z: this.layout.village.z - 3.5, tier: 0, rot: 0.4 });
    this.chests = this.chestSpots.map((c) => {
      const m = S.chestModel();
      const body = m.body.build(this.M), lid = m.lid.build(this.M);
      const g = new THREE.Group();
      g.add(body);
      const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.55, -0.31); lid.position.set(0, 0, 0.31); lidPivot.add(lid); g.add(lidPivot);
      const y = this.h(c.x, c.z);
      g.position.set(c.x, y, c.z); g.rotation.y = c.rot ?? r.float(0, 6);
      castShadows(g);
      this.group.add(g);
      this.colliders.addCircle(c.x, c.z, 0.55, 0.6, 'chest');
      return { ...c, y, group: g, lid: lidPivot, opened: false, open: 0 };
    });
  }

  buildDens() {
    const r = this.rng.fork('dens');
    const G0 = this.layout.grove;
    const centers = [G0];
    for (let i = 0; i < 2; i++) {
      for (let t = 0; t < 30; t++) {
        const a = r.float(0, 6.28), d = r.float(70, 180);
        const p = { x: this.layout.village.x + Math.cos(a) * d, z: this.layout.village.z + Math.sin(a) * d };
        if (centers.every((c) => Math.hypot(c.x - p.x, c.z - p.z) > 60) && this.h(p.x, p.z) > WATER_LEVEL + 1) { centers.push(p); break; }
      }
    }
    for (const c of centers) {
      this.place(S.denBones(r), c.x, c.z, 0, { shadow: true });
      const n = r.int(2, 4);
      for (let i = 0; i < n; i++) this.spawns.wolves.push({ x: c.x + r.float(-6, 6), z: c.z + r.float(-6, 6), den: c });
    }
  }

  // ---------------- runtime ----------------
  update(dt, t, camPos, particles) {
    if (this.grass) { const sp = this.grass.spacing; this.grass.mat.uniforms.uGrassCenter.value.set(Math.round(camPos.x / sp) * sp, Math.round(camPos.z / sp) * sp); }
    // point lights: flicker, then pick the N most relevant to the camera
    for (const l of this.lights) {
      const f = l.flicker;
      l.intensity = f ? 1 - f * 0.18 * (0.5 + 0.5 * Math.sin(t * 9 + l.phase) * Math.sin(t * 13.7 + l.phase * 2.1)) - f * 0.06 * Math.random() : 1;
      l._d = l.pos.distanceToSquared(camPos) / (l.radius * l.radius);
    }
    const sorted = this.lights.filter((l) => !l.dead).sort((a, b) => a._d - b._d);
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const l = sorted[i];
      if (l && l._d < 16) {
        G.uPointPos.value[i].set(l.pos.x, l.pos.y, l.pos.z, l.radius);
        const fade = Math.min(1, (16 - l._d) / 4);
        G.uPointCol.value[i].copy(l.color).multiplyScalar(l.intensity * fade);
      } else { G.uPointPos.value[i].set(0, -9999, 0, 1); G.uPointCol.value[i].set(0, 0, 0); }
    }
    // emitters near the camera
    for (const f of this.fires) {
      const d2 = (f.x - camPos.x) ** 2 + (f.z - camPos.z) ** 2;
      if (d2 > 110 * 110) continue;
      if (f.spirit) { if (Math.random() < 0.9) particles.add.spawn(f.x + (Math.random() - 0.5) * 0.4, f.y, f.z + (Math.random() - 0.5) * 0.4, 0, 1.6 + Math.random(), 0, 0.4, 1.4, 3.2, 1, 0.4, 0.7, -0.4, 0.5, -0.7); }
      else particles.fire(f.x, f.y, f.z, f.s * 1.4);
    }
    for (const s of this.smoke) if ((s.x - camPos.x) ** 2 + (s.z - camPos.z) ** 2 < 120 * 120) particles.chimney(s.x, s.y, s.z);
    for (const w of this.wisps) if ((w.x - camPos.x) ** 2 + (w.z - camPos.z) ** 2 < 60 * 60 && Math.random() < 0.3) particles.wisp(w.x, w.y, w.z);
    for (const s of this.shrines) if (s.orb) { s.orb.position.y = Math.sin(t * 1.5) * 0.25; s.orb.rotation.y = t; }
    for (const c of this.chests) if (c.opened && c.open < 1) { c.open = Math.min(1, c.open + dt * 2.5); c.lid.rotation.x = -c.open * 1.6; }
  }
}

function mergeSimple(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3).fill(0.9);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export { PLAY_RADIUS, WATER_LEVEL };
