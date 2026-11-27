// Character models.
//  * Humanoids are *segmented* rigid-part rigs — exactly how many PS1 games (MGS, Tomb Raider-era)
//    built characters — animated procedurally (walk cycles, swings, staggers, deaths).
//  * Wolves and the brass sentinel are external skinned glTF assets (CC0 / CC-BY, see CREDITS.md)
//    re-skinned with the PSX shader and driven by AnimationMixer cross-fades.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { psxMaterial } from '../render/psxMaterial.js';
import { boxGeo, cylGeo } from '../world/builder.js';
import { castShadows } from '../render/pipeline.js';

let T = null;
export function setModelTextures(textures) { T = textures; }

function box(w, h, d, mat, y = 0, x = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d, 0.5), mat);
  m.position.set(x, y, z);
  return m;
}
function pivot(parent, x, y, z) { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; }

const SKIN = [0xc89a7a, 0xa87a5c, 0xe0b898, 0x8c6448];

/**
 * opts: { tunic, pants, skin, faceIdx, hair, armor:'none'|'leather'|'iron', helmet:'none'|'hood'|'iron'|'horned',
 *         cloak, beardless, scale, wight:boolean, weapon:'sword'|'axe'|'bow'|'staff'|'hammer'|'none', shield, glow }
 */
