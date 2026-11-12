// Villagers of Hrimvik: quest-givers, traders, ambient folk and guards who defend the village.
import * as THREE from 'three';
import { Actor } from './actor.js';
import { buildHumanoid } from './models.js';
import { rollWeapon, RARITY } from '../game/items.js';
import { audio } from '../core/audio.js';

export class NPC extends Actor {
  constructor(game, x, z, o) {
    const model = buildHumanoid(o.look);
    super(game, model, x, z, { hp: o.hp ?? 120, name: o.name, faction: 'village', yaw: o.yaw });
    this.role = o.role;
    this.guard = !!o.guard;
    this.wanderR = o.wanderR ?? 4;
    this.dialogue = o.dialogue;
    this.timer = Math.random() * 4;
    this.wanderTarget = null;
    this.talking = false;
    this.atkCd = 0;
    this.dmg = o.dmg ?? 14;
    this.essential = !o.guard; // villagers can't die in the showcase; guards can
  }

  takeDamage(amount, info) {
    if (this.essential) { this.flash = 1; this.anim.hit = 1; return 0; }
    return super.takeDamage(amount, info);
  }

  update(dt) {
    const g = this.game;
    this.updateStatus(dt);
    if (!this.alive) { this.physics(dt); this.animate(dt); return; }
    const pd = this.dist2D(g.player.pos);
    if (pd > 150) { this.model.root.visible = false; return; }
    let mx = 0, mz = 0, speed = 0;
    this.anim.talk = this.talking;
    this.anim.attack = -1;

    // guards engage hostiles that come near the village
    if (this.guard) {
      this.atkCd -= dt;
      let foe = null, fd = 26;
      for (const e of g.enemies) if (e.alive && !e.dormant) { const d = this.dist2D(e.pos); if (d < fd) { fd = d; foe = e; } }
      if (foe && this.home.distanceTo(foe.pos) < 40) {
        this.faceTowards(foe.pos, dt, 8);
        if (fd > 2.2) { mx = foe.pos.x - this.pos.x; mz = foe.pos.z - this.pos.z; speed = 5; }
        else if (this.atkCd <= 0) { this.atkCd = 1.3; this.swing = 0; }
      }
      if (this.swing !== undefined && this.swing >= 0) {
        this.swing += dt / 0.7;
        this.anim.attack = Math.min(0.999, this.swing);
        if (this.swing > 0.55 && !this.swingHit && foe) { this.swingHit = true; if (this.dist2D(foe.pos) < 2.8) { foe.takeDamage(this.dmg, { from: this, kind: 'melee', stagger: 0.3 }); g.particles.blood(foe.pos.x, foe.pos.y + 1, foe.pos.z, new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 6); audio.play('hit', { vol: 0.5 }); } }
        if (this.swing >= 1) { this.swing = -1; this.swingHit = false; }
      }
      if (foe) { this.finishMove(dt, mx, mz, speed); return; }
    }

    if (this.talking) {
      this.faceTowards(g.player.pos, dt, 6);
    } else if (pd < 4 && !this.guard) {
      this.faceTowards(g.player.pos, dt, 3);
      this.wanderTarget = null;
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 4 + Math.random() * 6;
        if (Math.random() < 0.55) { const a = Math.random() * 6.28, r = Math.random() * this.wanderR; this.wanderTarget = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r }; }
        else this.wanderTarget = null;
      }
      if (this.wanderTarget) {
        mx = this.wanderTarget.x - this.pos.x; mz = this.wanderTarget.z - this.pos.z;
        if (Math.hypot(mx, mz) < 0.6) { this.wanderTarget = null; mx = mz = 0; } else { speed = 1.3; this.faceTowards(this.wanderTarget, dt, 4); }
      }
    }
    // head tracks the player when near
    if (pd < 6) {
      const want = Math.atan2(g.player.pos.x - this.pos.x, g.player.pos.z - this.pos.z) - this.yaw;
      const a = Math.atan2(Math.sin(want), Math.cos(want));
      this.anim.lookYaw = Math.max(-0.9, Math.min(0.9, a));
    } else this.anim.lookYaw = (this.anim.lookYaw || 0) * 0.9;
    this.finishMove(dt, mx, mz, speed);
  }

  finishMove(dt, mx, mz, speed) {
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) this.move(dt, mx / ml, mz / ml, speed); else this.move(dt, 0, 0, 0);
    this.physics(dt);
    this.animate(dt);
  }
}

