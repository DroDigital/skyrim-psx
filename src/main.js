// RIMEHOLD — entry point & app state machine.
// Raw three.js as a rasteriser, everything else (frame graph, shaders, world, AI, UI) hand-written.
import * as THREE from 'three';
import GUI from 'lil-gui';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { randomSeedName } from './core/rng.js';
import { buildTextures } from './render/textures.js';
import { Pipeline } from './render/pipeline.js';
import { PRESETS, presetById } from './render/presets.js';
import { WEATHERS } from './render/sky.js';
import { setModelTextures, loadCreatureAssets } from './entities/models.js';
import { Game } from './game/game.js';
import { HUD } from './ui/hud.js';
import { PERKS } from './game/items.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
const pipeline = new Pipeline(renderer);
const input = new Input(canvas);
const hud = new HUD();
const T = buildTextures();
setModelTextures(T);

let settings = { ...presetById('hybrid').s };
let presetId = 'hybrid';
try { const saved = localStorage.getItem('rimehold.preset'); if (saved && PRESETS.some((p) => p.id === saved)) { presetId = saved; settings = { ...presetById(saved).s }; } } catch (_) {}
pipeline.apply(settings);

let game = null;
let mode = 'title';        // title | loading | play | paused | dialogue | inventory | map | levelup | dead | victory | graphics | controls
let returnTo = 'title';
let titleAngle = 0;
let dialogueNode = null, dialogueNpc = null;
let perkChoices = [];

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  pipeline.setSize(w, h);
  if (game) { game.player.camera.aspect = w / h; game.player.camera.updateProjectionMatrix(); }
}
addEventListener('resize', resize);

// ---------------- screens ----------------
const screens = ['title', 'loading', 'pause', 'graphics', 'controls', 'dialogue', 'inventory', 'map', 'levelup', 'death', 'victory'];
function showScreen(id) { for (const s of screens) $('#' + s).classList.toggle('hidden', s !== id); }

function setMode(m) {
  mode = m;
  const map = { title: 'title', loading: 'loading', play: null, paused: 'pause', dialogue: 'dialogue', inventory: 'inventory', map: 'map', levelup: 'levelup', dead: 'death', victory: 'victory', graphics: 'graphics', controls: 'controls' };
  showScreen(map[m]);
  hud.show(game && ['play', 'dialogue', 'paused', 'inventory', 'map', 'levelup', 'graphics', 'controls'].includes(m) && returnTo !== 'title');
  if (m === 'play') input.lock(); else if (m !== 'loading') input.unlock();
}

input.onLockChange = (locked) => {
  if (!locked && mode === 'play') setMode('paused');
};

// ---------------- graphics mixes ----------------
function buildPresetGrid() {
  const grid = $('#preset-grid');
  grid.innerHTML = '';
  for (const p of PRESETS) {
    const d = document.createElement('div');
    d.className = 'preset' + (p.id === presetId ? ' active' : '');
    d.innerHTML = `<div class="p-name">${p.name}<span class="p-key"><kbd>${p.key}</kbd></span></div><div class="p-desc">${p.desc}</div><div class="p-tags">${p.tags}</div>`;
    d.onclick = () => { applyPreset(p.id); buildPresetGrid(); audio.play('ui'); };
    grid.appendChild(d);
  }
}
function applyPreset(id, announce = false) {
  presetId = id;
  settings = { ...presetById(id).s };
  pipeline.apply(settings);
  if (game) { game.player.baseFov = settings.fov; game.env.fogMul = settings.fogMul; game.player.camera.far = settings.drawDistance; }
  try { localStorage.setItem('rimehold.preset', id); } catch (_) {}
  refreshGui();
  if (announce) hud.toast(presetById(id).name, presetById(id).tags);
}