export function buildHumanoid(o = {}) {
  const mats = [];
  const M = (opts) => { const m = psxMaterial({ ...opts, dissolveColor: o.wight ? 0x5fd0ff : 0xff7a2a }); mats.push(m); return m; };
  const skinCol = o.wight ? 0x6a6458 : o.skin ?? SKIN[(o.faceIdx ?? 0) % SKIN.length];
  const mSkin = M({ map: T.cloth, tint: skinCol, desat: 1 });
  const mTunic = M({ map: o.armor === 'iron' ? T.metal : T.cloth, tint: o.armor === 'iron' ? 0xb0b4b8 : (o.tunic ?? 0x6a4a3a) });
  const mPants = M({ map: T.leather, tint: o.pants ?? 0x8a7a6a });
  const mLeather = M({ map: T.leather, tint: 0xffffff });
  const mFace = M({ map: o.wight ? T.wightFace : T.faces[(o.faceIdx ?? 0) % T.faces.length] });
  const mHair = M({ map: T.fur, tint: o.hair ?? 0x5a3a20 });
  const mMetal = M({ map: T.metal, tint: 0xd0d4d8 });
  const mFur = M({ map: T.fur, tint: o.cloak ?? 0xb0a090 });
  const mGlow = M({ map: T.cloth, tint: 0x000000, emissive: o.glow ?? 0x7fd8ff });

  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);       // whole-body pivot (death fall / lean)
  const hips = pivot(body, 0, 0.95, 0);
  hips.add(box(0.36, 0.2, 0.22, mPants, 0));
  const torso = pivot(hips, 0, 0.08, 0);
  const tw = o.wight ? 0.36 : 0.44;
  torso.add(box(tw, 0.56, 0.26, mTunic, 0.28));
  torso.add(box(tw + 0.04, 0.08, 0.3, mLeather, 0.02)); // belt
  if (o.armor === 'leather') torso.add(box(tw + 0.04, 0.3, 0.3, mLeather, 0.38));
  if (o.armor === 'iron') torso.add(box(tw + 0.06, 0.18, 0.32, mMetal, 0.5));
  if (o.cloak) { const c = box(tw + 0.06, 0.75, 0.06, mFur, 0.2, 0, -0.17); c.rotation.x = 0.08; torso.add(c); torso.add(box(tw + 0.14, 0.14, 0.34, mFur, 0.56)); }
  const neck = pivot(torso, 0, 0.58, 0);
  const headG = new THREE.BoxGeometry(0.24, 0.26, 0.24);
  const head = new THREE.Mesh(headG, [mSkin, mSkin, mHair, mSkin, mFace, mHair]);
  head.position.y = 0.15;
  neck.add(head);
  if (o.wight) { neck.add(box(0.05, 0.03, 0.02, mGlow, 0.17, -0.055, 0.125)); neck.add(box(0.05, 0.03, 0.02, mGlow, 0.17, 0.055, 0.125)); }
  if (o.helmet === 'iron' || o.helmet === 'horned') {
    neck.add(box(0.28, 0.14, 0.28, mMetal, 0.27));
    neck.add(box(0.04, 0.12, 0.05, mMetal, 0.2, 0, 0.13));
    if (o.helmet === 'horned') for (const s of [-1, 1]) { const h = new THREE.Mesh(cylGeo(0.01, 0.045, 0.28, 4), mHair); h.position.set(s * 0.18, 0.36, 0); h.rotation.z = -s * 0.9; neck.add(h); }
  } else if (o.helmet === 'hood') {
    neck.add(box(0.3, 0.3, 0.3, mFur, 0.17, 0, -0.03));
  } else if (!o.wight) neck.add(box(0.26, 0.06, 0.26, mHair, 0.28));

  const limbs = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const sh = pivot(torso, s * (tw / 2 + 0.07), 0.52, 0);
    sh.add(box(0.13, 0.32, 0.13, o.armor === 'iron' ? mMetal : mTunic, -0.16));
    const el = pivot(sh, 0, -0.32, 0);
    el.add(box(0.11, 0.3, 0.11, mSkin, -0.15));
    const hand = pivot(el, 0, -0.32, 0.02);
    hand.add(box(0.1, 0.1, 0.1, mSkin, 0));
    const hp = pivot(hips, s * 0.11, -0.04, 0);
    hp.add(box(0.16, 0.45, 0.17, mPants, -0.22));
    const kn = pivot(hp, 0, -0.45, 0);
    kn.add(box(0.14, 0.44, 0.15, mLeather, -0.22));
    kn.add(box(0.15, 0.08, 0.26, mLeather, -0.44, 0, 0.05));
    limbs['arm' + side] = sh; limbs['elbow' + side] = el; limbs['hand' + side] = hand; limbs['leg' + side] = hp; limbs['knee' + side] = kn;
  }

  // weapons
  let weapon = null;
  const wMat = M({ map: T.metal, tint: o.wight ? 0x8aa0a8 : 0xd8dce0, emissive: o.weaponGlow ?? 0x000000 });
  const gripMat = M({ map: T.leather, tint: 0x8a6040 });
  if (o.weapon === 'sword' || o.weapon === 'axe' || o.weapon === 'hammer' || o.weapon === 'greatsword') {
    weapon = new THREE.Group();
    weapon.add(box(0.04, 0.22, 0.04, gripMat, 0));
    if (o.weapon === 'sword' || o.weapon === 'greatsword') {
      const L = o.weapon === 'greatsword' ? 1.25 : 0.8;
      weapon.add(box(0.2, 0.04, 0.06, wMat, 0.12));
      weapon.add(box(0.07, L, 0.02, wMat, 0.14 + L / 2));
    } else if (o.weapon === 'axe') {
      weapon.add(box(0.04, 0.6, 0.04, gripMat, 0.4));
      weapon.add(box(0.03, 0.22, 0.24, wMat, 0.62, 0, 0.1));
    } else {
      weapon.add(box(0.05, 0.75, 0.05, gripMat, 0.45));
      weapon.add(box(0.18, 0.18, 0.28, wMat, 0.86));
    }
    weapon.rotation.x = Math.PI / 2;
    limbs.handR.add(weapon);
  } else if (o.weapon === 'bow') {
    weapon = new THREE.Group();
    const bowMat = M({ map: T.bark, tint: 0xb08a60 });
    for (const s of [-1, 1]) { const l = box(0.04, 0.6, 0.04, bowMat, s * 0.28, 0, -0.05); l.rotation.x = s * 0.35; weapon.add(l); }
    limbs.handL.add(weapon);
  } else if (o.weapon === 'staff') {
    weapon = new THREE.Group();
    weapon.add(box(0.05, 1.7, 0.05, M({ map: T.bark }), 0.3));
    weapon.add(box(0.12, 0.12, 0.12, mGlow, 1.2));
    limbs.handR.add(weapon);
  }
  if (o.shield) {
    const sh = new THREE.Mesh(cylGeo(0.36, 0.36, 0.06, 8, 0.5), M({ map: T.planks, tint: o.shield }));
    sh.rotation.z = Math.PI / 2; sh.rotation.y = Math.PI / 2; sh.position.set(-0.05, 0, 0.1);
    limbs.handL.add(sh);
  }
  const s = o.scale ?? 1;
  root.scale.setScalar(s);
  castShadows(root);
  root.traverse((m) => { if (m.isMesh) m.frustumCulled = true; });
  return { root, body, hips, torso, neck, head, ...limbs, weapon, mats, kind: 'humanoid' };
}

