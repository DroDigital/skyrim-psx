// Instanced vegetation: jagged low-poly pines (wind-swayed on the GPU), dead snags,
// boulders, shrubs and ~40k alpha-tested grass tufts that sway and part around the player.
import * as THREE from 'three';
import { Builder, cylGeo, rockGeo } from './builder.js';
import { psxMaterial } from '../render/psxMaterial.js';
import { PLAY_RADIUS, WATER_LEVEL, WORLD_HALF as WORLD_HALF_ } from './terrain.js';
import { smoothstep as smooth } from '../core/rng.js';
import { castShadows } from '../render/pipeline.js';

function pineBuilder(seed, h) {
  const b = new Builder();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  b.add('bark', cylGeo(0.16, 0.32, h * 0.45, 5), { y: h * 0.22, color: 0xffffff, ao: 0.4 });
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const r = (1 - t) * h * 0.27 + 0.5;
    const ch = h * 0.36;
    const g = new THREE.ConeGeometry(r, ch, 7, 1, true);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getY(k) < 0) { p.setX(k, p.getX(k) * (0.85 + rnd() * 0.35)); p.setZ(k, p.getZ(k) * (0.85 + rnd() * 0.35)); p.setY(k, p.getY(k) - rnd() * 0.4); }
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 3, uv.getY(k) * 2);
    b.add('pine', g, { y: h * 0.25 + t * h * 0.58 + ch / 2, ry: rnd() * 6, color: 0xffffff, ao: 0.55 });
  }
  return b.geometries();
}

function deadTreeBuilder(seed, h) {
  const b = new Builder();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  b.add('bark', cylGeo(0.12, 0.3, h, 5), { y: h / 2, color: 0xb0a090, ao: 0.4 });
  for (let i = 0; i < 5; i++) {
    const y = h * (0.4 + rnd() * 0.5), a = rnd() * 6.28, l = 1 + rnd() * 1.5;
    b.add('bark', cylGeo(0.03, 0.08, l, 4), { x: Math.cos(a) * l * 0.4, y: y + l * 0.3, z: Math.sin(a) * l * 0.4, rz: Math.cos(a) * 0.9, rx: -Math.sin(a) * 0.9, color: 0xb0a090, ao: 0 });
  }
  return b.geometries();
}