// lil-gui tuning panel (G)
const gui = new GUI({ title: 'RIMEHOLD · render tuning' });
gui.hide();
const guiCtl = [];
function addCtl(folder, key, ...args) { const c = folder.add(settings, key, ...args).onChange(() => { pipeline.apply(settings); if (game) { game.player.baseFov = settings.fov; game.env.fogMul = settings.fogMul; } }); guiCtl.push(c); return c; }
{
  const f1 = gui.addFolder('1997');
  addCtl(f1, 'resHeight', 0, 720, 1).name('internal height (0=native)');
  addCtl(f1, 'vertexSnap').name('vertex snapping');
  addCtl(f1, 'snapDiv', 1, 8, 0.5).name('snap coarseness');
  addCtl(f1, 'affine', 0, 1, 0.01).name('affine warp');
  addCtl(f1, 'colorBits', 0, 8, 1).name('bits / channel');
  addCtl(f1, 'dither', 0, 2, 0.05).name('ordered dither');
  addCtl(f1, 'palette').name('16-colour palette');
  addCtl(f1, 'lightSteps', 0, 8, 1).name('light banding');
  addCtl(f1, 'smoothTextures').name('trilinear textures');
  addCtl(f1, 'pixelLighting').name('per-pixel lighting');
  const f2 = gui.addFolder('Modern');
  addCtl(f2, 'shadows').name('shadow maps');
  addCtl(f2, 'shadowRes', [1024, 2048, 4096]).name('shadow res');
  addCtl(f2, 'shadowSoft', 0, 4, 0.1).name('PCF softness');
  addCtl(f2, 'shadowDist', 20, 120, 1).name('shadow distance');
  addCtl(f2, 'bloom', 0, 2, 0.01).name('bloom');
  addCtl(f2, 'bloomThreshold', 0.2, 3, 0.05).name('bloom threshold');
  addCtl(f2, 'godRays', 0, 2, 0.01).name('god rays');
  addCtl(f2, 'rim', 0, 2, 0.01).name('rim light');
  addCtl(f2, 'softParticles').name('soft particles');
  addCtl(f2, 'outline', 0, 1, 0.01).name('ink outlines');
  const f3 = gui.addFolder('Grade & Display');
  addCtl(f3, 'exposure', 0.3, 3, 0.01);
  addCtl(f3, 'saturation', 0, 2, 0.01);
  addCtl(f3, 'contrast', 0.5, 1.6, 0.01);
  addCtl(f3, 'splitTone', 0, 0.4, 0.01).name('split tone');
  addCtl(f3, 'vignette', 0, 1.2, 0.01);
  addCtl(f3, 'grain', 0, 0.2, 0.005);
  addCtl(f3, 'crt').name('CRT');
  addCtl(f3, 'vhs').name('PAL VHS');
  addCtl(f3, 'fov', 50, 100, 1).name('field of view');
  addCtl(f3, 'fogMul', 0.2, 4, 0.05).name('fog density');
  f2.close(); f3.close();
}
function refreshGui() { for (const c of guiCtl) { c.object = settings; c.updateDisplay(); } }

// ---------------- runs ----------------
async function newRun(seed) {
  setMode('loading');
  returnTo = 'play';
  const bar = $('.loading-bar i'), txt = $('.loading-text');
  const prog = (p, t) => { bar.style.width = Math.round(p * 100) + '%'; if (t) txt.textContent = t + '…'; };
  prog(0.02, 'Forging the vale');
  await new Promise((r) => setTimeout(r, 30));
  if (game) { game.dispose(); game = null; }
  game = await buildGame(seed, prog);
  hud.bind(game);
  game.stats.start = performance.now();
  prog(1, 'Ready');
  hud.toast('Rimehold Vale', `Seed ${seed}`);
  hud.note('Speak with Elder Sigrun in the great hall. [E] to talk.', 'gold');
  setMode('play');
  hud.show(true);
}

async function buildGame(seed, prog) {
  prog && prog(0.05, 'Forging the vale');
  await new Promise((r) => setTimeout(r, 16));
  const g = new Game({ seed, T, hud, onProgress: (p, t) => prog && prog(p, t) });
  g.player.baseFov = settings.fov;
  g.env.fogMul = settings.fogMul;
  g.player.camera.aspect = innerWidth / innerHeight;
  g.player.camera.far = settings.drawDistance;
  g.player.camera.updateProjectionMatrix();
  return g;
}

