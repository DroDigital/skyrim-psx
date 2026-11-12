// One run of RIMEHOLD: owns the scene, world, actors, projectiles, loot, quests, XP & perks.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { G, psxMaterial } from '../render/psxMaterial.js';
import { createSky, Environment } from '../render/sky.js';
import { Particles, WeatherSnow } from '../render/particles.js';
import { World } from '../world/world.js';
import { WATER_LEVEL } from '../world/terrain.js';
import { Player } from '../entities/player.js';
import { Enemy } from '../entities/enemies.js';
import { spawnVillagers } from '../entities/npcs.js';
import { rollWeapon, rollPerks, PERKS, RARITY, SHRINE_BLESSINGS, SHRINE_CURSES } from './items.js';
import { boxGeo } from '../world/builder.js';

const XP_CURVE = (lvl) => Math.round(60 * Math.pow(lvl, 1.45));

export class Game {
  constructor({ seed, T, hud, onProgress }) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.T = T;
    this.hud = hud;
    this.time = 0;
    this.scene = new THREE.Scene();
    this.sky = createSky();
    this.scene.add(this.sky);
    this.env = new Environment(this.sky);
    this.env.time = 8.5 + this.rng.float(0, 2);
    this.world = new World(this.rng, T, this.scene, onProgress);
    this.particles = new Particles(this.scene);
    this.snow = new WeatherSnow(this.scene);
    this.difficulty = 0;
    this.actors = [];
    this.enemies = [];
    this.npcs = [];
    this.projectiles = [];
    this.pickups = [];
    this.tempLights = [];
    this.rings = [];
    this.stats = { kills: 0, gold: 0, chests: 0, shrines: 0, start: 0, bossesSlain: 0, damage: 0 };
    this.quests = {
      barrow: { id: 'barrow', title: 'The Barrow Wakes', state: 0, step: 'Slay the Barrow Thane at Draugmoor Barrow', turnin: 'Return to Elder Sigrun', target: () => this.world.layout.barrow, giver: 'elder' },
      wolves: { id: 'wolves', title: 'Wolf Trouble', state: 0, count: 0, goal: 5, step: () => `Slay wolves in the pines (${this.quests.wolves.count}/5)`, turnin: 'Return to Old Bjorn', target: () => this.world.layout.grove, giver: 'hunter' },
      bandits: { id: 'bandits', title: 'The Red Toll', state: 0, step: 'Slay Hrolf the Red at Bleakrock Camp', turnin: 'Return to Captain Eirik', target: () => this.world.layout.camp, giver: 'captain' },
      watch: { id: 'watch', title: 'A Heart of Brass', state: 0, step: 'Destroy the Brass Sentinel at the Old Watch', turnin: 'Bring the forge-core to Halvar', target: () => this.world.layout.ruins, giver: 'smith' },
    };
    this.boss = null;
    this.victory = false;

    this.player = new Player(this);
    const V = this.world.layout.village;
    const spawnA = this.rng.float(0, 6.28);
    this.player.spawn(V.x + Math.cos(spawnA) * 9, V.z + Math.sin(spawnA) * 9);
    this.player.yaw = Math.atan2(this.player.pos.x - V.x, this.player.pos.z - V.z);

