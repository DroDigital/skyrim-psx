// Loot & boons. Weapons roll a base type, a rarity tier and up to two affixes; perks are the
// roguelike level-up choices (pick 1 of 3).

export const RARITY = [
  { name: 'Common', mult: 1.0, affixes: 0, color: 0xc8c8c8, glow: 0x000000 },
  { name: 'Fine', mult: 1.18, affixes: 0, color: 0x7ed37e, glow: 0x000000 },
  { name: 'Runed', mult: 1.38, affixes: 1, color: 0x6fb0ff, glow: 0x1a3a6a },
  { name: 'Ancient', mult: 1.62, affixes: 2, color: 0xe58cff, glow: 0x4a1a6a },
  { name: 'Legendary', mult: 1.95, affixes: 2, color: 0xffb347, glow: 0x7a3a00 },
];

export const WEAPON_TYPES = {
  sword: { name: 'Sword', dmg: 14, speed: 1.0, reach: 2.7, stamina: 9, model: 'sword' },
  axe: { name: 'War Axe', dmg: 17, speed: 0.88, reach: 2.6, stamina: 11, model: 'axe' },
  mace: { name: 'Mace', dmg: 19, speed: 0.8, reach: 2.5, stamina: 12, model: 'hammer', stagger: 1.4 },
  greatsword: { name: 'Greatsword', dmg: 27, speed: 0.62, reach: 3.2, stamina: 17, model: 'greatsword' },
  dagger: { name: 'Dagger', dmg: 9, speed: 1.55, reach: 2.2, stamina: 6, model: 'sword', short: true, crit: 0.12 },
};

const AFFIXES = [
  { id: 'fire', name: 'of Embers', desc: 'Sets foes ablaze', color: [3, 1.2, 0.3] },
  { id: 'frost', name: 'of Rime', desc: 'Chills and slows foes', color: [0.6, 1.5, 3] },
  { id: 'vamp', name: 'of the Leech', desc: 'Heals 6% of damage dealt', color: [2.5, 0.2, 0.2] },
  { id: 'swift', name: 'of Haste', desc: '+20% attack speed', color: [1, 2, 1] },
  { id: 'crit', name: 'of Ruin', desc: '+15% critical chance', color: [2.5, 2, 0.6] },
  { id: 'storm', name: 'of Storms', desc: 'Chance to call lightning', color: [1.5, 1.5, 3] },
];
const PREFIX = ['Rusted', 'Iron', 'Steel', 'Nordic', 'Barrow', 'Rimeforged', 'Bloodied', 'Old', 'Jarl’s', 'Wolfbite'];
const LEGEND_NAMES = ['Hrimfang', 'Gravewhisper', 'Wyrmtooth', 'Sorrowbrand', 'Ashenmaw', 'Northwind'];

let uid = 1;
export function rollWeapon(rng, tier = 0, forceType) {
  const type = forceType || rng.pick(Object.keys(WEAPON_TYPES));
  const base = WEAPON_TYPES[type];
  const rIdx = Math.min(4, Math.max(0, rng.weighted([[0, 50 - tier * 12], [1, 30], [2, 14 + tier * 6], [3, 5 + tier * 5], [4, 1 + tier * 3]].map(([a, w]) => [a, Math.max(0.5, w)]))));
  const rar = RARITY[rIdx];
  const affixes = rng.shuffle(AFFIXES.slice()).slice(0, rar.affixes);
  const dmg = Math.round(base.dmg * rar.mult * (1 + tier * 0.08) * rng.float(0.92, 1.08));
  let name = rIdx === 4 ? `${rng.pick(LEGEND_NAMES)}, ${base.name}` : `${rng.pick(PREFIX)} ${base.name}`;
  if (affixes.length && rIdx < 4) name += ' ' + affixes[0].name;
  return { uid: uid++, kind: 'weapon', type, name, rarity: rIdx, dmg, speed: base.speed * (affixes.some((a) => a.id === 'swift') ? 1.2 : 1), reach: base.reach, stamina: base.stamina, model: base.model, affixes: affixes.map((a) => a.id), affixData: affixes, value: Math.round(dmg * 6 * rar.mult), stagger: base.stagger ?? 1, crit: base.crit ?? 0 };
}

export function starterWeapon() {
  return { uid: uid++, kind: 'weapon', type: 'sword', name: 'Rusted Sword', rarity: 0, dmg: 12, speed: 1, reach: 2.7, stamina: 9, model: 'sword', affixes: [], affixData: [], value: 20, stagger: 1, crit: 0 };
}