let titleGame = null;
async function bootTitle() {
  setMode('loading');
  const seed = randomSeedName();
  $('#seed-input').value = seed;
  await loadCreatureAssets();
  titleGame = await buildGame(seed, (p, t) => { $('.loading-bar i').style.width = Math.round(p * 100) + '%'; if (t) $('.loading-text').textContent = t + '…'; });
  game = titleGame;
  hud.bind(game);
  returnTo = 'title';
  setMode('title');
  hud.show(false);
  try {
    const runs = JSON.parse(localStorage.getItem('rimehold.runs') || '{"runs":0,"wins":0,"best":0}');
    $('#title-foot').textContent = runs.runs ? `Runs ${runs.runs} · Victories ${runs.wins} · Best level ${runs.best}` : 'Every run is a new vale. Death is permanent.';
  } catch (_) { $('#title-foot').textContent = 'Every run is a new vale. Death is permanent.'; }
  window.__ready = true;
}

function recordRun(win) {
  try {
    const runs = JSON.parse(localStorage.getItem('rimehold.runs') || '{"runs":0,"wins":0,"best":0}');
    runs.runs++; if (win) runs.wins++; runs.best = Math.max(runs.best, game.player.level);
    localStorage.setItem('rimehold.runs', JSON.stringify(runs));
  } catch (_) {}
}

// ---------------- button wiring ----------------
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  audio.init();
  audio.play('ui');
  const act = b.dataset.act;
  if (act === 'start') {
    const seed = ($('#seed-input').value || randomSeedName()).toUpperCase();
    if (titleGame && seed === titleGame.seed) { game = titleGame; titleGame = null; hud.bind(game); returnTo = 'play'; hud.toast('Rimehold Vale', `Seed ${seed}`); hud.note('Speak with Elder Sigrun in the great hall. [E] to talk.', 'gold'); setMode('play'); hud.show(true); }
    else newRun(seed);
  }
  if (act === 'resume') setMode('play');
  if (act === 'graphics') { returnTo = mode === 'title' ? 'title' : 'paused'; buildPresetGrid(); setMode('graphics'); }
  if (act === 'controls') { returnTo = mode === 'title' ? 'title' : 'paused'; setMode('controls'); }
  if (act === 'back') setMode(returnTo === 'title' ? 'title' : 'paused');
  if (act === 'abandon') { recordRun(false); toTitle(); }
  if (act === 'newrun') newRun(randomSeedName());
  if (act === 'totitle') toTitle();
  if (act === 'continue') { game.victoryShown = true; setMode('play'); }
});
async function toTitle() { game && game.dispose(); game = null; titleGame = null; await bootTitle(); }