// --- procedural animation for segmented rigs ---
export function animateHumanoid(r, a, dt) {
  // a: { speed (m/s), phase, attack (0..1 or -1), attackKind, hit (0..1), dead (0..1), talk, aim, cast, wight }
  const sp = Math.min(a.speed / 5, 1.4);
  a.phase += dt * (3 + a.speed * 1.6);
  const s = Math.sin(a.phase), c = Math.cos(a.phase);
  const walkAmt = Math.min(1, a.speed / 1.5);
  r.legL.rotation.x = s * 0.7 * sp;
  r.legR.rotation.x = -s * 0.7 * sp;
  r.kneeL.rotation.x = Math.max(0, -c) * 0.9 * sp + 0.05;
  r.kneeR.rotation.x = Math.max(0, c) * 0.9 * sp + 0.05;
  r.hips.position.y = 0.95 - Math.abs(c) * 0.05 * walkAmt;
  const breathe = Math.sin(a.t * 1.8) * 0.02;
  r.torso.rotation.x = 0.06 * walkAmt + breathe + (a.wight ? 0.25 : 0);
  r.torso.rotation.y = s * 0.08 * walkAmt;
  r.armL.rotation.x = -s * 0.6 * sp + (a.wight ? -1.2 : 0);
  r.armR.rotation.x = s * 0.6 * sp + (a.wight ? -1.2 : 0);
  r.armL.rotation.z = -0.08; r.armR.rotation.z = 0.08;
  r.elbowL.rotation.x = -0.25 - Math.max(0, s) * 0.4 * sp;
  r.elbowR.rotation.x = -0.25 - Math.max(0, -s) * 0.4 * sp;
  r.neck.rotation.set(a.lookPitch || 0, a.lookYaw || 0, 0);

  if (a.aim > 0) { // bow draw
    r.armL.rotation.set(-1.5 * a.aim, 0, -0.1);
    r.armR.rotation.set(-1.4 * a.aim, 0, 0.6 * a.aim);
    r.elbowR.rotation.x = -1.6 * a.aim;
    r.elbowL.rotation.x = 0;
    r.torso.rotation.y = 0.5 * a.aim;
  }
  if (a.attack >= 0) {
    const t = a.attack;
    // windup → strike → recover, overhead diagonal
    let lift, swing;
    if (t < 0.45) { lift = t / 0.45; swing = 0; }
    else if (t < 0.65) { lift = 1 - (t - 0.45) / 0.2; swing = (t - 0.45) / 0.2; }
    else { lift = 0; swing = 1 - (t - 0.65) / 0.35; }
    r.armR.rotation.x = -2.6 * lift + 0.6 * swing;
    r.armR.rotation.z = 0.3 * lift - 0.5 * swing;
    r.elbowR.rotation.x = -0.6 * lift;
    r.torso.rotation.y = 0.45 * lift - 0.6 * swing;
    r.torso.rotation.x = -0.15 * lift + 0.3 * swing;
    if (a.wight) { r.armL.rotation.x = -2.4 * lift + 0.5 * swing; }
  }
  if (a.cast > 0) { r.armR.rotation.x = -1.4 * a.cast; r.armL.rotation.x = -1.4 * a.cast; r.elbowL.rotation.x = r.elbowR.rotation.x = -0.3; }
  if (a.talk) { r.armR.rotation.x += Math.sin(a.t * 3) * 0.15 - 0.3; r.elbowR.rotation.x = -0.9 + Math.sin(a.t * 2.3) * 0.2; r.neck.rotation.x += Math.sin(a.t * 4) * 0.04; }
  if (a.hit > 0) { r.torso.rotation.x -= a.hit * 0.5; r.neck.rotation.x -= a.hit * 0.3; }
  if (a.dead > 0) {
    const d = Math.min(1, a.dead);
    const e = 1 - Math.pow(1 - d, 3);
    r.body.rotation.x = -e * Math.PI / 2;
    r.body.position.y = e * 0.2;
    r.body.position.z = -e * 0.3;
    r.armL.rotation.x = r.armR.rotation.x = -e * 2.5;
  } else { r.body.rotation.x = 0; r.body.position.set(0, 0, 0); }
}

