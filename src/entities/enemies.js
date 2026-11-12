// Hostiles of the vale and their behaviour.
//  wolf      — fast pack hunters (glTF skinned), lunge bites, bolder at night
//  bandit    — sword & shield brawlers; archers kite and loose arrows
//  chief     — bandit chief, heavy two-hander, power slams
//  wight     — barrow dead: rise from the earth, frost-touch slows
//  sentinel  — ancient brass automaton (glTF skinned), slow, armoured, shockwave punches
//  thane     — the Barrow Thane boss: cleaves, frost nova, summons the dead
import * as THREE from 'three';
import { Actor } from './actor.js';
import { buildHumanoid, buildWolf, buildSentinel } from './models.js';
import { audio } from '../core/audio.js';
import { angleDiff } from '../core/rng.js';

const DEF = {
  wolf: { name: 'Grey Wolf', hp: 38, dmg: 9, speed: 7.2, walk: 1.6, reach: 1.9, aggro: 26, windup: 0.35, cd: 1.2, xp: 18, gold: [0, 4], radius: 0.55 },
  alpha: { name: 'Frost Alpha', hp: 95, dmg: 15, speed: 7.6, walk: 1.8, reach: 2.2, aggro: 30, windup: 0.4, cd: 1.1, xp: 55, gold: [5, 20], radius: 0.7 },
  bandit: { name: 'Bandit', hp: 60, dmg: 12, speed: 5.0, walk: 1.4, reach: 2.2, aggro: 24, windup: 0.55, cd: 1.5, xp: 28, gold: [6, 22] },
  archer: { name: 'Bandit Archer', hp: 42, dmg: 11, speed: 4.6, walk: 1.4, reach: 22, aggro: 32, windup: 1.0, cd: 2.0, xp: 30, gold: [6, 20], ranged: true },
  chief: { name: 'Hrolf the Red, Bandit Chief', hp: 190, dmg: 22, speed: 4.6, walk: 1.3, reach: 2.8, aggro: 26, windup: 0.8, cd: 1.7, xp: 120, gold: [60, 110], boss: true, radius: 0.6 },
  wight: { name: 'Barrow Wight', hp: 72, dmg: 13, speed: 3.6, walk: 1.0, reach: 2.2, aggro: 20, windup: 0.7, cd: 1.6, xp: 40, gold: [3, 15], frost: true },
  sentinel: { name: 'Brass Sentinel', hp: 260, dmg: 26, speed: 3.0, walk: 1.2, reach: 3.0, aggro: 18, windup: 0.9, cd: 2.4, xp: 160, gold: [40, 90], radius: 1.0, heavy: true },
  thane: { name: 'The Barrow Thane', hp: 520, dmg: 28, speed: 3.6, walk: 1.2, reach: 3.2, aggro: 24, windup: 0.85, cd: 1.8, xp: 400, gold: [150, 250], boss: true, radius: 0.9, frost: true, heavy: true },
};