export const PERKS = [
  { id: 'vigor', rune: 'ᚢ', name: 'Ox Blood', desc: '+30 maximum health, fully healed.', apply: (p) => { p.maxHp += 30; p.hp = p.maxHp; } },
  { id: 'arcane', rune: 'ᚨ', name: 'Rune-Touched', desc: '+30 maximum magicka, +25% magicka regen.', apply: (p) => { p.maxMp += 30; p.mpRegen *= 1.25; } },
  { id: 'endure', rune: 'ᛖ', name: 'Long Winter', desc: '+30 maximum stamina, sprinting costs 30% less.', apply: (p) => { p.maxSp += 30; p.sprintCost *= 0.7; } },
  { id: 'might', rune: 'ᛏ', name: 'Tyr’s Arm', desc: '+18% weapon damage.', apply: (p) => { p.dmgMult += 0.18; } },
  { id: 'crit', rune: 'ᚲ', name: 'Keen Eye', desc: '+10% critical chance, crits deal 2.5×.', apply: (p) => { p.crit += 0.1; p.critMult = Math.max(p.critMult, 2.5); } },
  { id: 'leech', rune: 'ᛚ', name: 'Blood Oath', desc: 'Melee hits heal 5% of damage dealt.', apply: (p) => { p.lifesteal += 0.05; } },
  { id: 'fireball', rune: 'ᚦ', name: 'Thurs Flame', desc: 'Firebolt explodes 50% wider and burns longer.', apply: (p) => { p.boltRadius *= 1.5; p.burn += 2; } },
  { id: 'multibolt', rune: 'ᛊ', name: 'Split Sun', desc: 'Firebolt splits into three.', apply: (p) => { p.bolts = Math.max(p.bolts, 3); } },
  { id: 'burst', rune: 'ᛞ', name: 'Thundering Rune', desc: 'Rune Burst recharges 35% faster and hits harder.', apply: (p) => { p.burstCd *= 0.65; p.burstDmg += 20; } },
  { id: 'swift', rune: 'ᚱ', name: 'Wolf Stride', desc: '+12% movement speed. Dodge costs no stamina.', apply: (p) => { p.speedMult += 0.12; p.dashCost = 0; } },
  { id: 'thorns', rune: 'ᚦ', name: 'Bramble Hide', desc: 'Attackers take 8 damage when they strike you.', apply: (p) => { p.thorns += 8; } },
  { id: 'second', rune: 'ᛉ', name: 'Valkyrie’s Mercy', desc: 'Once per run, survive a killing blow.', apply: (p) => { p.secondWind = true; } },
  { id: 'gold', rune: 'ᚠ', name: 'Fehu', desc: 'Find 60% more gold.', apply: (p) => { p.goldMult += 0.6; } },
  { id: 'frostward', rune: 'ᛁ', name: 'Ice Skin', desc: 'Take 15% less damage.', apply: (p) => { p.armor += 0.15; } },
  { id: 'regen', rune: 'ᛃ', name: 'Mead of Life', desc: 'Regenerate 1.5 health per second.', apply: (p) => { p.hpRegen += 1.5; } },
  { id: 'execute', rune: 'ᛗ', name: 'Reaper', desc: 'Deal double damage to foes under 30% health.', apply: (p) => { p.execute = true; } },
];

export function rollPerks(rng, owned, n = 3) {
  const pool = PERKS.filter((p) => !(owned.includes(p.id) && ['multibolt', 'second', 'execute'].includes(p.id)));
  return rng.shuffle(pool.slice()).slice(0, n);
}

export const SHRINE_BLESSINGS = [
  { name: 'Blessing of the Wolf', desc: '+15% speed for the rest of the run', apply: (p) => { p.speedMult += 0.15; } },
  { name: 'Blessing of the Bear', desc: '+25 maximum health', apply: (p) => { p.maxHp += 25; p.hp += 25; } },
  { name: 'Blessing of the Raven', desc: '+15% critical chance', apply: (p) => { p.crit += 0.15; } },
  { name: 'Blessing of the Serpent', desc: 'Melee hits heal 4%', apply: (p) => { p.lifesteal += 0.04; } },
  { name: 'Blessing of the Forge', desc: 'Your weapon is reforged: +25% damage', apply: (p) => { p.dmgMult += 0.25; } },
];
export const SHRINE_CURSES = [
  { name: 'Curse of Frailty', desc: '−20 maximum health, but +30% damage', apply: (p) => { p.maxHp = Math.max(40, p.maxHp - 20); p.hp = Math.min(p.hp, p.maxHp); p.dmgMult += 0.3; } },
  { name: 'Curse of Greed', desc: 'Gold doubled, but take 10% more damage', apply: (p) => { p.goldMult += 1; p.armor -= 0.1; } },
];