// ---------------- glTF creatures ----------------
const assets = {};
export async function loadCreatureAssets(onProgress) {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL || './';
  // Embedded builds (e.g. a single-page host that cannot serve .glb) may provide the models
  // as base64 in window.__RIMEHOLD_MODELS; otherwise fetch them from assets/models/.
  const embedded = typeof window !== 'undefined' && window.__RIMEHOLD_MODELS;
  const load = (url) => new Promise((res, rej) => {
    const key = url.split('/').pop().replace('.glb', '');
    if (embedded && embedded[key]) {
      const bin = atob(embedded[key]);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      loader.parse(buf.buffer, '', res, rej);
    } else loader.load(url, res, undefined, rej);
  });
  try {
    const [fox, bot] = await Promise.all([load(base + 'assets/models/fox.glb'), load(base + 'assets/models/sentinel.glb')]);
    assets.wolf = fox; assets.sentinel = bot;
  } catch (e) {
    console.warn('Creature assets failed to load, falling back to procedural stand-ins', e);
  }
  onProgress && onProgress();
}

function retarget(root, fn) {
  const mats = [];
  root.traverse((o) => {
    if (o.isMesh) {
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const nl = list.map((m) => { const nm = fn(m); mats.push(nm); return nm; });
      o.material = Array.isArray(o.material) ? nl : nl[0];
      o.frustumCulled = false;
    }
  });
  return mats;
}

export function buildWolf({ alpha = false } = {}) {
  if (!assets.wolf) return buildFallbackBeast(alpha);
  const root = new THREE.Group();
  const inner = SkeletonUtils.clone(assets.wolf.scene);
  const mats = retarget(inner, (m) => psxMaterial({ map: m.map, desat: alpha ? 0.95 : 0.85, tint: alpha ? 0xe8eef8 : 0x9a968e, rim: 0.4 }));
  inner.scale.setScalar(alpha ? 0.0145 : 0.0115);
  root.add(inner);
  castShadows(root);
  const mixer = new THREE.AnimationMixer(inner);
  const clips = {};
  for (const c of assets.wolf.animations) clips[c.name] = mixer.clipAction(c);
  return { root, inner, mixer, clips, mats, kind: 'skinned', map: { idle: 'Survey', walk: 'Walk', run: 'Run', attack: 'Run' } };
}

export function buildSentinel() {
  if (!assets.sentinel) return buildFallbackBeast(true);
  const root = new THREE.Group();
  const inner = SkeletonUtils.clone(assets.sentinel.scene);
  const tints = { Main: 0xc08a40, Grey: 0x6a6460, Black: 0x1a1612 };
  const mats = retarget(inner, (m) => psxMaterial({ map: T.metal, tint: tints[m.name] ?? 0x9a8060, emissive: m.name === 'Black' ? 0x0a2a30 : 0x000000, dissolveColor: 0x5fd0ff, rim: 0.3 }));
  root.add(inner);
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(inner, true);
  const h = bb.max.y - bb.min.y;
  inner.scale.multiplyScalar(2.9 / Math.max(h, 0.01));
  castShadows(root);
  const mixer = new THREE.AnimationMixer(inner);
  const clips = {};
  for (const c of assets.sentinel.animations) clips[c.name] = mixer.clipAction(c);
  return { root, inner, mixer, clips, mats, kind: 'skinned', map: { idle: 'Idle', walk: 'Walking', run: 'Running', attack: 'Punch', death: 'Death' } };
}

function buildFallbackBeast(big) {
  const r = buildHumanoid({ weapon: 'none', scale: big ? 1.4 : 0.8, tunic: 0x5a5a5a });
  return r;
}

export function playClip(r, name, fade = 0.2, once = false, timeScale = 1) {
  const key = r.map[name] || name;
  const action = r.clips[key];
  if (!action || r.current === action) return action;
  action.reset();
  action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
  action.clampWhenFinished = once;
  action.timeScale = timeScale;
  action.play();
  if (r.current) r.current.crossFadeTo(action, fade, false);
  r.current = action;
  return action;
}