export class Enemy extends Actor {
  constructor(game, type, x, z, o = {}) {
    const d = DEF[type];
    let model;
    if (type === 'wolf' || type === 'alpha') model = buildWolf({ alpha: type === 'alpha' });
    else if (type === 'sentinel') model = buildSentinel();
    else if (type === 'wight' || type === 'thane') model = buildHumanoid({ wight: true, weapon: type === 'thane' ? 'greatsword' : (Math.random() < 0.5 ? 'axe' : 'sword'), tunic: 0x3a3a30, pants: 0x4a4438, armor: type === 'thane' ? 'iron' : 'none', helmet: type === 'thane' ? 'horned' : (Math.random() < 0.4 ? 'iron' : 'none'), cloak: type === 'thane' ? 0x2a2a3a : null, scale: type === 'thane' ? 1.45 : 1.02, glow: 0x7fd8ff, weaponGlow: type === 'thane' ? 0x1a4a6a : 0 });
    else if (type === 'chief') model = buildHumanoid({ weapon: 'greatsword', tunic: 0x7a2a1a, armor: 'iron', helmet: 'horned', cloak: 0x5a4030, faceIdx: 4, scale: 1.15 });
    else model = buildHumanoid({ weapon: type === 'archer' ? 'bow' : (Math.random() < 0.5 ? 'axe' : 'sword'), shield: type === 'bandit' && Math.random() < 0.5 ? 0x8a4a2a : null, tunic: [0x5a3a2a, 0x3a4a3a, 0x4a3a4a][Math.floor(Math.random() * 3)], armor: Math.random() < 0.5 ? 'leather' : 'none', helmet: Math.random() < 0.5 ? 'hood' : 'none', faceIdx: Math.floor(Math.random() * 6), cloak: Math.random() < 0.3 ? 0x8a7a6a : null });
    const tier = game.difficulty ?? 0;
    super(game, model, x, z, { hp: Math.round(d.hp * (1 + tier * 0.1)), radius: d.radius ?? 0.45, name: d.name, faction: 'hostile', wight: type === 'wight' || type === 'thane' });
    this.type = type; this.def = d;
    this.state = 'idle';
    this.timer = Math.random() * 3;
    this.atkCd = 0;
    this.thinkT = Math.random() * 0.3;
    this.sees = false;
    this.wanderTarget = null;
    this.den = o.den;
    this.leash = o.leash ?? 55;
    this.staggerResist = d.heavy ? 0.4 : 1; this.knockResist = d.heavy ? 0.3 : 1;
    if (type === 'sentinel') { this.fireResist = 0.5; this.dmgTaken = 0.85; }
    if (type === 'wight' || type === 'thane') this.fireResist = -0.35; // undead burn well
    this.dormant = !!o.dormant;   // wights sleep in the earth until disturbed
    this.risen = !o.dormant ? 1 : 0;
    if (this.dormant) { this.pos.y -= 2; this.solid = false; }
    this.phase = 0; this.summoned = false; this.novaCd = 8;
    if (type === 'wolf' || type === 'alpha') this.model.yawOffset = 0;
    this._growlT = 0;
  }

  get target() { return this._target; }
  set target(v) { this._target = v; }

  onHurt(from) {
    if (this.dormant) this.wake();
    this.state = 'chase';
    this.target = from;
    // alert the pack / camp
    for (const o of this.game.enemies) if (o !== this && o.alive && o.state !== 'chase' && o.dist2D(this.pos) < 18) { if (o.dormant) o.wake(); o.state = 'chase'; o.target = from; }
  }

  wake() {
    if (!this.dormant) return;
    this.dormant = false; this.rising = 0;
    audio.play('wight', { vol: 0.8 });
    this.game.particles.dust(this.pos.x, this.game.world.h(this.pos.x, this.pos.z), this.pos.z, 20);
  }

  pickTarget() {
    // hostiles fight the player and village guards
    const g = this.game;
    let best = null, bd = this.def.aggro * (g.env.isNight && this.type.startsWith('wolf') ? 1.3 : 1);
    if (!g.player.dead) { const d = this.dist2D(g.player.pos); if (d < bd) { best = g.player; bd = d; } }
    for (const n of g.npcs) if (n.guard && n.alive) { const d = this.dist2D(n.pos); if (d < bd * 0.8) { best = n; bd = d; } }
    return best;
  }

