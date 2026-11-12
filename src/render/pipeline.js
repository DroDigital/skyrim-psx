// Hand-rolled frame graph (no EffectComposer):
//
//  shadow pass (sun/moon ortho, texel-snapped)  ─┐
//  scene pass  → HDR half-float @ low internal res (+ depth texture)
//  viewmodel   → same target after a depth clear
//  god rays    → radial blur of sky-only pixels toward the sun (½ res)
//  bloom       → dual-filter (Kawase) 5-level down/up chain
//  composite   → ACES tonemap · grade · split tone · vignette · sobel ink · 15-bit/palette dither · grain
//  output      → nearest upscale to the window, or CRT / PAL VHS simulation
import * as THREE from 'three';
import { G, setPixelLighting } from './psxMaterial.js';
import { setTextureFiltering } from './textures.js';
import { particleUniforms } from './particles.js';

const quadVert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const downFrag = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uHalfPixel; uniform float uThreshold; uniform float uFirst;
varying vec2 vUv;
vec3 pre(vec3 c) {
  if (uFirst < 0.5) return c;
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + 0.5, 0.0, 1.0); soft = soft * soft * 0.5;
  float contrib = max(soft, l - uThreshold) / max(l, 1e-4);
  c *= contrib;
  return c / (1.0 + max(c.r, max(c.g, c.b)) * 0.25); // karis-ish firefly tame
}
void main() {
  vec3 s = pre(texture2D(tSrc, vUv).rgb) * 4.0;
  s += pre(texture2D(tSrc, vUv - uHalfPixel).rgb);
  s += pre(texture2D(tSrc, vUv + uHalfPixel).rgb);
  s += pre(texture2D(tSrc, vUv + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb);
  s += pre(texture2D(tSrc, vUv - vec2(uHalfPixel.x, -uHalfPixel.y)).rgb);
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const upFrag = /* glsl */`
uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uHalfPixel; uniform float uHasAdd;
varying vec2 vUv;
void main() {
  vec2 h = uHalfPixel;
  vec3 s = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  s /= 12.0;
  if (uHasAdd > 0.5) s += texture2D(tAdd, vUv).rgb;
  gl_FragColor = vec4(s, 1.0);
}`;

const raysFrag = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect; uniform vec3 uSunColor;
varying vec2 vUv;
void main() {
  const int N = 56;
  vec2 delta = (vUv - uSun) * (0.9 / float(N));
  vec2 uv = vUv;
  float illum = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    uv -= delta;
    float d = texture2D(tDepth, uv).r;
    if (d > 0.99999) {
      vec2 o = (uv - uSun) * vec2(uAspect, 1.0);
      float w = smoothstep(0.55, 0.0, length(o));
      vec3 c = texture2D(tScene, uv).rgb;
      acc += max(c - 0.35, 0.0) * w * illum;
    }
    illum *= 0.965;
  }
  gl_FragColor = vec4(acc / float(N) * uSunColor * 2.2, 1.0);
}`;

const compFrag = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays; uniform sampler2D tDepth;
uniform float uBloom, uRays, uExposure, uSat, uContrast, uSplit, uVignette, uLevels, uDither, uPalette, uOutline, uGrain, uTime, uHurt, uWater;
uniform vec2 uRes; uniform float uNear, uFar;
uniform vec3 uPal[16];
varying vec2 vUv;

vec3 aces(vec3 x) {
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return m[idx] / 16.0;
}
float linDepth(vec2 uv) { float z = texture2D(tDepth, uv).r * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
float h12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 hdr = texture2D(tScene, vUv).rgb;
  hdr += texture2D(tBloom, vUv).rgb * uBloom;
  hdr += texture2D(tRays, vUv).rgb * uRays;
  hdr *= uExposure;
  if (uWater > 0.0) hdr = mix(hdr, hdr * vec3(0.3, 0.6, 0.75) + vec3(0.0, 0.03, 0.05), uWater);
  vec3 c = aces(hdr);

  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c += uSplit * (vec3(-0.04, 0.0, 0.07) * (1.0 - l) + vec3(0.07, 0.03, -0.05) * l);
  vec2 vc = vUv - 0.5;
  c *= 1.0 - dot(vc, vc) * uVignette * 1.6;
  c = mix(c, vec3(l * 1.2, l * 0.15, l * 0.1), uHurt * 0.35);
  c = clamp(c, 0.0, 1.0);

  // depth-aware ink outline (sobel on linear depth)
  if (uOutline > 0.0) {
    vec2 px = 1.0 / uRes;
    float d = linDepth(vUv);
    float dx = linDepth(vUv + vec2(px.x, 0.0)) - linDepth(vUv - vec2(px.x, 0.0));
    float dy = linDepth(vUv + vec2(0.0, px.y)) - linDepth(vUv - vec2(0.0, px.y));
    float e = smoothstep(0.08, 0.25, length(vec2(dx, dy)) / max(d, 1.0) * 6.0) * step(d, uFar * 0.9);
    c = mix(c, vec3(0.03, 0.04, 0.06), e * uOutline);
  }

  c = toSRGB(c);

  float b = bayer4(gl_FragCoord.xy) - 0.5;
  if (uPalette > 0.5) {
    vec3 cc = c + b * 0.16 * uDither;
    float best = 1e9; vec3 pick = cc;
    for (int i = 0; i < 16; i++) {
      vec3 dd = cc - uPal[i];
      float dist = dot(dd * vec3(0.3, 0.59, 0.11), dd) + dot(dd, dd) * 0.25;
      if (dist < best) { best = dist; pick = uPal[i]; }
    }
    c = pick;
  } else if (uLevels > 0.5) {
    c += b * uDither / uLevels;
    c = floor(c * uLevels + 0.5) / uLevels;
  }
  c += (h12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * uGrain;
  gl_FragColor = vec4(c, 1.0);
}`;

const outFrag = /* glsl */`
uniform sampler2D tPost; uniform vec2 uSrcRes; uniform vec2 uDstRes; uniform float uCrt; uniform float uVhs; uniform float uTime;
varying vec2 vUv;
float h12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 rgb2yiq(vec3 c) { return mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c; }
vec3 yiq2rgb(vec3 c) { return mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * c; }
void main() {
  vec2 uv = vUv;
  if (uCrt > 0.5) {
    vec2 cc = uv * 2.0 - 1.0;
    cc *= 1.0 + dot(cc.yx, cc.yx) * vec2(0.035, 0.05);
    uv = cc * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float ab = 0.0013 + length(cc) * 0.0012;
    vec3 col;
    col.r = texture2D(tPost, uv + vec2(ab, 0.0)).r;
    col.g = texture2D(tPost, uv).g;
    col.b = texture2D(tPost, uv - vec2(ab, 0.0)).b;
    // phosphor glow: cheap cross blur
    vec2 px = 1.0 / uSrcRes;
    vec3 glow = texture2D(tPost, uv + vec2(px.x, 0.0)).rgb + texture2D(tPost, uv - vec2(px.x, 0.0)).rgb + texture2D(tPost, uv + vec2(0.0, px.y)).rgb + texture2D(tPost, uv - vec2(0.0, px.y)).rgb;
    col = col * 0.8 + glow * 0.08;
    col *= 0.58 + 0.42 * pow(abs(sin(uv.y * uSrcRes.y * 3.14159)), 1.4); // scanlines
    float m = mod(gl_FragCoord.x, 3.0);
    vec3 mask = m < 1.0 ? vec3(1.0, 0.75, 0.75) : m < 2.0 ? vec3(0.75, 1.0, 0.75) : vec3(0.75, 0.75, 1.0);
    col *= mask * 1.25;
    float vig = 1.0 - smoothstep(0.75, 1.42, length(cc));
    col *= vig;
    col *= 1.0 + 0.015 * sin(uTime * 120.0);
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  if (uVhs > 0.5) {
    float line = floor(uv.y * uSrcRes.y);
    float wob = (h12(vec2(line, floor(uTime * 24.0))) - 0.5) * 0.0025;
    float track = smoothstep(0.03, 0.0, abs(fract(uv.y * 0.6 - uTime * 0.07) - 0.5)) * 0.012;
    uv.x += wob + track;
    vec3 y = rgb2yiq(texture2D(tPost, uv).rgb);
    // chroma is low-bandwidth on tape: blur I/Q horizontally
    vec2 iq = vec2(0.0);
    for (int i = -4; i <= 4; i++) iq += rgb2yiq(texture2D(tPost, uv + vec2(float(i) * 1.6 / uSrcRes.x + 0.003, 0.0)).rgb).yz;
    y.yz = iq / 9.0;
    vec3 col = yiq2rgb(y);
    float n = h12(vec2(uv.y * 400.0, uTime * 61.0));
    col += (n - 0.5) * 0.06 + track * 6.0 * (h12(uv * uTime) - 0.3);
    col *= 0.96 + 0.04 * sin(uv.y * uSrcRes.y * 3.14159);
    if (uv.y < 0.012) col *= 0.2;
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  gl_FragColor = vec4(texture2D(tPost, uv).rgb, 1.0);
}`;

// 16-colour "Ink & Frost" palette (sRGB)
const PALETTE = [0x0d0f14, 0x1f2430, 0x3a3f4f, 0x5e6577, 0x8f97a8, 0xc5ccd6, 0xf2f4f8, 0x2c3b2a, 0x4f6a3a, 0x8a9a5b, 0x5a3a24, 0x9a6a3a, 0xd9a55a, 0x7a2a22, 0x3d5f8a, 0x8cc3e0]
  .map((h) => new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255));

