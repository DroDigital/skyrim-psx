// First-person player: movement (sprint, jump, dodge, swim), melee with charge/power attacks,
// Firebolt, Rune Burst, potions, and a procedurally animated PS1-style viewmodel with lag sway.
import * as THREE from 'three';
import { psxMaterial } from '../render/psxMaterial.js';
import { boxGeo } from '../world/builder.js';
import { PLAY_RADIUS, WATER_LEVEL } from '../world/terrain.js';
import { clamp, damp, lerp } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { starterWeapon, RARITY } from '../game/items.js';

const EYE = 1.62;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.radius = 0.4;
    // stats
    this.level = 1; this.xp = 0; this.gold = 25;
    this.maxHp = 100; this.hp = 100; this.maxMp = 100; this.mp = 100; this.maxSp = 100; this.sp = 100;
    this.hpRegen = 0.4; this.mpRegen = 6; this.spRegen = 22;
    this.dmgMult = 1; this.crit = 0.05; this.critMult = 2; this.lifesteal = 0; this.armor = 0; this.thorns = 0;
    this.boltRadius = 2.6; this.burn = 3; this.bolts = 1; this.burstCd = 12; this.burstDmg = 18; this.speedMult = 1;
    this.sprintCost = 16; this.dashCost = 22; this.goldMult = 1; this.secondWind = false; this.execute = false;
    this.potions = 3;
    this.perks = [];
    this.inventory = [starterWeapon()];
    this.weapon = this.inventory[0];
    // state
    this.attack = null;   // { t, dur, power, hitDone }
    this.charge = 0; this.lmbHeld = false;
    this.castCd = 0; this.castAnim = 0; this.burstTimer = 0; this.burstAnim = 0;
    this.dash = 0; this.dashDir = new THREE.Vector3(); this.iframes = 0;
    this.drinkAnim = 0; this.hurtFlash = 0; this.slow = 0;
    this.bob = 0; this.stepAcc = 0; this.shake = 0; this.fovKick = 0;
    this.swimming = false; this.underwater = false;
    this.dead = false;
    this.sinceHit = 10;

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 900);
    this.vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.vmScene = new THREE.Scene();
    this.vmScene.add(this.vmCam);
    this.vm = new THREE.Group();
    this.vmCam.add(this.vm);
    this.sway = new THREE.Vector2();
    this.buildViewmodel();
    this.lantern = game.world.addLight(0, -100, 0, [1.6, 1.1, 0.6], 10, 0.3);
    this.handLight = game.world.addLight(0, -100, 0, [2.6, 1.0, 0.25], 6, 0.5);
  }

  buildViewmodel() {
    this.vm.clear();
    const T = this.game.T;
    const skin = psxMaterial({ map: T.cloth, tint: 0xc89a7a, desat: 1 });
    const sleeve = psxMaterial({ map: T.fur, tint: 0x8a7a68 });
    const leather = psxMaterial({ map: T.leather });
    const w = this.weapon;
    const glow = RARITY[w.rarity].glow;
    const metal = psxMaterial({ map: T.metal, tint: 0xe0e4e8, emissive: glow });
    // right arm
    this.rArm = new THREE.Group();
    const fore = new THREE.Mesh(boxGeo(0.09, 0.09, 0.42, 0.3), sleeve); fore.position.z = 0.22; this.rArm.add(fore);
    const hand = new THREE.Mesh(boxGeo(0.085, 0.1, 0.1, 0.3), skin); this.rArm.add(hand);
    const wpn = new THREE.Group();
    wpn.add(new THREE.Mesh(boxGeo(0.035, 0.035, 0.2, 0.3), leather));
    if (w.model === 'sword' || w.model === 'greatsword') {
      const L = w.model === 'greatsword' ? 0.85 : w.type === 'dagger' ? 0.3 : 0.6;
      const g = new THREE.Mesh(boxGeo(0.2, 0.035, 0.05, 0.3), metal); g.position.z = -0.12; wpn.add(g);
      const b = new THREE.Mesh(boxGeo(0.055, 0.016, L, 0.3), metal); b.position.z = -0.14 - L / 2; wpn.add(b);
    } else if (w.model === 'axe') {
      const h = new THREE.Mesh(boxGeo(0.035, 0.035, 0.55, 0.3), leather); h.position.z = -0.3; wpn.add(h);
      const b = new THREE.Mesh(boxGeo(0.02, 0.24, 0.2, 0.3), metal); b.position.set(0, 0.1, -0.52); wpn.add(b);
    } else {
      const h = new THREE.Mesh(boxGeo(0.04, 0.04, 0.6, 0.3), leather); h.position.z = -0.32; wpn.add(h);
      const b = new THREE.Mesh(boxGeo(0.14, 0.14, 0.2, 0.3), metal); b.position.z = -0.65; wpn.add(b);
    }
    wpn.rotation.x = 1.15;
    wpn.rotation.z = 0.15;
    this.rArm.add(wpn);
    this.wpnMesh = wpn;
    this.vm.add(this.rArm);
    // left arm with flame
    this.lArm = new THREE.Group();
    const lf = new THREE.Mesh(boxGeo(0.09, 0.09, 0.42, 0.3), sleeve); lf.position.z = 0.22; this.lArm.add(lf);
    this.lArm.add(new THREE.Mesh(boxGeo(0.085, 0.1, 0.1, 0.3), skin));
    this.flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.018, 0), psxMaterial({ map: T.cloth, tint: 0x000000, emissive: 0xff8a2a }));
    this.flame.position.set(0.02, 0.08, -0.06);
    this.lArm.add(this.flame);
    this.vm.add(this.lArm);
  }

  equip(item) {
    if (item.kind !== 'weapon') return;
    this.weapon = item;
    this.buildViewmodel();
    audio.play('clang', { vol: 0.5 });
  }

  get eye() { return EYE; }
  get alive() { return !this.dead; }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  spawn(x, z) {
    this.pos.set(x, this.game.world.h(x, z), z);
    this.vel.set(0, 0, 0);
  }

  update(dt, input) {
    const g = this.game, world = g.world;
    this.sinceHit += dt;
    if (this.dead) { this.updateCamera(dt); return; }
    // --- look ---
    if (input.locked) {
      this.yaw -= input.mouse.dx * input.sensitivity;
      this.pitch = clamp(this.pitch - input.mouse.dy * input.sensitivity, -1.45, 1.45);
      this.sway.x += input.mouse.dx * 0.0006; this.sway.y += input.mouse.dy * 0.0006;
    }
    this.sway.x = damp(this.sway.x, 0, 8, dt); this.sway.y = damp(this.sway.y, 0, 8, dt);
    this.sway.clampScalar(-0.08, 0.08);

    // --- move ---
    let mx = 0, mz = 0;
    if (input.down('KeyW')) mz -= 1; if (input.down('KeyS')) mz += 1;
    if (input.down('KeyA')) mx -= 1; if (input.down('KeyD')) mx += 1;
    const ml = Math.hypot(mx, mz); if (ml > 0) { mx /= ml; mz /= ml; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = mx * cos + mz * sin, wz = -mx * sin + mz * cos;
    const wantSprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const sprinting = wantSprint && ml > 0 && mz < 0.2 && this.sp > 1 && !this.swimming && !this.attack;
    if (sprinting) { this.sp -= this.sprintCost * dt; this.spDelay = 0.6; }
    let speed = (sprinting ? 7.4 : 4.3) * this.speedMult * (this.slow > 0 ? 0.55 : 1) * (this.swimming ? 0.55 : 1);
    if (this.attack && this.attack.power) speed *= 0.4;
    const accel = this.onGround || this.swimming ? 14 : 3;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);

    // dodge
    if (input.hit('KeyC') && this.dash <= 0 && this.sp >= this.dashCost) {
      this.sp -= this.dashCost; this.spDelay = 0.8;
      this.dash = 0.22; this.iframes = 0.3;
      if (ml > 0) this.dashDir.set(wx, 0, wz); else this.dashDir.set(-sin, 0, -cos).multiplyScalar(-1);
      audio.play('dash');
      g.particles.dust(this.pos.x, this.pos.y, this.pos.z, 10);
    }
    if (this.dash > 0) { this.dash -= dt; this.vel.x = this.dashDir.x * 15; this.vel.z = this.dashDir.z * 15; }

    // gravity / jump / swim
    const groundH = world.h(this.pos.x, this.pos.z);
    this.swimming = groundH < WATER_LEVEL - 1.25 && this.pos.y < WATER_LEVEL - 1.0;
    if (this.swimming) {
      const target = WATER_LEVEL - 1.35;
      this.vel.y = damp(this.vel.y, (target - this.pos.y) * 3, 5, dt);
    } else {
      this.vel.y -= 19 * dt;
      if (input.hit('Space') && this.onGround && this.sp > 5) { this.vel.y = 6.4; this.onGround = false; this.sp -= 5; audio.play('jump'); }
    }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;

    // collisions
    world.colliders.resolve(this.pos, this.radius, this.pos.y);
    for (const e of g.actors) if (e.alive && e.solid !== false) {
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z, d = Math.hypot(dx, dz), m = this.radius + e.radius;
      if (d < m && d > 1e-4) { this.pos.x = e.pos.x + (dx / d) * m; this.pos.z = e.pos.z + (dz / d) * m; }
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > PLAY_RADIUS) { this.pos.x *= PLAY_RADIUS / r; this.pos.z *= PLAY_RADIUS / r; if (!this._edgeNote || g.time - this._edgeNote > 6) { this._edgeNote = g.time; g.hud.note('The mountains are impassable. The rest of the north awaits in the full saga.', 'frost'); } }
    const gh = world.h(this.pos.x, this.pos.z);
    const wasAir = !this.onGround;
    if (this.pos.y <= gh) {
      if (wasAir && this.vel.y < -12) { this.damage(Math.round((-this.vel.y - 12) * 4), null, 'fall'); }
      if (wasAir && this.vel.y < -4) { audio.play('step', { vol: 2 }); this.shake = Math.max(this.shake, 0.1); }
      this.pos.y = gh; this.vel.y = Math.max(0, this.vel.y); this.onGround = true;
      // steep slopes push you back down
      const n = world.terrain.normalAt(this.pos.x, this.pos.z);
      if (n.y < 0.62) { this.vel.x += n.x * 22 * dt; this.vel.z += n.z * 22 * dt; }
    } else if (this.pos.y > gh + 0.15 && !this.swimming) this.onGround = false;
    if (this.swimming) this.onGround = false;

    // footsteps & bob
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      this.bob += dt * hs * 1.75;
      this.stepAcc += hs * dt;
      if (this.stepAcc > (sprinting ? 2.2 : 1.8)) { this.stepAcc = 0; const s = world.terrain.splatAt(this.pos.x, this.pos.z); audio.play('step', { snow: s.snow > 0.4 || g.env.snowCover > 0.5 }); }
    }
    this.fovKick = damp(this.fovKick, sprinting ? 7 : 0, 6, dt);

    // regen
    this.spDelay = (this.spDelay || 0) - dt;
    if (this.spDelay <= 0) this.sp = Math.min(this.maxSp, this.sp + this.spRegen * dt);
    this.mp = Math.min(this.maxMp, this.mp + this.mpRegen * dt);
    if (this.sinceHit > 4) this.hp = Math.min(this.maxHp, this.hp + this.hpRegen * dt * (this.sinceHit > 8 ? 3 : 1));
    this.slow -= dt; this.iframes -= dt; this.castCd -= dt; this.burstTimer -= dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);

    this.updateCombat(dt, input);
    this.updateCamera(dt);
    this.updateViewmodel(dt, hs);

    // lantern: a warm personal light when it is dark
    const dark = g.env.isNight || g.env.weatherT > 0.6;
    this.lantern.pos.set(this.pos.x, this.pos.y + (dark ? 2.2 : -100), this.pos.z);
    this.underwater = this.camera.position.y < WATER_LEVEL - 0.05 && groundH < WATER_LEVEL;
  }

  updateCombat(dt, input) {
    const g = this.game;
    const w = this.weapon;
    // melee: tap for light, hold for power
    if (input.mouse.leftPressed && !this.attack) { this.lmbHeld = true; this.charge = 0; }
    if (this.lmbHeld) {
      this.charge += dt;
      const release = !input.mouse.left;
      if (this.charge > 0.42 || release) {
        this.lmbHeld = false;
        const power = this.charge > 0.42;
        const cost = power ? w.stamina * 2.2 : w.stamina;
        if (this.sp >= cost * 0.5) {
          this.sp -= cost; this.spDelay = 0.9;
          this.attack = { t: 0, dur: (power ? 0.8 : 0.48) / w.speed, power, hitDone: false, side: (this._side = -(this._side || 1)) };
          audio.play(power ? 'swingHeavy' : 'swing');
        } else g.hud.note('Too exhausted to swing.', 'blood');
      }
    }
    if (this.attack) {
      const a = this.attack;
      a.t += dt / a.dur;
      if (!a.hitDone && a.t > (a.power ? 0.5 : 0.42)) {
        a.hitDone = true;
        g.meleeFromPlayer(a.power);
      }
      if (a.t >= 1) this.attack = null;
    }
    // Firebolt
    if (input.mouse.rightPressed && this.castCd <= 0) {
      if (this.mp >= 18) {
        this.mp -= 18; this.castCd = 0.5; this.castAnim = 1;
        g.castFirebolt();
      } else { g.hud.note('Not enough magicka.', 'frost'); this.castCd = 0.3; }
    }
    // Rune Burst
    if (input.hit('KeyQ')) {
      if (this.burstTimer > 0) g.hud.note(`Rune Burst recovers in ${this.burstTimer.toFixed(1)}s`, 'frost');
      else if (this.mp < 25) g.hud.note('Not enough magicka.', 'frost');
      else { this.mp -= 25; this.burstTimer = this.burstCd; this.burstAnim = 1; g.runeBurst(); }
    }
    // potion
    if (input.hit('KeyF')) {
      if (this.potions <= 0) g.hud.note('No healing draughts left.', 'blood');
      else if (this.hp >= this.maxHp) g.hud.note('You are already at full health.');
      else { this.potions--; this.drinkAnim = 1; const amt = Math.round(this.maxHp * 0.45); this.hp = Math.min(this.maxHp, this.hp + amt); audio.play('drink'); g.particles.heal(this.pos.x, this.pos.y, this.pos.z); g.hud.floatText(this.pos.clone().setY(this.pos.y + 1.4), '+' + amt, 'heal'); }
    }
    this.castAnim = Math.max(0, this.castAnim - dt * 3);
    this.burstAnim = Math.max(0, this.burstAnim - dt * 1.6);
    this.drinkAnim = Math.max(0, this.drinkAnim - dt * 1.4);
    // hand light glows while magicka is ready
    const ready = this.mp >= 18 ? 1 : 0.2;
    const hp = this.camera.localToWorld(new THREE.Vector3(-0.35, -0.3, -0.6));
    this.handLight.pos.copy(hp);
    this.handLight.color.set(2.6, 1.0, 0.25).multiplyScalar(0.25 * ready + this.castAnim * 1.5);
  }

  damage(amount, source, kind = 'melee') {
    if (this.dead || this.iframes > 0) return 0;
    const g = this.game;
    let dmg = Math.max(1, Math.round(amount * (1 - this.armor)));
    this.hp -= dmg;
    this.sinceHit = 0;
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.5 + dmg / 40);
    this.shake = Math.max(this.shake, 0.18 + dmg / 80);
    audio.play('hurt');
    if (source && source.pos) {
      const dx = this.pos.x - source.pos.x, dz = this.pos.z - source.pos.z, d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * 4; this.vel.z += (dz / d) * 4;
      if (this.thorns > 0 && source.takeDamage && kind === 'melee') source.takeDamage(this.thorns, { from: this, kind: 'thorns' });
    }
    g.hud.floatText(this.pos.clone().setY(this.pos.y + 1.2), '-' + dmg, 'player');
    if (this.hp <= 0) {
      if (this.secondWind) { this.secondWind = false; this.hp = Math.round(this.maxHp * 0.3); this.iframes = 2; g.hud.toast("Valkyrie's Mercy", 'A cold hand lifts you from death.'); audio.play('shrine'); }
      else { this.hp = 0; this.dead = true; g.onPlayerDeath(source); }
    }
    return dmg;
  }

  updateCamera(dt) {
    const cam = this.camera;
    const bobY = Math.sin(this.bob * 2) * 0.045, bobX = Math.cos(this.bob) * 0.03;
    cam.position.set(this.pos.x, this.pos.y + EYE + (this.onGround ? bobY : 0), this.pos.z);
    if (this.dead) cam.position.y = this.pos.y + 0.35;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake;
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * sh * 0.3, this.yaw + (Math.random() - 0.5) * sh * 0.3 + bobX * 0.02, this.dead ? 0.6 : (Math.random() - 0.5) * sh * 0.1 - this.vel.x * Math.cos(this.yaw) * 0.002 + this.vel.z * Math.sin(this.yaw) * 0.002);
    cam.fov = this.baseFov + this.fovKick + (this.dash > 0 ? 6 : 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.vmCam.position.copy(cam.position);
    this.vmCam.quaternion.copy(cam.quaternion);
    this.vmCam.aspect = cam.aspect;
    this.vmCam.updateProjectionMatrix();
  }

  updateViewmodel(dt, hs) {
    const t = this.game.time;
    const bob = this.onGround ? Math.min(1, hs / 5) : 0;
    const bx = Math.cos(this.bob) * 0.025 * bob, by = Math.abs(Math.sin(this.bob)) * 0.03 * bob;
    const breath = Math.sin(t * 1.7) * 0.006;
    // right arm rest pose
    const R = this.rArm;
    R.position.set(0.34 + bx - this.sway.x, -0.37 - by + breath + this.sway.y, -0.52);
    R.rotation.set(0.1, 0.2, -0.25);
    if (this.lmbHeld && this.charge > 0.15) { // charging power attack
      const c = Math.min(1, (this.charge - 0.15) / 0.27);
      R.position.y += 0.15 * c; R.position.x += 0.05 * c; R.rotation.x += 0.9 * c; R.rotation.z -= 0.4 * c;
      R.position.x += (Math.random() - 0.5) * 0.006 * c;
    }
    if (this.attack) {
      const a = this.attack, k = a.t;
      const ease = (x) => x * x * (3 - 2 * x);
      if (a.power) {
        const up = k < 0.45 ? ease(k / 0.45) : 1 - ease(Math.min(1, (k - 0.45) / 0.2));
        const down = k < 0.45 ? 0 : k < 0.65 ? ease((k - 0.45) / 0.2) : 1 - ease((k - 0.65) / 0.35);
        R.rotation.x += 1.3 * up - 1.6 * down; R.position.y += 0.22 * up - 0.12 * down; R.position.x -= 0.15 * down; R.position.z -= 0.15 * down;
      } else {
        const s = a.side;
        const wind = k < 0.3 ? ease(k / 0.3) : 1 - ease(Math.min(1, (k - 0.3) / 0.25));
        const swing = k < 0.3 ? 0 : k < 0.6 ? ease((k - 0.3) / 0.3) : 1 - ease((k - 0.6) / 0.4);
        R.rotation.z += s * (0.9 * wind - 1.4 * swing);
        R.rotation.y += s * (-0.5 * wind + 0.9 * swing);
        R.rotation.x += 0.6 * wind - 0.3 * swing;
        R.position.x += s * (0.08 * wind - 0.38 * swing);
        R.position.y += 0.12 * wind - 0.05 * swing;
        R.position.z -= 0.18 * swing;
      }
    }
    // left arm (magic)
    const L = this.lArm;
    L.position.set(-0.34 - bx - this.sway.x, -0.33 + by + breath + this.sway.y, -0.58);
    L.rotation.set(0.35, -0.25, 0.1);
    if (this.castAnim > 0) { L.position.z -= this.castAnim * 0.25; L.position.x += this.castAnim * 0.12; L.position.y += this.castAnim * 0.08; L.rotation.x -= this.castAnim * 0.5; }
    if (this.burstAnim > 0) {
      const k = this.burstAnim;
      L.position.y -= k * 0.15; L.position.z -= k * 0.2; L.rotation.x -= k * 1.2;
      R.position.y -= k * 0.1; R.rotation.x -= k * 0.6;
    }
    if (this.drinkAnim > 0) { const k = Math.sin(this.drinkAnim * Math.PI); L.position.set(-0.1, -0.15 + k * 0.08, -0.3); L.rotation.x = 1.1 * k; }
    // flame orb
    const ready = this.mp >= 18;
    this.flame.visible = ready;
    this.flame.rotation.y = t * 4; this.flame.rotation.x = t * 3;
    const fs = 1 + Math.sin(t * 17) * 0.15 + this.castAnim * 0.8;
    this.flame.scale.setScalar(fs);
    if (ready && Math.random() < 0.6) {
      const p = this.flame.getWorldPosition(new THREE.Vector3());
      this.game.particles.add.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2, 3, 1.2, 0.3, 1, 0.025, 0.25, -0.3, 1, -0.6);
    }
  }
}