// ---------------- cast & dialogue ----------------
export function spawnVillagers(game) {
  const S = game.world.spawns.npcs;
  const npcs = [];
  const r = game.rng.fork('npcs');
  const add = (p, o) => { if (!p) return; const n = new NPC(game, p.x, p.z, o); npcs.push(n); return n; };

  add(S.elder, { name: 'Elder Sigrun', role: 'elder', look: { tunic: 0x2a3a5a, cloak: 0xc8c0b0, faceIdx: 3, hair: 0xc0c0c0, weapon: 'staff', glow: 0x7fd8ff }, wanderR: 2, dialogue: elderDialogue });
  add(S.smith, { name: 'Halvar the Smith', role: 'smith', look: { tunic: 0x5a4030, armor: 'leather', faceIdx: 0, weapon: 'hammer' }, wanderR: 1.5, dialogue: smithDialogue });
  add(S.merchant, { name: 'Ylva Brightmead', role: 'merchant', look: { tunic: 0x6a2a3a, faceIdx: 5, hair: 0xc8a060, weapon: 'none' }, wanderR: 1.2, dialogue: merchantDialogue });
  add(S.hunter, { name: 'Old Bjorn', role: 'hunter', look: { tunic: 0x4a5a3a, cloak: 0x7a6a50, helmet: 'hood', faceIdx: 2, weapon: 'bow' }, wanderR: 6, dialogue: hunterDialogue });
  const villagerLines = [
    'The wind carries voices from the barrow at night. I keep the shutters closed.',
    'Mind the wolves past the tree line. They come bolder when the lights dance in the sky.',
    'Ylva’s mead is the only warm thing left in this vale.',
    'My grandmother said the Thane was buried with his sword because he could not be parted from it, even in death.',
    'Have you seen the old rune shrines? Touch them, if you dare. Some bless. Some bite.',
  ];
  (S.villagers || []).forEach((p, i) => add(p, { name: ['Asa', 'Torvald', 'Freydis'][i], role: 'villager', look: { tunic: [0x7a5a3a, 0x3a5a6a, 0x6a6a3a][i], faceIdx: i + 1, weapon: 'none' }, wanderR: 9, dialogue: (g, n) => ({ text: villagerLines[(i + Math.floor(g.time / 60)) % villagerLines.length], options: [{ label: 'Farewell.', action: () => null }] }) }));
  (S.guards || []).forEach((p, i) => {
    const n = add(p, { name: i === 0 ? 'Captain Eirik' : 'Hrimvik Guard', role: i === 0 ? 'captain' : 'guard', guard: true, hp: 160, look: { tunic: 0x6a2a20, armor: 'iron', helmet: 'iron', shield: 0x6a2a20, weapon: 'sword', faceIdx: 4 + i }, wanderR: 3, dialogue: i === 0 ? captainDialogue : guardDialogue, dmg: 16 });
  });
  // smith stock rolled for this run
  game.smithStock = [rollWeapon(r, 1), rollWeapon(r, 2), rollWeapon(r, 2, 'greatsword'), rollWeapon(r, 3)].map((w) => ({ ...w, price: Math.round(w.value * 1.6 + 40) }));
  return npcs;
}

const bye = { label: 'Farewell.', action: () => null };

function elderDialogue(g) {
  const q = g.quests.barrow;
  if (q.state === 0) return {
    text: 'You have the look of one the runes have marked. Listen: the barrow on the hill has woken. Its Thane walks again, and his dead walk with him. Every night the cold creeps closer to our hearths.',
    options: [
      { label: 'I will put the Thane back in his grave.', action: () => { g.startQuest('barrow'); return { text: 'Then go with the old gods. Draugmoor Barrow lies along the road, past the standing stones. Strike at the dead with fire — they fear it still.', options: [bye] }; } },
      { label: 'Tell me of this vale.', action: () => ({ text: 'Rimehold Vale. Hrimvik is all that’s left of a dozen holds. Bandits squat in the east, wolves rule the pines, and the brass guardian of the Old Watch still stands its post after a thousand winters.', options: [{ label: 'About the barrow…', action: () => elderDialogue(g) }, bye] }) },
      bye,
    ],
  };
  if (q.state === 1) return { text: 'The Thane still breathes his frost upon us. Draugmoor waits.', options: [bye] };
  if (q.state === 2) return { text: 'It is done… I felt the cold lift from my bones. Hrimvik owes you more than gold — but gold is what we have.', options: [{ label: 'Accept the reward. (+300 gold)', action: () => { g.completeQuest('barrow'); g.addGold(300); return null; } }] };
  return { text: 'Skál, Thane-breaker. The vale sleeps easier.', options: [bye] };
}