    onProgress && onProgress(0.9, 'Populating the vale');
    this.npcs = spawnVillagers(this);
    this.actors.push(...this.npcs);
    this.spawnHostiles();
    this.arrowGeo = boxGeo(0.03, 0.03, 0.8, 0.3);
    this.arrowMat = psxMaterial({ map: T.bark, tint: 0xc0a080 });
    this.boltMat = psxMaterial({ map: T.cloth, tint: 0x000000, emissive: 0xff7a20 });
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 3.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.chestLoot = new Map();
  }

  spawnHostiles() {
    const S = this.world.spawns;
    let alphaPlaced = false;
    for (const w of S.wolves) {
      const alpha = !alphaPlaced && w.den === this.world.layout.grove;
      if (alpha) alphaPlaced = true;
      this.spawnEnemy(alpha ? 'alpha' : 'wolf', w.x, w.z, { den: w.den, leash: 50 });
    }
    for (const b of S.bandits) this.spawnEnemy(b.archer ? 'archer' : 'bandit', b.x, b.z, { leash: 45 });
    if (S.chief) this.chief = this.spawnEnemy('chief', S.chief.x, S.chief.z, { leash: 35 });
    // a couple of roaming bandits on the roads
    for (let i = 0; i < 2; i++) {
      const r = this.world.layout.roads[this.rng.int(0, this.world.layout.roads.length - 1)];
      const t = this.rng.float(0.4, 0.9);
      this.spawnEnemy('bandit', r.ax + (r.bx - r.ax) * t, r.az + (r.bz - r.az) * t, { leash: 40 });
    }
    for (const w of S.wights) this.spawnEnemy('wight', w.x, w.z, { dormant: true, leash: 40 });
    for (const s of S.sentinels) this.sentinel = this.spawnEnemy('sentinel', s.x, s.z, { leash: 30 });
    if (S.boss) this.thane = this.spawnEnemy('thane', S.boss.x, S.boss.z, { leash: 30 });
  }

  spawnEnemy(type, x, z, o = {}) {
    const e = new Enemy(this, type, x, z, o);
    this.enemies.push(e); this.actors.push(e);
    return e;
  }

  // ---------------- quests ----------------
  startQuest(id) {
    const q = this.quests[id];
    if (q.state !== 0) return;
    q.state = 1;
    audio.play('quest');
    this.hud.toast('Quest Started', q.title);
    // already done before being asked?
    if (id === 'bandits' && this.chief && !this.chief.alive) this.advanceQuest('bandits');
    if (id === 'watch' && this.sentinel && !this.sentinel.alive) this.advanceQuest('watch');
    if (id === 'barrow' && this.thane && !this.thane.alive) this.advanceQuest('barrow');
    if (id === 'wolves' && q.count >= q.goal) this.advanceQuest('wolves');
  }
  advanceQuest(id) {
    const q = this.quests[id];
    if (q.state !== 1) return;
    q.state = 2;
    audio.play('quest');
    this.hud.note(`${q.title}: ${q.turnin}`, 'gold');
  }
  completeQuest(id) {
    const q = this.quests[id];
    q.state = 3;
    this.addXp(id === 'barrow' ? 150 : 90);
    this.hud.toast('Quest Completed', q.title);
    audio.play('levelup');
  }
  questTarget(q) {
    if (q.state === 1) return q.target();
    if (q.state === 2) { const n = this.npcs.find((n) => n.role === q.giver); return n ? n.pos : null; }
    return null;
  }

  addGold(n) { const g = Math.round(n); this.player.gold += g; this.stats.gold += g; this.hud.note(`+${g} gold`, 'gold'); audio.play('coins'); }
  giveItem(item, equip = false) {
    this.player.inventory.push(item);
    this.hud.note(`Received: ${item.name}`, 'gold');
    audio.play('pickup');
    if (equip || item.dmg > this.player.weapon.dmg * 1.15) { this.player.equip(item); this.hud.note(`Equipped ${item.name}`, 'frost'); }
  }

  addXp(n) {
    const p = this.player;
    p.xp += n;
    while (p.xp >= XP_CURVE(p.level)) {
      p.xp -= XP_CURVE(p.level);
      p.level++;
      this.pendingLevels = (this.pendingLevels || 0) + 1;
    }
  }
  xpToNext() { return XP_CURVE(this.player.level); }
  offerPerks() {
    const choices = rollPerks(this.rng.fork('perk' + this.player.level + ':' + this.time), this.player.perks);
    return choices;
  }
  takePerk(perk) {
    perk.apply(this.player);
    this.player.perks.push(perk.id);
    this.pendingLevels--;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
    this.difficulty += 0.25;
  }

  bossBar(e) { this.boss = e; }

  // ---------------- combat ----------------
  meleeFromPlayer(power) {
    const p = this.player, w = p.weapon;
    const eye = p.camera.position;
    const fwd = p.forward(new THREE.Vector3());
    let hitAny = false;
    for (const e of this.actors) {
      if (!e.alive || e.faction === 'village' || e.dormant) continue;
      const to = new THREE.Vector3(e.pos.x - eye.x, e.pos.y + 1 - eye.y, e.pos.z - eye.z);
      const d = Math.hypot(to.x, to.z);
      if (d > w.reach + e.radius) continue;
      to.normalize();
      const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const dot = (to.x * flat.x + to.z * flat.z) / Math.max(1e-3, Math.hypot(to.x, to.z));
      if (dot < (power ? 0.35 : 0.5)) continue;
      let dmg = w.dmg * p.dmgMult * (power ? 2.1 : 1) * (0.9 + Math.random() * 0.2);
      const critC = p.crit + w.crit + (w.affixes.includes('crit') ? 0.15 : 0);
      const crit = Math.random() < critC;
      if (crit) dmg *= p.critMult;
      if (p.execute && e.hp < e.maxHp * 0.3) dmg *= 2;
      const info = { from: p, kind: 'melee', stagger: (power ? 0.7 : 0.25) * w.stagger, knock: power ? 7 : 2 };
      if (w.affixes.includes('fire')) info.burn = 4;
      if (w.affixes.includes('frost')) info.slow = true;
      const dealt = e.takeDamage(Math.round(dmg), info);
      hitAny = true;
      this.stats.damage += dealt;
      const hitPos = new THREE.Vector3(e.pos.x, e.pos.y + (e.type === 'wolf' ? 0.6 : 1.2), e.pos.z);
      this.hud.floatText(hitPos, (crit ? '✦' : '') + dealt, crit ? 'crit' : '');
      const dir = new THREE.Vector3(flat.x, 0, flat.z);
      if (e.type === 'sentinel') this.particles.sparks(hitPos.x, hitPos.y, hitPos.z, 18);
      else if (e.type === 'wight' || e.type === 'thane') this.particles.bones(hitPos.x, hitPos.y, hitPos.z, 10);
      else this.particles.blood(hitPos.x, hitPos.y, hitPos.z, dir, power ? 22 : 12);
      for (const a of w.affixData || []) this.particles.sparks(hitPos.x, hitPos.y, hitPos.z, 6, a.color);
      if (w.affixes.includes('storm') && Math.random() < 0.2) this.lightning(e);
      const ls = p.lifesteal + (w.affixes.includes('vamp') ? 0.06 : 0);
      if (ls > 0) p.hp = Math.min(p.maxHp, p.hp + dealt * ls);
      audio.play(e.type === 'sentinel' ? 'clang' : 'hit', { vol: power ? 1.2 : 0.9 });
      if (!this.boss || !this.boss.alive || this.boss.def?.boss !== true) this.target = e;
    }
    if (hitAny) { this.hitStop = power ? 0.09 : 0.045; p.shake = Math.max(p.shake, power ? 0.35 : 0.18); }
  }

  lightning(e) {
    const x = e.pos.x, z = e.pos.z, y = e.pos.y;
    for (let i = 0; i < 30; i++) this.particles.add.spawn(x + (Math.random() - 0.5) * 0.6, y + i * 0.5, z + (Math.random() - 0.5) * 0.6, 0, 0, 0, 2, 2.4, 4, 1, 0.25, 0.2, 0, 0);
    this.flashLight(x, y + 3, z, [3, 3.4, 5], 20, 0.35);
    e.takeDamage(20, { from: this.player, kind: 'storm', stagger: 0.5 });
    audio.play('boom', { vol: 0.6 });
  }

  flashLight(x, y, z, color, radius, life) {
    const l = this.world.addLight(x, y, z, color, radius, 0);
    l.base = color.slice(); l.life = life; l.maxLife = life;
    this.tempLights.push(l);
    return l;
  }

  castFirebolt() {
    const p = this.player;
    const fwd = p.forward(new THREE.Vector3());
    const origin = p.camera.localToWorld(new THREE.Vector3(-0.25, -0.2, -0.6));
    audio.play('cast');
    const n = p.bolts;
    for (let i = 0; i < n; i++) {
      const spread = n > 1 ? (i - (n - 1) / 2) * 0.12 : 0;
      const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), this.boltMat);
      mesh.position.copy(origin);
      this.scene.add(mesh);
      const light = this.world.addLight(origin.x, origin.y, origin.z, [3.5, 1.4, 0.4], 9, 0.4);
      this.projectiles.push({ kind: 'bolt', pos: origin.clone(), vel: dir.multiplyScalar(30), owner: p, life: 2.2, mesh, light });
    }
  }

  shootArrow(src, target) {
    const from = new THREE.Vector3(src.pos.x, src.pos.y + 1.45, src.pos.z);
    const tp = new THREE.Vector3(target.pos.x, target.pos.y + 1.2, target.pos.z);
    // lead the target a little
    if (target.vel) tp.addScaledVector(target.vel, Math.min(0.6, from.distanceTo(tp) / 28) * 0.6);
    const dir = tp.sub(from).normalize();
    dir.x += (Math.random() - 0.5) * 0.05; dir.y += (Math.random() - 0.5) * 0.03 + 0.03; dir.z += (Math.random() - 0.5) * 0.05;
    const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({ kind: 'arrow', pos: from, vel: dir.multiplyScalar(28), owner: src, life: 3, mesh, dmg: src.def.dmg });
  }

  explode(pos, radius, dmg, owner) {
    this.particles.explosion(pos.x, pos.y, pos.z, radius / 2.6);
    this.flashLight(pos.x, pos.y + 0.5, pos.z, [6, 2.6, 0.8], radius * 5, 0.5);
    const d = pos.distanceTo(this.player.camera.position);
    audio.play('boom', { vol: Math.max(0.2, 1 - d / 60) });
    this.player.shake = Math.max(this.player.shake, Math.max(0, 0.4 - d / 50));
    for (const e of this.actors) {
      if (!e.alive || e.faction === 'village' || e.dormant) continue;
      const ed = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (ed < radius + e.radius && Math.abs(e.pos.y + 1 - pos.y) < radius + 1.5) {
        const fall = 1 - Math.min(1, ed / (radius + e.radius)) * 0.5;
        let amt = Math.round(dmg * fall * (1 + (this.player.dmgMult - 1) * 0.5));
        const dealt = e.takeDamage(amt, { from: owner, kind: 'fire', burn: this.player.burn, stagger: 0.35, knock: 5 });
        this.stats.damage += dealt;
        this.hud.floatText(new THREE.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z), dealt, 'fire');
      }
    }
  }

  runeBurst() {
    const p = this.player;
    const pos = p.pos.clone();
    audio.play('burst');
    p.shake = 0.45;
    this.particles.ring(pos.x, pos.y + 0.3, pos.z, 3, [0.6, 1.6, 3.2], 90);
    this.flashLight(pos.x, pos.y + 1, pos.z, [1.2, 3, 6], 22, 0.6);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 40), this.ringMat.clone());
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, pos.y + 0.25, pos.z);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, max: 8 });
    for (const e of this.actors) {
      if (!e.alive || e.faction === 'village') continue;
      const d = e.dist2D(pos);
      if (d < 8) {
        if (e.dormant) e.wake();
        const dealt = e.takeDamage(p.burstDmg, { from: p, kind: 'burst', stagger: 1.4, knock: 16 * (1 - d / 10) });
        this.hud.floatText(new THREE.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z), dealt, '');
      }
    }
  }

  shockwave(src, pos, radius, dmg, frost) {
    this.particles.ring(pos.x, pos.y + 0.2, pos.z, radius * 0.4, frost ? [0.5, 1.4, 3] : [3, 1.2, 0.4], 70);
    this.particles.dust(pos.x, pos.y, pos.z, 20);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 36), this.ringMat.clone());
    if (!frost) ring.material.color.setRGB(3, 1.2, 0.4);
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, pos.y + 0.2, pos.z);
    this.scene.add(ring); this.rings.push({ mesh: ring, t: 0, max: radius });
    const p = this.player;
    const d = p.pos.distanceTo(pos);
    p.shake = Math.max(p.shake, Math.max(0, 0.5 - d / 30));
    if (!p.dead && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < radius && p.pos.y - pos.y < 1.6) {
      const dealt = p.damage(dmg, src, 'slam');
      if (dealt && frost) p.slow = 3;
    }
    for (const n of this.npcs) if (n.alive && n.guard && n.dist2D(pos) < radius) n.takeDamage(dmg * 0.6, { from: src, knock: 6 });
  }

  // ---------------- deaths, loot ----------------
  onActorDeath(a, info) {
    if (a.faction === 'hostile') {
      this.stats.kills++;
      const d = a.def;
      this.addXp(d.xp);
      audio.play(a.type === 'wight' || a.type === 'thane' ? 'wight' : 'death', { vol: 0.6 });
      if (this.target === a) this.target = null;
      // loot
      const gold = Math.round(this.rng.float(d.gold[0], d.gold[1]) * this.player.goldMult);
      if (gold > 0) this.dropPickup(a.pos, { kind: 'gold', amount: gold });
      if (this.rng.chance(d.boss ? 1 : a.type === 'sentinel' ? 1 : 0.1)) this.dropPickup(a.pos, { kind: 'item', item: rollWeapon(this.rng.fork('drop' + this.stats.kills), d.boss ? 4 : a.type === 'sentinel' ? 3 : 1) });
      if (this.rng.chance(d.boss ? 1 : 0.12)) this.dropPickup(a.pos, { kind: 'potion' });
      // quests
      if (a.type === 'wolf' || a.type === 'alpha') { const q = this.quests.wolves; q.count++; if (q.state === 1 && q.count >= q.goal) this.advanceQuest('wolves'); }
      if (a.type === 'chief') { this.stats.bossesSlain++; this.advanceQuest('bandits'); this.hud.toast('Hrolf the Red falls', 'Bleakrock Camp is broken.'); }
      if (a.type === 'sentinel') { this.stats.bossesSlain++; this.advanceQuest('watch'); this.hud.toast('The Sentinel is silenced', 'Its forge-core still glows.'); this.particles.explosion(a.pos.x, a.pos.y + 1.5, a.pos.z, 1.2); }
      if (a.type === 'thane') {
        this.stats.bossesSlain++;
        if (this.quests.barrow.state === 0) this.quests.barrow.state = 1;
        this.advanceQuest('barrow');
        this.victory = true; this.victoryT = 3.5;
        for (const e of this.enemies) if (e.alive && (e.type === 'wight')) e.takeDamage(9999, {});
        this.env.auroraBoost = 2.2;
      }
    }
    if (a.guard) this.hud.note(`${a.name} has fallen defending Hrimvik.`, 'blood');
  }

  dropPickup(pos, data) {
    const p = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 1.2, 0, pos.z + (Math.random() - 0.5) * 1.2);
    p.y = this.world.h(p.x, p.z);
    let mesh;
    if (data.kind === 'gold') mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 7), this.world.M.gold);
    else if (data.kind === 'potion') mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), psxMaterial({ map: this.T.cloth, tint: 0x000000, emissive: 0xff3040 }));
    else mesh = new THREE.Mesh(boxGeo(0.08, 0.7, 0.08, 0.3), psxMaterial({ map: this.T.metal, emissive: RARITY[data.item.rarity].glow || 0x101010, tint: RARITY[data.item.rarity].color }));
    mesh.position.copy(p).setY(p.y + 0.5);
    this.scene.add(mesh);
    this.pickups.push({ ...data, pos: p, mesh, t: Math.random() * 6, age: 0 });
  }

  openChest(c) {
    if (c.opened) return;
    c.opened = true;
    this.stats.chests++;
    audio.play('chest');
    const r = this.rng.fork('chest' + c.x.toFixed(1));
    const gold = Math.round(r.float(15, 45) * (1 + c.tier * 0.8) * this.player.goldMult);
    setTimeout(() => {
      this.addGold(gold);
      if (r.chance(0.5 + c.tier * 0.15)) this.giveItem(rollWeapon(r, c.tier));
      if (r.chance(0.6)) { this.player.potions++; this.hud.note('Found a Healing Draught.', 'gold'); }
      this.particles.sparks(c.x, c.y + 0.8, c.z, 25, [3, 2.2, 0.8]);
    }, 350);
  }

  useShrine(s) {
    if (s.used) return;
    s.used = true;
    this.stats.shrines++;
    const r = this.rng.fork('shrine' + s.x.toFixed(1));
    const cursed = r.chance(0.25);
    const b = cursed ? r.pick(SHRINE_CURSES) : r.pick(SHRINE_BLESSINGS);
    b.apply(this.player);
    this.player.mp = this.player.maxMp;
    audio.play('shrine');
    this.particles.ring(s.x, s.y + 0.5, s.z, 2, cursed ? [3, 0.5, 0.4] : [0.6, 1.6, 3], 80);
    this.particles.heal(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    this.hud.toast(b.name, b.desc);
    if (s.orb) s.orb.visible = false;
    const poi = this.world.pois.find((p) => p.kind === 'shrine' && Math.hypot(p.x - s.x, p.z - s.z) < 1);
    if (poi) poi.used = true;
  }

  onPlayerDeath(src) {
    audio.play('death');
    this.deathT = 2.2;
    this.killedBy = src ? src.name : 'the cold';
  }

  // ---------------- interaction ----------------
  findInteractable() {
    const p = this.player;
    const eye = p.camera.position, fwd = p.forward(new THREE.Vector3());
    let best = null, bestScore = 0.86;
    const consider = (pos, h, range, obj) => {
      const to = new THREE.Vector3(pos.x - eye.x, pos.y + h - eye.y, pos.z - eye.z);
      const d = to.length();
      if (d > range) return;
      const dot = to.normalize().dot(fwd);
      const score = dot + (range - d) * 0.01;
      if (dot > 0.8 && score > bestScore) { bestScore = score; best = obj; }
    };
    for (const n of this.npcs) if (n.alive) consider(n.pos, 1.3, 3.6, { type: 'npc', npc: n, label: n.name, verb: 'Talk' });
    for (const c of this.world.chests) if (!c.opened) consider({ x: c.x, y: c.y, z: c.z }, 0.4, 3, { type: 'chest', chest: c, label: c.tier >= 3 ? 'Ornate Chest' : 'Chest', verb: 'Open' });
    for (const s of this.world.shrines) if (!s.used) consider({ x: s.x, y: s.y, z: s.z }, 1.6, 3.6, { type: 'shrine', shrine: s, label: 'Rune Shrine', verb: 'Pray' });
    return best;
  }

  // ---------------- per-frame ----------------
  update(dt, input, mode) {
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.08; }
    this.time += dt;
    G.uTime.value += dt;
    const fast = input.down('KeyT') && mode === 'play';
    this.env.update(dt, fast);
    const p = this.player;
    if (mode === 'play') p.update(dt, input);
    else p.updateCamera(dt);
    G.uPlayerPos.value.copy(p.pos);
    this.sky.position.copy(p.camera.position);
    this.world.update(dt, this.time, p.camera.position, this.particles);

    const freeze = mode !== 'play';
    if (!freeze) {
      for (const a of this.actors) if (!a.removed) a.update(dt);
      this.actors = this.actors.filter((a) => !a.removed);
      this.enemies = this.enemies.filter((a) => !a.removed);
    } else for (const n of this.npcs) if (n.talking) { n.updateStatus(dt); n.anim.talk = true; n.faceTowards(p.pos, dt, 6); n.animate(dt); }

    this.updateProjectiles(dt);
    this.updatePickups(dt);
    for (const l of this.tempLights) { l.life -= dt; const k = Math.max(0, l.life / l.maxLife); l.color.set(l.base[0] * k, l.base[1] * k, l.base[2] * k); if (l.life <= 0) l.dead = true; }
    this.world.lights = this.world.lights.filter((l) => !l.dead);
    this.tempLights = this.tempLights.filter((l) => !l.dead);
    for (const r of this.rings) {
      r.t += dt;
      const s = 1 + r.t * r.max * 3.2;
      r.mesh.scale.setScalar(Math.min(s, r.max));
      r.mesh.material.opacity = Math.max(0, 1 - r.t * 2.2);
      if (r.t > 0.5) { this.scene.remove(r.mesh); r.dead = true; }
    }
    this.rings = this.rings.filter((r) => !r.dead);
    this.particles.update(dt);
    this.snow.update(p.camera, this.env.weather === 'snow' ? this.env.weatherT : 0);
    if (this.deathT !== undefined) this.deathT -= dt;
    if (this.victoryT !== undefined) this.victoryT -= dt;
    // ambient wolf howls at night
    this._howl = (this._howl ?? 20) - dt;
    if (this._howl <= 0) { this._howl = 25 + Math.random() * 30; if (this.env.isNight) audio.play('howl', { vol: 0.8, pan: Math.random() * 2 - 1 }); }
  }

  updateProjectiles(dt) {
    const w = this.world;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.kind === 'arrow') pr.vel.y -= 4 * dt;
      const prev = pr.pos.clone();
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      pr.mesh.lookAt(pr.pos.clone().add(pr.vel));
      if (pr.kind === 'bolt') { pr.mesh.rotation.z += dt * 10; this.particles.magicTrail(pr.pos.x, pr.pos.y, pr.pos.z); pr.light.pos.copy(pr.pos); }
      let hit = pr.life <= 0 || pr.pos.y < w.h(pr.pos.x, pr.pos.z) || pr.pos.y < WATER_LEVEL - 0.2 && w.h(pr.pos.x, pr.pos.z) < WATER_LEVEL;
      if (!hit) for (const c of w.colliders.query(pr.pos.x, pr.pos.z, 0.5)) {
        if (c.h < pr.pos.y - w.h(pr.pos.x, pr.pos.z)) continue;
        if (c.t === 0 ? Math.hypot(pr.pos.x - c.x, pr.pos.z - c.z) < c.r : (() => { const lx = (pr.pos.x - c.x) * c.cos - (pr.pos.z - c.z) * c.sin, lz = (pr.pos.x - c.x) * c.sin + (pr.pos.z - c.z) * c.cos; return Math.abs(lx) < c.hw && Math.abs(lz) < c.hd; })()) { hit = true; break; }
      }
      if (pr.kind === 'bolt') {
        if (!hit) for (const e of this.actors) {
          if (!e.alive || e.faction === 'village' || e.dormant) continue;
          const dy = pr.pos.y - (e.pos.y + 0.9);
          if (Math.hypot(pr.pos.x - e.pos.x, pr.pos.z - e.pos.z) < e.radius + 0.35 && Math.abs(dy) < 1.3 * (e.type === 'thane' || e.type === 'sentinel' ? 1.6 : 1)) { hit = true; break; }
        }
        if (hit) { this.explode(prev, this.player.boltRadius, 24, pr.owner); this.scene.remove(pr.mesh); pr.light.dead = true; pr.dead = true; }
      } else {
        const targets = [this.player, ...this.npcs.filter((n) => n.guard && n.alive)];
        for (const t of targets) {
          if (t === this.player && t.dead) continue;
          const ty = t === this.player ? t.pos.y + 0.9 : t.pos.y + 1;
          if (Math.hypot(pr.pos.x - t.pos.x, pr.pos.z - t.pos.z) < 0.6 && Math.abs(pr.pos.y - ty) < 1.1) {
            if (t === this.player) t.damage(pr.dmg, pr.owner, 'arrow'); else t.takeDamage(pr.dmg, { from: pr.owner });
            hit = true; break;
          }
        }
        if (hit) { this.particles.dust(pr.pos.x, pr.pos.y, pr.pos.z, 3); this.scene.remove(pr.mesh); pr.dead = true; }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  updatePickups(dt) {
    const p = this.player;
    for (const k of this.pickups) {
      k.t += dt; k.age += dt;
      k.mesh.position.y = k.pos.y + 0.45 + Math.sin(k.t * 2.4) * 0.1;
      k.mesh.rotation.y = k.t * 2;
      if (k.kind === 'gold') k.mesh.rotation.x = Math.PI / 2;
      if (Math.random() < 0.1) this.particles.add.spawn(k.pos.x, k.mesh.position.y, k.pos.z, 0, 0.5, 0, k.kind === 'gold' ? 3 : k.kind === 'potion' ? 3 : 1.6, k.kind === 'potion' ? 0.4 : 2.2, k.kind === 'potion' ? 0.5 : 1.2, 1, 0.06, 0.6, -0.2, 0.5);
      const d = Math.hypot(p.pos.x - k.pos.x, p.pos.z - k.pos.z);
      if (k.age > 0.5 && d < 3.5 && !p.dead) { // magnet
        k.pos.x += (p.pos.x - k.pos.x) * Math.min(1, dt * 6); k.pos.z += (p.pos.z - k.pos.z) * Math.min(1, dt * 6);
        k.pos.y = this.world.h(k.pos.x, k.pos.z);
      }
      if (k.age > 0.5 && d < 0.9 && !p.dead) {
        if (k.kind === 'gold') this.addGold(k.amount);
        else if (k.kind === 'potion') { p.potions++; this.hud.note('Healing Draught (' + p.potions + ')', 'gold'); audio.play('pickup'); }
        else this.giveItem(k.item);
        this.scene.remove(k.mesh); k.dead = true;
      }
      k.mesh.position.x = k.pos.x; k.mesh.position.z = k.pos.z;
    }
    this.pickups = this.pickups.filter((k) => !k.dead);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}