function rt(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: opts.type ?? THREE.HalfFloatType,
    minFilter: opts.filter ?? THREE.LinearFilter,
    magFilter: opts.filter ?? THREE.LinearFilter,
    depthBuffer: !!opts.depth,
    generateMipmaps: false,
  });
}

export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.s = null;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);

    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.downMat = mk(downFrag, { tSrc: { value: null }, uHalfPixel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uFirst: { value: 0 } });
    this.upMat = mk(upFrag, { tSrc: { value: null }, tAdd: { value: null }, uHalfPixel: { value: new THREE.Vector2() }, uHasAdd: { value: 1 } });
    this.raysMat = mk(raysFrag, { tScene: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uSunColor: { value: new THREE.Color() } });
    this.compMat = mk(compFrag, {
      tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, tDepth: { value: null },
      uBloom: { value: 0.5 }, uRays: { value: 1 }, uExposure: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 1 }, uSplit: { value: 0 }, uVignette: { value: 0 },
      uLevels: { value: 31 }, uDither: { value: 1 }, uPalette: { value: 0 }, uOutline: { value: 0 }, uGrain: { value: 0 }, uTime: G.uTime, uHurt: { value: 0 }, uWater: { value: 0 },
      uRes: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uPal: { value: PALETTE },
    });
    this.outMat = mk(outFrag, { tPost: { value: null }, uSrcRes: { value: new THREE.Vector2() }, uDstRes: { value: new THREE.Vector2() }, uCrt: { value: 0 }, uVhs: { value: 0 }, uTime: G.uTime });

    this.shadowCam = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 400);
    this.shadowCam.layers.set(1);
    this.depthOverride = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.width = 1; this.height = 1;
    this.hurt = 0; this.water = 0;
    this.stats = { w: 0, h: 0 };
  }

  apply(s) {
    const prev = this.s;
    this.s = { ...s };
    setPixelLighting(s.pixelLighting);
    setTextureFiltering(s.smoothTextures);
    G.uAffine.value = s.affine;
    G.uSnapOn.value = s.vertexSnap ? 1 : 0;
    G.uShadowOn.value = s.shadows ? 1 : 0;
    G.uShadowSoft.value = s.shadowSoft;
    G.uColorSteps.value = s.lightSteps;
    G.uRim.value = s.rim;
    particleUniforms.uSoft.value = s.softParticles ? 1 : 0;
    if (!prev || prev.shadowRes !== s.shadowRes || !this.shadowRT) this._makeShadow(s.shadowRes);
    this._resizeTargets();
  }

  _makeShadow(res) {
    if (this.shadowRT) this.shadowRT.dispose();
    this.shadowRT = new THREE.WebGLRenderTarget(res, res, { depthBuffer: true, type: THREE.UnsignedByteType });
    this.shadowRT.depthTexture = new THREE.DepthTexture(res, res, THREE.UnsignedIntType);
    this.shadowRT.depthTexture.minFilter = this.shadowRT.depthTexture.magFilter = THREE.NearestFilter;
    G.uShadowMap.value = this.shadowRT.depthTexture;
    G.uShadowTexel.value = 1 / res;
  }

  setSize(w, h) { this.width = w; this.height = h; if (this.s) this._resizeTargets(); }

  _resizeTargets() {
    const s = this.s;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let ih = s.resHeight > 0 ? s.resHeight : Math.round(this.height * dpr * s.resScale);
    let iw = Math.round(ih * (this.width / this.height));
    if (iw === this.stats.w && ih === this.stats.h && this.sceneRT) return;
    this.stats.w = iw; this.stats.h = ih;
    for (const t of [this.sceneRT, this.raysRT, this.postRT, ...(this.downs || []), ...(this.ups || [])]) t && t.dispose();
    this.sceneRT = rt(iw, ih, { depth: true, filter: THREE.LinearFilter });
    this.sceneRT.depthTexture = new THREE.DepthTexture(iw, ih, THREE.UnsignedIntType);
    this.raysRT = rt(Math.max(1, iw >> 1), Math.max(1, ih >> 1));
    this.postRT = rt(iw, ih, { type: THREE.UnsignedByteType, filter: THREE.NearestFilter });
    this.downs = []; this.ups = [];
    let w = iw, h = ih;
    for (let i = 0; i < 5; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); this.downs.push(rt(w, h)); }
    for (let i = 0; i < 4; i++) this.ups.push(rt(this.downs[i].width, this.downs[i].height));
    G.uSnapRes.value.set(iw / s.snapDiv, ih / s.snapDiv);
    particleUniforms.uScale.value = ih * 0.5;
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  updateShadowCamera(center, sunDir) {
    const s = this.s, cam = this.shadowCam, d = s.shadowDist;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 1; cam.far = 500;
    cam.updateProjectionMatrix();
    cam.position.copy(center).addScaledVector(sunDir, 220);
    cam.up.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.99) cam.up.set(0, 0, 1);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    // texel snapping kills shadow shimmer as the player moves
    const texel = (2 * d) / this.shadowRT.width;
    const inv = cam.matrixWorldInverse;
    const v = center.clone().applyMatrix4(inv);
    const dx = v.x - Math.round(v.x / texel) * texel, dy = v.y - Math.round(v.y / texel) * texel;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, -dx).addScaledVector(up, -dy);
    cam.updateMatrixWorld(true);
    G.uShadowMatrix.value.copy(this.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }

  render(scene, camera, vmScene, vmCam, env) {
    const r = this.renderer, s = this.s;
    r.autoClear = false;

    // 1. shadows
    if (s.shadows && env.sunDir.y > 0.02) {
      this.updateShadowCamera(camera.position, env.sunDir);
      scene.overrideMaterial = this.depthOverride;
      const bg = scene.background; scene.background = null;
      r.setRenderTarget(this.shadowRT);
      r.clear(false, true, false);
      r.render(scene, this.shadowCam);
      scene.overrideMaterial = null; scene.background = bg;
      G.uShadowOn.value = 1;
    } else G.uShadowOn.value = 0;

    // 2. scene (HDR, low res)
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    if (vmScene) { r.clearDepth(); r.render(vmScene, vmCam); }

    // 3. god rays
    const sunW = camera.position.clone().addScaledVector(env.realSunDir, 500);
    const sp = sunW.project(camera);
    const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
    const facing = Math.max(0, camDir.dot(env.realSunDir));
    const onScreen = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sp.x), Math.abs(sp.y)), 1.0, 1.8);
    const raysAmt = s.godRays * env.sunVisible * facing * onScreen;
    if (raysAmt > 0.01) {
      const m = this.raysMat.uniforms;
      m.tScene.value = this.sceneRT.texture; m.tDepth.value = this.sceneRT.depthTexture;
      m.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      m.uAspect.value = this.width / this.height;
      m.uSunColor.value.copy(G.uSunColor.value).multiplyScalar(0.6);
      this._pass(this.raysMat, this.raysRT);
    }

    // 4. bloom
    if (s.bloom > 0) {
      let src = this.sceneRT.texture, sw = this.sceneRT.width, sh = this.sceneRT.height;
      for (let i = 0; i < this.downs.length; i++) {
        const d = this.downMat.uniforms;
        d.tSrc.value = src; d.uHalfPixel.value.set(0.5 / sw, 0.5 / sh); d.uFirst.value = i === 0 ? 1 : 0; d.uThreshold.value = s.bloomThreshold;
        this._pass(this.downMat, this.downs[i]);
        src = this.downs[i].texture; sw = this.downs[i].width; sh = this.downs[i].height;
      }
      for (let i = this.ups.length - 1; i >= 0; i--) {
        const u = this.upMat.uniforms;
        const lowT = i === this.ups.length - 1 ? this.downs[i + 1] : this.ups[i + 1];
        u.tSrc.value = lowT.texture; u.tAdd.value = this.downs[i].texture; u.uHalfPixel.value.set(0.5 / lowT.width, 0.5 / lowT.height); u.uHasAdd.value = 1;
        this._pass(this.upMat, this.ups[i]);
      }
    }

    // 5. composite
    const c = this.compMat.uniforms;
    c.tScene.value = this.sceneRT.texture; c.tDepth.value = this.sceneRT.depthTexture;
    c.tBloom.value = this.ups[0].texture; c.uBloom.value = s.bloom > 0 ? s.bloom * 0.35 : 0;
    c.tRays.value = this.raysRT.texture; c.uRays.value = raysAmt;
    c.uExposure.value = s.exposure * (env.exposure || 1); c.uSat.value = s.saturation; c.uContrast.value = s.contrast; c.uSplit.value = s.splitTone; c.uVignette.value = s.vignette;
    c.uLevels.value = s.colorBits > 0 ? Math.pow(2, s.colorBits) - 1 : 0; c.uDither.value = s.dither; c.uPalette.value = s.palette ? 1 : 0;
    c.uOutline.value = s.outline; c.uGrain.value = s.grain; c.uHurt.value = this.hurt; c.uWater.value = this.water;
    c.uRes.value.set(this.sceneRT.width, this.sceneRT.height); c.uNear.value = camera.near; c.uFar.value = camera.far;
    this._pass(this.compMat, this.postRT);

    // 6. output
    const o = this.outMat.uniforms;
    o.tPost.value = this.postRT.texture; o.uSrcRes.value.set(this.postRT.width, this.postRT.height);
    o.uDstRes.value.set(this.width, this.height); o.uCrt.value = s.crt ? 1 : 0; o.uVhs.value = s.vhs ? 1 : 0;
    this._pass(this.outMat, null);
  }
}

export function castShadows(obj) { obj.traverse((o) => { if (o.isMesh) o.layers.enable(1); }); }