function hunterDialogue(g) {
  const q = g.quests.wolves;
  if (q.state === 0) return {
    text: 'Wolves took two of my dogs this week. A pack runs the pines, and there’s a white-furred alpha leading them. Thin them out and I’ll make it worth your while.',
    options: [{ label: 'I’ll hunt them. (Slay 5 wolves)', action: () => { g.startQuest('wolves'); return null; } }, bye],
  };
  if (q.state === 1) return { text: `${q.count}/${q.goal} wolves so far. Keep at it.`, options: [bye] };
  if (q.state === 2) return { text: 'Ha! You smell of wolf and blood. Here — take this, and my best draughts.', options: [{ label: 'Accept the reward. (+120 gold, 2 draughts)', action: () => { g.completeQuest('wolves'); g.addGold(120); g.player.potions += 2; return null; } }] };
  return { text: 'The pines are quieter. My dogs would have thanked you.', options: [bye] };
}

function captainDialogue(g) {
  const q = g.quests.bandits;
  if (q.state === 0) return {
    text: 'Halt. …You’re no bandit. Good. Hrolf the Red and his cutthroats camp to the east and tax our road in blood. I can’t leave the gate. You can.',
    options: [{ label: 'Hrolf’s days are numbered. (Slay the Bandit Chief)', action: () => { g.startQuest('bandits'); return null; } }, bye],
  };
  if (q.state === 1) return { text: 'Hrolf still breathes. Bleakrock Camp, east road.', options: [bye] };
  if (q.state === 2) return { text: 'Hrolf’s dead? Then take this blade from our armoury. It’s served better hands than mine.', options: [{ label: 'Accept the reward. (Runed weapon)', action: () => { g.completeQuest('bandits'); g.giveItem(rollWeapon(g.rng.fork('capt' + g.time), 3)); return null; } }] };
  return { text: 'The road is safe for the first time in a year. Well fought.', options: [bye] };
}
function guardDialogue() { return { text: 'Keep your blade sheathed inside the palisade, traveller.', options: [bye] }; }

function smithDialogue(g) {
  const q = g.quests.watch;
  const opts = [];
  opts.push({ label: 'Show me your blades.', action: () => smithShop(g) });
  if (q.state === 0) opts.push({ label: 'Any work for a sword-arm?', action: () => ({ text: 'Aye. The brass guardian at the Old Watch — its heart is a forge-core, older than any kingdom. Bring it down and I’ll fold that metal into your blade.', options: [{ label: 'I’ll fetch your core. (Destroy the Brass Sentinel)', action: () => { g.startQuest('watch'); return null; } }, bye] }) });
  if (q.state === 2) opts.push({ label: 'I have the forge-core.', action: () => { g.completeQuest('watch'); g.player.weapon.dmg = Math.round(g.player.weapon.dmg * 1.3); g.player.weapon.name = 'Brass-Folded ' + g.player.weapon.name; audio.play('clang'); return { text: 'Hah! Feel the weight of that. Your blade bites a third deeper now.', options: [bye] }; } });
  opts.push(bye);
  return { text: 'Steel or stories? I only sell one of them.', options: opts };
}
function smithShop(g) {
  return {
    text: `Pick your steel. (You have ${g.player.gold} gold)`,
    options: [
      ...g.smithStock.map((w) => ({ label: `${w.name} — ${w.dmg} dmg`, cls: 'r' + w.rarity, price: w.price, action: () => {
        if (g.player.gold < w.price) return { text: 'Come back with more coin.', options: [{ label: 'Back', action: () => smithShop(g) }] };
        g.player.gold -= w.price; g.smithStock = g.smithStock.filter((x) => x !== w); g.giveItem(w, true); audio.play('coins');
        return smithShop(g);
      } })),
      { label: 'Enough browsing.', action: () => null },
    ],
  };
}

function merchantDialogue(g) {
  return {
    text: `Mead, draughts, and gossip — all fresh. (You have ${g.player.gold} gold)`,
    options: [
      { label: 'Healing Draught', price: 30, action: () => { if (g.player.gold < 30) return { text: 'No coin, no draught, love.', options: [bye] }; g.player.gold -= 30; g.player.potions++; audio.play('coins'); g.hud.note('Healing Draught added. (' + g.player.potions + ')', 'gold'); return merchantDialogue(g); } },
      { label: 'Tonic of the Deep Well (+15 max magicka)', price: 120, action: () => { if (g.player.gold < 120) return { text: 'That one costs dear. Come back richer.', options: [bye] }; g.player.gold -= 120; g.player.maxMp += 15; g.player.mp += 15; audio.play('drink'); return merchantDialogue(g); } },
      { label: 'Any gossip?', action: () => ({ text: 'They say the Thane’s crypt holds a blade that never warms. And that the brass thing at the Old Watch hums when the aurora is out. Make of that what you will.', options: [{ label: 'Back', action: () => merchantDialogue(g) }, bye] }) },
      bye,
    ],
  };
}
