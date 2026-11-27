// DOM HUD rendered crisp at native resolution over the low-res 3D frame —
// the contrast between razor-sharp UI and chunky world pixels is part of the look.
import * as THREE from 'three';
import { RARITY } from '../game/items.js';
import { WORLD_HALF, PLAY_RADIUS } from '../world/terrain.js';

const $ = (s) => document.querySelector(s);

export class HUD {
  constructor() {
    this.el = {
      hud: $('#hud'), compass: $('#compass-strip'), notes: $('#notes'), quests: $('#quest-tracker'), prompt: $('#prompt'),
      hp: $('#bars .health i'), hpLag: $('#bars .health b'), mp: $('#bars .magicka i'), mpLag: $('#bars .magicka b'), sp: $('#bars .stamina i'), spLag: $('#bars .stamina b'),
      hotbar: $('#hotbar'), dmg: $('#dmg-layer'), hurt: $('#vignette-hurt'), water: $('#underwater'), fps: $('#fps'), toast: $('#toast'),
      target: $('#target-bar'), targetName: $('#target-bar .name'), targetFill: $('#target-bar .bar i'), crosshair: $('#crosshair'),
    };
    this.floats = [];
    this.game = null;
    this._toastT = 0;
    this._tick = 0;
  }
  bind(game) { this.game = game; this.el.notes.innerHTML = ''; this.el.dmg.innerHTML = ''; this.floats = []; this.mapBase = null; }
  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  note(text, cls = '') {
    const d = document.createElement('div');
    d.textContent = text; d.className = cls;
    this.el.notes.appendChild(d);
    while (this.el.notes.children.length > 6) this.el.notes.firstChild.remove();
    setTimeout(() => d.remove(), 5000);
  }
  toast(title, sub = '') {
    const t = this.el.toast;
    t.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    t.classList.remove('hidden');
    t.style.opacity = 1;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.style.transition = 'opacity .8s'; t.style.opacity = 0; setTimeout(() => { t.classList.add('hidden'); t.style.transition = ''; }, 800); }, 2600);
  }
  floatText(pos, text, cls = '') {
    const d = document.createElement('div');
    d.className = 'dmg ' + cls; d.textContent = text;
    this.el.dmg.appendChild(d);
    this.floats.push({ el: d, pos: pos.clone(), t: 0, dx: (Math.random() - 0.5) * 30 });
  }

  update(dt, camera, fps) {
    const g = this.game; if (!g) return;
    const p = g.player;
    const pct = (v, m) => Math.max(0, Math.min(100, (v / m) * 100)) + '%';
    this.el.hp.style.width = pct(p.hp, p.maxHp); this.el.hpLag.style.width = pct(p.hp, p.maxHp);
    this.el.mp.style.width = pct(p.mp, p.maxMp); this.el.mpLag.style.width = pct(p.mp, p.maxMp);
    this.el.sp.style.width = pct(p.sp, p.maxSp); this.el.spLag.style.width = pct(p.sp, p.maxSp);
    this.el.hurt.style.opacity = Math.max(p.hurtFlash, p.hp / p.maxHp < 0.25 ? 0.35 + Math.sin(g.time * 5) * 0.15 : 0);
    this.el.water.style.opacity = p.underwater ? 1 : 0;

    this._tick += dt;
    if (this._tick > 0.1) {
      this._tick = 0;
      const burst = p.burstTimer > 0 ? `<span class="cd">ᛞ ${p.burstTimer.toFixed(0)}s</span>` : `<span class="ready">ᛞ Burst</span>`;
      this.el.hotbar.innerHTML = `<span>Lv ${p.level} <span style="opacity:.6">${Math.floor(p.xp)}/${g.xpToNext()}</span></span><span>⚱ ${p.potions}</span>${burst}<span>◎ ${p.gold}g</span><span class="r${p.weapon.rarity}">${p.weapon.name}</span>`;
      this.updateQuests();
      this.el.fps.textContent = `${fps.toFixed(0)} fps · ${g.renderInfo || ''}`;
    }
    this.updateCompass(camera);
    // floating numbers
    const w = innerWidth, h = innerHeight, v = new THREE.Vector3();
    for (const f of this.floats) {
      f.t += dt;
      v.copy(f.pos); v.y += f.t * 1.2;
      v.project(camera);
      if (v.z > 1) { f.el.style.display = 'none'; }
      else { f.el.style.display = ''; f.el.style.left = ((v.x * 0.5 + 0.5) * w + f.dx * f.t) + 'px'; f.el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px'; }
      f.el.style.opacity = Math.max(0, 1 - Math.max(0, f.t - 0.5) * 2);
      if (f.t > 1.1) { f.el.remove(); f.dead = true; }
    }
    this.floats = this.floats.filter((f) => !f.dead);
    // boss / target bar
    const tgt = g.boss && g.boss.alive ? g.boss : g.target && g.target.alive ? g.target : null;
    if (tgt && (tgt === g.boss || tgt.dist2D(p.pos) < 30)) {
      this.el.target.classList.remove('hidden');
      this.el.targetName.textContent = tgt.name;
      this.el.targetFill.style.width = pct(tgt.hp, tgt.maxHp);
      this.el.target.querySelector('.bar').style.width = tgt === g.boss ? '420px' : '220px';
    } else this.el.target.classList.add('hidden');
  }

  setPrompt(it) {
    if (!it) { this.el.prompt.classList.add('hidden'); this.el.crosshair.classList.remove('active'); return; }
    this.el.prompt.classList.remove('hidden');
    this.el.crosshair.classList.add('active');
    this.el.prompt.innerHTML = `<kbd>E</kbd> <span class="verb">${it.verb}</span><br>${it.label}`;
  }

  updateQuests() {
    const g = this.game;
    let html = '';
    for (const q of Object.values(g.quests)) {
      if (q.state === 1 || q.state === 2) {
        const step = q.state === 1 ? (typeof q.step === 'function' ? q.step() : q.step) : q.turnin;
        html += `<div class="q"><div class="q-title">${q.title}</div><div class="q-step">${step}</div></div>`;
      }
    }
    if (!html) html = `<div class="q"><div class="q-title">Rimehold Vale</div><div class="q-step">Speak with the folk of Hrimvik</div></div>`;
    if (html !== this._qhtml) { this.el.quests.innerHTML = html; this._qhtml = html; }
  }

  updateCompass(camera) {
    const g = this.game, p = g.player;
    const heading = -p.yaw; // 0 = north (-z)
    const width = this.el.compass.clientWidth || 500;
    const fov = Math.PI * 0.9;
    const items = [];
    const card = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]];
    for (const [n, a] of card) items.push({ a, html: n, cls: '' });
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; if (i % 6) items.push({ a, html: '|', cls: 'tick' }); }
    const bearing = (x, z) => Math.atan2(x - p.pos.x, -(z - p.pos.z));
    for (const poi of g.world.pois) {
      if (poi.hidden && Math.hypot(poi.x - p.pos.x, poi.z - p.pos.z) > 70) continue;
      if (poi.used) continue;
      items.push({ a: bearing(poi.x, poi.z), html: poi.icon, cls: 'mk poi' });
    }
    for (const q of Object.values(g.quests)) { const t = g.questTarget(q); if (t) items.push({ a: bearing(t.x, t.z), html: '▼', cls: 'mk quest' }); }
    for (const e of g.enemies) if (e.alive && !e.dormant && e.state === 'chase' && e.dist2D(p.pos) < 40) items.push({ a: bearing(e.pos.x, e.pos.z), html: '●', cls: 'mk enemy' });
    let html = '';
    for (const it of items) {
      let d = it.a - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > fov / 2) continue;
      const x = (d / fov + 0.5) * width;
      html += `<span class="${it.cls}" style="left:${x.toFixed(1)}px">${it.html}</span>`;
    }
    this.el.compass.innerHTML = html;
  }

  // ---------------- screens ----------------
  renderDialogue(npc, node, onPick) {
    $('.dlg-name').textContent = npc.name;
    $('.dlg-text').textContent = node.text;
    const box = $('.dlg-options');
    box.innerHTML = '';
    node.options.forEach((o, i) => {
      const d = document.createElement('div');
      d.innerHTML = `<span style="opacity:.5;font-family:var(--pixel);font-size:13px">${i + 1}</span> <span class="${o.cls || ''}">${o.label}</span>${o.price ? `<span class="price">${o.price}g</span>` : ''}`;
      d.onclick = () => onPick(o);
      box.appendChild(d);
    });
  }

  renderInventory(onEquip) {
    const g = this.game, p = g.player;
    const st = [
      ['Level', p.level], ['Experience', `${Math.floor(p.xp)} / ${g.xpToNext()}`], ['Health', `${Math.ceil(p.hp)} / ${p.maxHp}`], ['Magicka', `${Math.ceil(p.mp)} / ${p.maxMp}`], ['Stamina', `${Math.ceil(p.sp)} / ${p.maxSp}`],
      ['Weapon damage', Math.round(p.weapon.dmg * p.dmgMult)], ['Critical chance', Math.round((p.crit + p.weapon.crit) * 100) + '%'], ['Damage resist', Math.round(p.armor * 100) + '%'], ['Gold', p.gold], ['Healing draughts', p.potions],
      ['Run seed', g.seed], ['Foes slain', g.stats.kills],
    ];
    $('#char-stats').innerHTML = st.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    const perks = p.perks.map((id) => g.perkById(id)).filter(Boolean);
    $('#char-perks').innerHTML = perks.length ? perks.map((k) => `<div class="perk"><b>${k.rune} ${k.name}</b> — ${k.desc}</div>`).join('') : '<div class="perk" style="opacity:.6">No boons yet. Level up to choose.</div>';
    const list = $('#inv-list');
    list.innerHTML = '';
    for (const it of p.inventory) {
      const d = document.createElement('div');
      d.className = 'item' + (it === p.weapon ? ' eq' : '');
      const aff = (it.affixData || []).map((a) => a.desc).join(' · ');
      d.innerHTML = `<div><div class="r${it.rarity}">${it === p.weapon ? '⚔ ' : ''}${it.name}</div><div class="meta">${RARITY[it.rarity].name} · ${it.dmg} dmg · ${it.speed.toFixed(2)} spd${aff ? ' · ' + aff : ''}</div></div><div class="meta">${it === p.weapon ? 'equipped' : 'click to equip'}</div>`;
      d.onclick = () => { onEquip(it); this.renderInventory(onEquip); };
      list.appendChild(d);
    }
  }

  renderMap() {
    const g = this.game, w = g.world, t = w.terrain;
    const cv = $('#map-canvas'), ctx = cv.getContext('2d');
    const S = cv.width;
    const R = PLAY_RADIUS + 25;
    const toMap = (x, z) => [((x + R) / (2 * R)) * S, ((z + R) / (2 * R)) * S];
    if (!this.mapBase) {
      const img = ctx.createImageData(S, S);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const x = (i / S) * 2 * R - R, z = (j / S) * 2 * R - R;
        const h = t.heightAt(x, z);
        const hl = t.heightAt(x - 1.5, z - 1.5);
        const shade = Math.max(0.35, Math.min(1.35, 1 + (h - hl) * 0.12));
        const s = t.splatAt(x, z);
        let c = [176, 160, 120];
        if (h < 3) c = [92, 112, 120];
        else if (s.snow > 0.5) c = [226, 222, 210];
        else if (s.rock > 0.5) c = [150, 140, 120];
        else if (s.dirt > 0.4) c = [168, 136, 96];
        else c = [140, 146, 98];
        const contour = Math.abs((h % 8) - 0) < 0.35 ? 0.85 : 1;
        const k = (j * S + i) * 4;
        img.data[k] = c[0] * shade * contour; img.data[k + 1] = c[1] * shade * contour; img.data[k + 2] = c[2] * shade * contour; img.data[k + 3] = 255;
      }
      this.mapBase = img;
    }
    ctx.putImageData(this.mapBase, 0, 0);
    // parchment vignette
    const grd = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.72);
    grd.addColorStop(0, 'rgba(60,40,10,0)'); grd.addColorStop(1, 'rgba(40,25,5,0.55)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
    ctx.font = '600 13px "IM Fell English", serif'; ctx.textAlign = 'center';
    for (const poi of w.pois) {
      if (poi.hidden && !poi.seen) { const d = Math.hypot(poi.x - g.player.pos.x, poi.z - g.player.pos.z); if (d < 60) poi.seen = true; else continue; }
      const [x, y] = toMap(poi.x, poi.z);
      ctx.fillStyle = poi.used ? 'rgba(40,30,20,.5)' : '#2a1d10';
      ctx.font = '18px serif'; ctx.fillText(poi.icon, x, y + 6);
      ctx.font = '600 13px "IM Fell English", serif'; ctx.fillText(poi.name, x, y + 22);
    }
    for (const q of Object.values(g.quests)) {
      const tp = g.questTarget(q); if (!tp) continue;
      const [x, y] = toMap(tp.x, tp.z);
      ctx.strokeStyle = '#a8321e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
    }
    const [px, py] = toMap(g.player.pos.x, g.player.pos.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-g.player.yaw + Math.PI);
    ctx.fillStyle = '#b8352b'; ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(6, -6); ctx.lineTo(0, -2); ctx.lineTo(-6, -6); ctx.closePath(); ctx.fill();
    ctx.restore();
    $('.map-legend').textContent = `Rimehold Vale — seed ${g.seed} · ⌂ village  ⚔ camp  ☗ barrow  ♜ ruins  ᛟ shrine  ◯ quest`;
  }

  renderLevelUp(level, perks, onPick) {
    $('#lvl-num').textContent = level;
    const box = $('#perk-choices');
    box.innerHTML = '';
    perks.forEach((k, i) => {
      const d = document.createElement('div');
      d.className = 'perk-card';
      d.innerHTML = `<div class="rune">${k.rune}</div><div class="pn">${k.name}</div><div class="pd">${k.desc}</div><div style="margin-top:8px;font-family:var(--pixel);font-size:12px;opacity:.5">${i + 1}</div>`;
      d.onclick = () => onPick(k);
      box.appendChild(d);
    });
  }

  renderRunStats(sel, extra = []) {
    const g = this.game, s = g.stats;
    const mins = Math.floor(g.time / 60), secs = Math.floor(g.time % 60);
    const rows = [...extra, ['Seed', g.seed], ['Level reached', g.player.level], ['Foes slain', s.kills], ['Champions felled', s.bossesSlain], ['Gold gathered', s.gold], ['Chests opened', s.chests], ['Shrines touched', s.shrines], ['Damage dealt', s.damage], ['Time in the vale', `${mins}m ${secs.toString().padStart(2, '0')}s`]];
    document.querySelector(sel + ' .run-stats').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
  }
}