$('#seed-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('button[data-act="start"]').click(); });
canvas.addEventListener('click', () => { audio.init(); if (mode === 'play' && !input.locked) input.lock(); });

// ---------------- dialogue ----------------
function openDialogue(npc) {
  dialogueNpc = npc; npc.talking = true;
  dialogueNode = npc.dialogue(game, npc);
  setMode('dialogue');
  hud.renderDialogue(npc, dialogueNode, pickOption);
}
function pickOption(o) {
  audio.play('ui');
  const next = o.action();
  if (!next) { closeDialogue(); return; }
  dialogueNode = next;
  hud.renderDialogue(dialogueNpc, dialogueNode, pickOption);
}
function closeDialogue() { if (dialogueNpc) dialogueNpc.talking = false; dialogueNpc = null; setMode('play'); }

// ---------------- loop ----------------
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (!game) { input.endFrame(); return; }

  // global hotkeys
  for (const p of PRESETS) if (input.hit('Digit' + p.key) && mode !== 'dialogue' && mode !== 'levelup') applyPreset(p.id, true);
  if (input.hit('KeyG')) gui._hidden ? gui.show() : gui.hide();

  if (mode === 'title' || mode === 'graphics' && returnTo === 'title' || mode === 'controls' && returnTo === 'title' || mode === 'loading') {
    // slow cinematic orbit over the vale
    titleAngle += dt * 0.03;
    const V = game.world.layout.village;
    const cam = game.player.camera;
    const r = 85;
    const x = V.x + Math.cos(titleAngle) * r, z = V.z + Math.sin(titleAngle) * r;
    cam.position.set(x, Math.max(game.world.h(x, z) + 22, game.world.h(V.x, V.z) + 34), z);
    cam.fov = settings.fov; cam.updateProjectionMatrix();
    cam.lookAt(V.x, game.world.h(V.x, V.z) + 4, V.z);
    game.time += dt;
    game.env.update(dt * 4, false);
    game.sky.position.copy(cam.position);
    game.world.update(dt, game.time, cam.position, game.particles);
    game.particles.update(dt);
    game.snow.update(cam, game.env.weather === 'snow' ? game.env.weatherT : 0);
    pipeline.render(game.scene, cam, null, null, game.env);
    input.endFrame();
    return;
  }

  if (mode === 'play') {
    if (input.hit('Tab') || input.hit('KeyI')) { setMode('inventory'); hud.renderInventory((it) => game.player.equip(it)); }
    else if (input.hit('KeyM')) { setMode('map'); hud.renderMap(); }
    else if (input.hit('KeyY')) { const i = WEATHERS.indexOf(game.env.weather); game.env.setWeather(WEATHERS[(i + 1) % WEATHERS.length]); hud.toast('Weather', game.env.weather === 'clear' ? 'The skies clear' : game.env.weather === 'snow' ? 'A snowstorm rolls in' : 'Mist rises from the vale'); }
    const it = game.player.dead ? null : game.findInteractable();
    hud.setPrompt(it || (!input.locked && !game.player.dead ? { verb: 'Click', label: 'to take control' } : null));
    if (it && input.hit('KeyE')) {
      if (it.type === 'npc') openDialogue(it.npc);
      else if (it.type === 'chest') game.openChest(it.chest);
      else if (it.type === 'shrine') game.useShrine(it.shrine);
    }
    if (game.pendingLevels > 0 && !game.player.dead && !game.player.attack) {
      perkChoices = game.offerPerks();
      setMode('levelup');
      audio.play('levelup');
      hud.renderLevelUp(game.player.level - game.pendingLevels + 1, perkChoices, (k) => { game.takePerk(k); hud.toast(k.name, k.desc); setMode('play'); });
    }
    if (game.player.dead && game.deathT <= 0 && mode === 'play') { recordRun(false); hud.renderRunStats('#death', [['Slain by', game.killedBy]]); setMode('dead'); }
    if (game.victory && game.victoryT <= 0 && !game.victoryShown && mode === 'play') { game.victoryShown = true; recordRun(true); hud.renderRunStats('#victory'); setMode('victory'); audio.play('quest'); }
  } else if (mode === 'dialogue') {
    hud.setPrompt(null);
    for (let i = 0; i < 9; i++) if (input.hit('Digit' + (i + 1)) && dialogueNode.options[i]) { pickOption(dialogueNode.options[i]); break; }
    if (input.hit('Escape') || input.hit('Tab')) closeDialogue();
  } else if (mode === 'inventory') { if (input.hit('Tab') || input.hit('KeyI') || input.hit('Escape')) setMode('play'); }
  else if (mode === 'map') { if (input.hit('KeyM') || input.hit('Escape')) setMode('play'); }
  else if (mode === 'levelup') { for (let i = 0; i < perkChoices.length; i++) if (input.hit('Digit' + (i + 1))) { const k = perkChoices[i]; game.takePerk(k); hud.toast(k.name, k.desc); setMode('play'); break; } }

  game.update(dt, input, mode);
  audio.ctx && audio.setWind(game.env.weatherT + (game.player.pos.y > 30 ? 0.5 : 0));
  pipeline.hurt = game.player.hurtFlash * 0.6 + (game.player.dead ? 0.8 : 0);
  pipeline.water = game.player.underwater ? 1 : 0;
  game.renderInfo = `${pipeline.stats.w}×${pipeline.stats.h} · ${presetById(presetId).name}`;
  pipeline.render(game.scene, game.player.camera, game.player.dead ? null : game.player.vmScene, game.player.vmCam, game.env);
  hud.update(dt, game.player.camera, fps);
  input.endFrame();
}

// expose a perk lookup for the HUD
Game.prototype.perkById = (id) => PERKS.find((p) => p.id === id);

resize();
bootTitle();
requestAnimationFrame(frame);
window.__rimehold = { get game() { return game; }, pipeline, applyPreset, newRun, setMode: (m) => setMode(m), talk: (name) => openDialogue(game.npcs.find((n) => n.name.includes(name))), map: () => { setMode('map'); hud.renderMap(); }, inventory: () => { setMode('inventory'); hud.renderInventory((it) => game.player.equip(it)); } };
