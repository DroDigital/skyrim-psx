// Shared actor base for enemies, villagers and guards: position on the heightfield,
// collision, model animation plumbing, damage, status effects, dissolve-out on death.
import * as THREE from 'three';
import { animateHumanoid, playClip } from './models.js';
import { angleDiff, damp } from '../core/rng.js';

export class Actor {
  constructor(game, model, x, z, o = {}) {
    this.game = game;
    this.model = model;
    this.pos = new THREE.Vector3(x, game.world.h(x, z), z);
    this.home = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = o.yaw ?? Math.random() * Math.PI * 2;
    this.radius = o.radius ?? 0.45;
    this.height = o.height ?? 1.8;
    this.maxHp = this.hp = o.hp ?? 50;
    this.alive = true;
    this.name = o.name ?? 'Stranger';
    this.faction = o.faction ?? 'neutral';
    this.anim = { speed: 0, phase: Math.random() * 10, attack: -1, hit: 0, dead: 0, t: 0, aim: 0, cast: 0, talk: false, wight: !!o.wight };
    this.burnT = 0; this.burnDps = 0; this.slowT = 0; this.flash = 0; this.stagger = 0;
    this.dissolve = 0; this.removed = false; this.deadT = 0;
    this.solid = true;
    this.target = null;
    game.scene.add(model.root);
    this.sync();
  }

  get mats() { return this.model.mats; }
  dist2D(p) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }
  faceTowards(p, dt, rate = 8) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw += angleDiff(this.yaw, want) * Math.min(1, rate * dt);
  }
  facingDot(p) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    return (Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz) / d;
  }

  move(dt, dirX, dirZ, speed) {
    const sm = this.slowT > 0 ? 0.5 : 1;
    this.vel.x = damp(this.vel.x, dirX * speed * sm, 10, dt);
    this.vel.z = damp(this.vel.z, dirZ * speed * sm, 10, dt);
  }

  physics(dt) {
    const w = this.game.world;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.alive) {
      w.colliders.resolve(this.pos, this.radius);
      // separation between actors
      for (const o of this.game.actors) {
        if (o === this || !o.alive) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz), m = this.radius + o.radius;
        if (d < m && d > 1e-4) { const push = (m - d) * 0.5; this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push; }
      }
    }
    const gh = w.h(this.pos.x, this.pos.z);
    this.pos.y = Math.max(gh, Math.min(this.pos.y, gh + 5));
    if (this.pos.y > gh) this.pos.y = damp(this.pos.y, gh, 12, dt);
  }

  takeDamage(amount, info = {}) {
    if (!this.alive) return 0;
    let dmg = Math.round(amount * (this.dmgTaken ?? 1));
    if (info.kind === 'fire' && this.fireResist) dmg = Math.round(dmg * (1 - this.fireResist));
    this.hp -= dmg;
    this.flash = 1;
    this.anim.hit = 1;
    if (info.stagger) this.stagger = Math.max(this.stagger, info.stagger * (this.staggerResist ?? 1));
    if (info.burn) { this.burnT = 4; this.burnDps = info.burn; }
    if (info.slow) this.slowT = 3;
    if (info.knock && info.from) {
      const dx = this.pos.x - info.from.pos.x, dz = this.pos.z - info.from.pos.z, d = Math.hypot(dx, dz) || 1;
      const k = info.knock * (this.knockResist ?? 1);
      this.vel.x += (dx / d) * k; this.vel.z += (dz / d) * k;
    }
    if (info.from && info.from !== this) this.onHurt && this.onHurt(info.from);
    if (this.hp <= 0) { this.hp = 0; this.die(info); }
    return dmg;
  }

  die(info) {
    this.alive = false;
    this.deadT = 0;
    this.game.onActorDeath(this, info);
  }

  updateStatus(dt) {
    this.anim.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.anim.hit = Math.max(0, this.anim.hit - dt * 4);
    this.stagger = Math.max(0, this.stagger - dt);
    this.slowT -= dt;
    if (this.burnT > 0 && this.alive) {
      this.burnT -= dt;
      this._burnAcc = (this._burnAcc || 0) + this.burnDps * dt;
      if (this._burnAcc >= 1) { const d = Math.floor(this._burnAcc); this._burnAcc -= d; this.hp -= d; if (this.hp <= 0) { this.hp = 0; this.die({ kind: 'fire' }); } }
      if (Math.random() < 0.5) this.game.particles.fire(this.pos.x, this.pos.y + 0.8, this.pos.z, 0.6);
    }
    if (this.slowT > 0 && Math.random() < 0.2) this.game.particles.frost(this.pos.x, this.pos.y + 1, this.pos.z, 1);
    for (const m of this.mats) m.uniforms.uFlash.value = this.flash * 0.6;
    if (!this.alive) {
      this.deadT += dt;
      this.anim.dead = Math.min(1, this.deadT * 1.8);
      if (this.deadT > 1.6) {
        this.dissolve = Math.min(1.05, (this.deadT - 1.6) * 0.7);
        for (const m of this.mats) m.uniforms.uDissolve.value = this.dissolve;
        if (this.dissolve >= 1.05) this.remove();
      }
    }
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.game.scene.remove(this.model.root);
  }

  animate(dt) {
    const m = this.model;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (m.kind === 'humanoid') {
      this.anim.speed = this.alive ? sp : 0;
      animateHumanoid(m, this.anim, dt);
    } else if (m.mixer) {
      if (!this.alive) {
        if (m.map.death) playClip(m, 'death', 0.2, true);
        else { m.root.rotation.z = damp(m.root.rotation.z, Math.PI / 2, 6, dt); if (m.current) m.current.timeScale = damp(m.current.timeScale, 0, 4, dt); }
      } else if (this.anim.attack >= 0 && m.map.attack !== m.map.run) playClip(m, 'attack', 0.1, false, 1.2);
      else if (sp > 3.5) playClip(m, 'run', 0.25, false, Math.min(1.6, sp / 6));
      else if (sp > 0.4) playClip(m, 'walk', 0.25, false, Math.max(0.6, sp / 1.8));
      else playClip(m, 'idle', 0.4);
      m.mixer.update(dt);
    }
    this.sync();
  }

  sync() {
    const r = this.model.root;
    r.position.copy(this.pos);
    if (this.lunge) r.position.y += this.lunge;
    r.rotation.y = this.yaw + (this.model.yawOffset || 0);
    r.visible = !this.removed;
  }
}