  update(dt) {
    const g = this.game;
    this.updateStatus(dt);
    if (!this.alive) { this.vel.multiplyScalar(0.9); this.physics(dt); this.animate(dt); return; }
    const d = this.def;
    const pd = this.dist2D(g.player.pos);
    if (pd > 160) { this.model.root.visible = false; return; } // far LOD: freeze
    this.model.root.visible = true;

    // dormant wights
    if (this.dormant) {
      if (pd < 12 && !g.player.dead) this.wake();
      this.sync(); return;
    }
    if (this.rising !== undefined && this.rising < 1) {
      this.rising += dt * 0.6;
      this.pos.y = g.world.h(this.pos.x, this.pos.z) - 2 * (1 - this.rising);
      if (Math.random() < 0.5) g.particles.dust(this.pos.x, g.world.h(this.pos.x, this.pos.z), this.pos.z, 2);
      this.faceTowards(g.player.pos, dt, 3);
      if (this.rising >= 1) { this.solid = true; this.state = 'chase'; this.target = g.player; }
      this.animate(dt); return;
    }

    this.thinkT -= dt; this.atkCd -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.25 + Math.random() * 0.15;
      if (this.state === 'idle' || this.state === 'wander' || this.state === 'return') {
        const t = this.pickTarget();
        if (t && !g.world.colliders.blocked(this.pos.x, this.pos.z, t.pos.x, t.pos.z)) {
          this.state = 'chase'; this.target = t;
          if (this.type === 'wolf' || this.type === 'alpha') audio.play('growl', { vol: 0.6, pan: this.pan() });
          if (this.type === 'thane') { g.hud.toast('The Barrow Thane', 'Its gaze freezes the marrow.'); g.bossBar(this); audio.play('wight'); }
          if (this.type === 'chief' || this.type === 'sentinel') g.bossBar(this);
          // pack/camp alert
          for (const o of g.enemies) if (o !== this && o.alive && !o.dormant && o.state !== 'chase' && o.dist2D(this.pos) < 16) { o.state = 'chase'; o.target = t; }
        }
      }
      if (this.state === 'chase') {
        const t = this.target;
        if (!t || !t.alive && t !== g.player || (t === g.player && g.player.dead)) { this.state = 'return'; this.target = null; }
        else if (this.home.distanceTo(this.pos) > this.leash + (d.boss ? 10 : 0) && this.dist2D(t.pos) > 10) { this.state = 'return'; this.target = null; this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.3); }
        // retarget if a guard is much closer
        const nt = this.pickTarget(); if (nt && nt !== t && this.dist2D(nt.pos) < this.dist2D(t.pos) * 0.6) this.target = nt;
      }
    }

    let mx = 0, mz = 0, speed = 0;
    if (this.stagger > 0) { this.anim.attack = -1; this.attacking = null; }
    else if (this.attacking) this.updateAttack(dt);
    else if (this.state === 'chase' && this.target) {
      const t = this.target, td = this.dist2D(t.pos);
      this.faceTowards(t.pos, dt, 7);
      if (d.ranged) {
        // kite: keep 10–18 m and shoot
        if (td < 9) { mx = this.pos.x - t.pos.x; mz = this.pos.z - t.pos.z; speed = d.speed * 0.8; }
        else if (td > 20) { mx = t.pos.x - this.pos.x; mz = t.pos.z - this.pos.z; speed = d.speed; }
        else { const s = Math.sin(this.anim.t * 0.7 + this.home.x); mx = Math.cos(this.yaw) * s; mz = -Math.sin(this.yaw) * s; speed = 1.4; }
        if (this.atkCd <= 0 && td < 26) this.startAttack();
      } else if (td > d.reach * 0.85) {
        mx = t.pos.x - this.pos.x; mz = t.pos.z - this.pos.z; speed = d.speed;
        // wolves circle a little before committing
        if ((this.type === 'wolf') && td < 6 && this.atkCd > 0) { const side = (this.home.x > 0 ? 1 : -1); const tmx = mz * side, tmz = -mx * side; mx = mx * 0.3 + tmx; mz = mz * 0.3 + tmz; speed *= 0.7; }
      } else if (this.atkCd <= 0) this.startAttack();
      // thane specials
      if (this.type === 'thane') this.bossLogic(dt, td);
      if (this.type === 'wolf' || this.type === 'alpha') { this._growlT -= dt; if (this._growlT <= 0 && td < 15) { this._growlT = 3 + Math.random() * 4; audio.play('growl', { vol: 0.4, pan: this.pan() }); } }
    } else if (this.state === 'return') {
      mx = this.home.x - this.pos.x; mz = this.home.z - this.pos.z; speed = d.walk * 2;
      this.faceTowards(this.home, dt, 5);
      if (Math.hypot(mx, mz) < 2) this.state = 'idle';
    } else {
      // idle / wander around home
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 3 + Math.random() * 5;
        if (Math.random() < 0.6) { const a = Math.random() * 6.28, r = Math.random() * 8; this.wanderTarget = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r }; this.state = 'wander'; }
        else { this.wanderTarget = null; this.state = 'idle'; }
      }
      if (this.wanderTarget) {
        mx = this.wanderTarget.x - this.pos.x; mz = this.wanderTarget.z - this.pos.z;
        if (Math.hypot(mx, mz) < 0.8) { this.wanderTarget = null; mx = mz = 0; }
        else { speed = d.walk; this.faceTowards(this.wanderTarget, dt, 4); }
      }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) this.move(dt, mx / ml, mz / ml, speed); else this.move(dt, 0, 0, 0);
    this.physics(dt);
    // wights shed spectral motes; sentinel vents steam
    if ((this.type === 'wight' || this.type === 'thane') && Math.random() < 0.15) g.particles.wisp(this.pos.x, this.pos.y + 0.8, this.pos.z);
    if (this.type === 'sentinel' && Math.random() < 0.1) g.particles.alpha.spawn(this.pos.x, this.pos.y + 2.4, this.pos.z, 0, 1.5, 0, 0.7, 0.7, 0.72, 0.4, 0.4, 1.4, -0.2, 0.5, 2);
    this.animate(dt);
  }

  pan() { const p = this.game.player; const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z; const right = Math.cos(p.yaw) * dx - Math.sin(p.yaw) * dz; return Math.max(-1, Math.min(1, right / 12)); }

  startAttack() {
    const d = this.def;
    this.attacking = { t: 0, windup: d.windup * (0.85 + Math.random() * 0.3), hit: false, kind: d.ranged ? 'shoot' : 'melee' };
    if (this.type === 'thane' && Math.random() < 0.35) this.attacking.kind = 'slam';
    if (this.type === 'chief' && Math.random() < 0.3) this.attacking.kind = 'slam';
    if (this.type === 'sentinel' && Math.random() < 0.4) this.attacking.kind = 'slam';
    if (this.attacking.kind === 'slam') this.attacking.windup *= 1.4;
    this.flash = 0.6;
  }

  updateAttack(dt) {
    const g = this.game, a = this.attacking, d = this.def, t = this.target;
    a.t += dt;
    const total = a.windup + 0.6;
    if (t) this.faceTowards(t.pos, dt, a.t < a.windup ? 6 : 1);
    const k = a.t / total;
    if (a.kind === 'shoot') { this.anim.aim = Math.min(1, a.t / a.windup); }
    else this.anim.attack = Math.min(0.999, k);
    // telegraph glow on windup
    if (a.t < a.windup) { this.flash = Math.max(this.flash, 0.25 * Math.sin(a.t * 30) + 0.2); if (a.kind === 'slam' && Math.random() < 0.5) g.particles.ring(this.pos.x, this.pos.y + 0.1, this.pos.z, 0.6, [1, 0.3, 0.2], 4); }
    // wolves lunge
    if ((this.type === 'wolf' || this.type === 'alpha') && a.t > a.windup * 0.7 && a.t < a.windup + 0.2) { this.vel.x += Math.sin(this.yaw) * 30 * dt; this.vel.z += Math.cos(this.yaw) * 30 * dt; this.lunge = Math.sin(Math.min(1, (a.t - a.windup * 0.7) / 0.35) * Math.PI) * 0.35; } else this.lunge = 0;
    if (!a.hit && a.t >= a.windup) {
      a.hit = true;
      if (a.kind === 'shoot') { if (t) g.shootArrow(this, t); this.anim.aim = 0; audio.play('arrow', { pan: this.pan() }); }
      else if (a.kind === 'slam') {
        g.shockwave(this, this.pos, d.reach + 1.8, d.dmg * 1.2, this.def.frost);
        audio.play('boom', { vol: 0.7, pan: this.pan() });
      } else {
        audio.play(this.type.startsWith('wolf') || this.type === 'alpha' ? 'growl' : 'swing', { vol: 0.7, pan: this.pan() });
        if (t && this.dist2D(t.pos) < d.reach + 0.6 && this.facingDot(t.pos) > 0.3) {
          const dealt = t.damage ? t.damage(d.dmg, this) : t.takeDamage(d.dmg, { from: this, kind: 'melee' });
          if (d.frost && t === g.player && dealt) { g.player.slow = 2.5; g.particles.frost(t.pos.x, t.pos.y + 1.2, t.pos.z, 12); }
          if (dealt) g.particles.blood(t.pos.x, t.pos.y + 1.2, t.pos.z, new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 8);
        }
      }
    }
    if (a.t >= total) { this.attacking = null; this.anim.attack = -1; this.atkCd = d.cd * (0.8 + Math.random() * 0.4); this.lunge = 0; }
  }

  bossLogic(dt, td) {
    const g = this.game;
    this.novaCd -= dt;
    if (this.hp < this.maxHp * 0.55 && !this.summoned) {
      this.summoned = true;
      g.hud.toast('The dead answer their Thane', '');
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const e = g.spawnEnemy('wight', this.pos.x + Math.cos(a) * 6, this.pos.z + Math.sin(a) * 6, { dormant: true });
        e.wake();
      }
    }
    if (this.novaCd <= 0 && td < 9 && !this.attacking) {
      this.novaCd = 9 + Math.random() * 3;
      this.attacking = { t: 0, windup: 1.3, hit: false, kind: 'slam' };
    }
  }
}

export function spawnEnemy(game, type, x, z, o) { return new Enemy(game, type, x, z, o); }
export { DEF as ENEMY_DEFS };