function grassGeo() {
  const pos = [], uv = [], nor = [], col = [];
  const quad = (a) => {
    const cx = Math.cos(a) * 0.45, cz = Math.sin(a) * 0.45, h = 0.75;
    const v = [[-cx, 0, -cz, 0, 0], [cx, 0, cz, 1, 0], [cx, h, cz, 1, 1], [-cx, 0, -cz, 0, 0], [cx, h, cz, 1, 1], [-cx, h, -cz, 0, 1]];
    for (const q of v) { pos.push(q[0], q[1], q[2]); uv.push(q[3], q[4]); nor.push(0, 1, 0); const c = q[4] ? 1.1 : 0.55; col.push(c, c, c); }
  };
  quad(0); quad(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function buildFoliage(world, T) {
  const { terrain, rng, colliders, layout } = world;
  const r = rng.fork('foliage');
  const group = new THREE.Group();
  const M = {
    bark: psxMaterial({ map: T.bark, vertexColors: true, wind: true }),
    pine: psxMaterial({ map: T.pine, vertexColors: true, wind: true }),
    rock: psxMaterial({ map: T.rock, vertexColors: true }),
    bush: psxMaterial({ map: T.pine, vertexColors: true, wind: true, tint: 0x9aa070 }),
  };

  const blocked = (x, z, pad = 0) => {
    for (const f of layout.flats) if (Math.hypot(x - f.x, z - f.z) < f.r * (f.clear ?? 1.25) + pad) return true;
    return terrain.roadAmount(x, z) > 0.05 || terrain.heightAt(x, z) < WATER_LEVEL + 0.6;
  };

  // ---- trees ----
  const variants = [pineBuilder(11, 9), pineBuilder(23, 12), pineBuilder(37, 15)];
  const dead = deadTreeBuilder(5, 7);
  const placements = variants.map(() => []);
  const deadPl = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const R = PLAY_RADIUS + 70;
  for (let i = 0; i < 9000 && placements.reduce((a, b) => a + b.length, 0) < 1500; i++) {
    const x = r.float(-R, R), z = r.float(-R, R);
    const d = Math.hypot(x, z);
    if (d > R) continue;
    const forest = terrain.n1(x * 0.011, z * 0.011) + (d > PLAY_RADIUS ? 0.35 : 0);
    if (forest < 0.05 && !r.chance(0.04)) continue;
    if (blocked(x, z, 2)) continue;
    const s = terrain.splatAt(x, z);
    if (s.rock > 0.5 && !r.chance(0.15)) continue;
    const y = terrain.heightAt(x, z);
    if (y > 62) continue;
    const scale = r.float(0.7, 1.25);
    if (y > 40 && r.chance(0.35)) { deadPl.push({ x, y, z, scale, rot: r.float(0, 6.28) }); continue; }
    placements[r.int(0, 2)].push({ x, y: y - 0.2, z, scale, rot: r.float(0, 6.28), snow: s.snow });
    if (d < PLAY_RADIUS + 10) colliders.addCircle(x, z, 0.45 * scale, 12, 'tree');
  }
  const col = new THREE.Color();
  const makeInst = (geos, list, isDead) => {
    for (const key of Object.keys(geos)) {
      const mat = key === 'bark' ? M.bark : M.pine;
      const im = new THREE.InstancedMesh(geos[key], mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m4.compose(p3.set(p.x, p.y, p.z), q, sc.set(p.scale, p.scale * (isDead ? 1 : 1.1), p.scale));
        im.setMatrixAt(i, m4);
        const tint = 0.85 + ((i * 7919) % 100) / 100 * 0.3;
        col.setRGB(tint, tint, tint);
        if (key === 'pine' && p.snow > 0.3) col.lerp(new THREE.Color(2.4, 2.5, 2.7), Math.min(0.7, p.snow));
        im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      castShadows(im);
      group.add(im);
    }
  };
  variants.forEach((v, i) => makeInst(v, placements[i]));
  makeInst(dead, deadPl, true);

  // ---- rocks ----
  const rockGeos = [rockGeo(1, 1, 3, 0.7), rockGeo(1, 0, 8, 0.9), rockGeo(1, 1, 21, 0.55)].map((g) => {
    const b = new Builder(); b.add('rock', g, { color: 0xffffff, ao: 0.45 }); return b.geometries().rock;
  });
  const rockLists = [[], [], []];
  for (let i = 0; i < 2600 && rockLists.flat().length < 520; i++) {
    const x = r.float(-R, R), z = r.float(-R, R), d = Math.hypot(x, z);
    if (d > R || blocked(x, z, 1)) continue;
    const s = terrain.splatAt(x, z);
    if (!(s.rock > 0.3 || r.chance(0.18))) continue;
    const scale = r.chance(0.12) ? r.float(2.5, 5) : r.float(0.4, 1.6);
    const y = terrain.heightAt(x, z);
    rockLists[r.int(0, 2)].push({ x, y: y - scale * 0.25, z, scale, rot: r.float(0, 6.28) });
    if (scale > 0.9 && d < PLAY_RADIUS + 10) colliders.addCircle(x, z, scale * 0.85, scale * 1.2, 'rock');
  }
  rockLists.forEach((list, k) => {
    const im = new THREE.InstancedMesh(rockGeos[k], M.rock, list.length);
    list.forEach((p, i) => {
      q.setFromEuler(new THREE.Euler(r.float(-0.3, 0.3), p.rot, r.float(-0.3, 0.3)));
      m4.compose(p3.set(p.x, p.y, p.z), q, sc.set(p.scale, p.scale * r.float(0.7, 1.2), p.scale));
      im.setMatrixAt(i, m4);
      const t = r.float(0.75, 1.05); im.setColorAt(i, col.setRGB(t, t * 0.98, t * 0.95));
    });
    im.computeBoundingSphere();
    castShadows(im);
    group.add(im);
  });

  // ---- shrubs ----
  const bushGeo = (() => { const b = new Builder(); b.add('bush', rockGeo(0.8, 0, 51, 0.7), { color: 0xffffff, ao: 0.5 }); return b.geometries().bush; })();
  const bushes = [];
  for (let i = 0; i < 2500 && bushes.length < 450; i++) {
    const x = r.float(-PLAY_RADIUS, PLAY_RADIUS), z = r.float(-PLAY_RADIUS, PLAY_RADIUS);
    if (blocked(x, z, 0.5)) continue;
    const s = terrain.splatAt(x, z); if (s.grass < 0.5) continue;
    bushes.push({ x, y: terrain.heightAt(x, z) + 0.15, z, s: r.float(0.5, 1.2) });
  }
  const bim = new THREE.InstancedMesh(bushGeo, M.bush, bushes.length);
  bushes.forEach((p, i) => { m4.compose(p3.set(p.x, p.y, p.z), q.setFromAxisAngle(up, i), sc.setScalar(p.s)); bim.setMatrixAt(i, m4); bim.setColorAt(i, col.setRGB(0.8 + (i % 5) * 0.08, 0.9, 0.8)); });
  bim.computeBoundingSphere();
  castShadows(bim);
  group.add(bim);

  // ---- grass (GPU-driven, follows the camera) ----
  const N = terrain.N, W = N + 1;
  const hdata = new Float32Array(W * W * 4);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * W + i;
    const x = -WORLD_HALF_ + i * terrain.cell, z = -WORLD_HALF_ + j * terrain.cell;
    const y = terrain.heights[k];
    let m = smooth(0.45, 0.8, terrain.splatCache[k * 4]);
    if (y < WATER_LEVEL + 0.4 || Math.hypot(x, z) > PLAY_RADIUS + 20) m = 0;
    m *= 1 - terrain.roadAmount(x, z);
    for (const f of layout.flats) if (f.nograss) m *= smooth(f.r * 0.75, f.r * 1.05, Math.hypot(x - f.x, z - f.z));
    hdata[k * 4] = y; hdata[k * 4 + 1] = m;
  }
  const htex = new THREE.DataTexture(hdata, W, W, THREE.RGBAFormat, THREE.FloatType);
  htex.minFilter = htex.magFilter = THREE.NearestFilter;
  htex.needsUpdate = true;
  const grid = 140, spacing = 0.55;
  const ggeo = new THREE.InstancedBufferGeometry().copy(grassGeo());
  ggeo.instanceCount = grid * grid;
  const gmat = psxMaterial({
    map: T.grassBlade, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide,
    grass: { uHeightTex: { value: htex }, uHeightInfo: { value: new THREE.Vector4(-WORLD_HALF_, -WORLD_HALF_, terrain.cell, W) },
      uGrassCenter: { value: new THREE.Vector2() }, uGrassSpacing: { value: spacing }, uGrassGrid: { value: grid } },
  });
  const gmesh = new THREE.Mesh(ggeo, gmat);
  gmesh.frustumCulled = false;
  group.add(gmesh);
  world.grass = { mat: gmat, spacing };
  world.stats.grass = grid * grid;
  world.stats.trees = placements.reduce((a, b) => a + b.length, 0) + deadPl.length;
  return group;
}
