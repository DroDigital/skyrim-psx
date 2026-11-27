// Procedural texture foundry.
// Every surface in the vale is painted at load time into tiny tileable 32–64px textures
// with a restricted palette — the same budget a PS1 artist had in VRAM — and then sampled
// with nearest filtering (or trilinear mips, depending on the active graphics mix).
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

const registry = [];

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// tileable value noise
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % period) + period) % period;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed);
  const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, size, baseFreq, oct, seed) {
  let s = 0, amp = 0.5, f = baseFreq, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise((x / size) * f, (y / size) * f, f, seed + i * 17);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
function ramp(stops, t) {
  t = Math.min(0.9999, Math.max(0, t));
  const n = stops.length - 1, i = Math.floor(t * n), f = t * n - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
// quantize like a 15-bit framebuffer + a palette clamp for that crunchy CLUT look
const q5 = (v) => Math.round(Math.max(0, Math.min(255, v)) / 8) * 8;

function makeTex(name, size, fn, { alpha = false, h = size } = {}) {
  const data = new Uint8Array(size * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < size; x++) {
    const c = fn(x, y);
    const i = ((h - 1 - y) * size + x) * 4; // image y-down -> texture v-up
    data[i] = q5(c[0]); data[i + 1] = q5(c[1]); data[i + 2] = q5(c[2]);
    data[i + 3] = alpha ? (c[3] ?? 255) : 255;
  }
  const tex = new THREE.DataTexture(data, size, h, THREE.RGBAFormat);
  tex.name = name;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  registry.push(tex);
  return tex;
}

export function setTextureFiltering(smooth) {
  for (const t of registry) {
    t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    t.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
    t.generateMipmaps = smooth;
    t.anisotropy = smooth ? 4 : 1;
    t.needsUpdate = true;
  }
}

export function buildTextures() {
  const T = {};
  const S = 64;

  T.grass = makeTex('grass', S, (x, y) => {
    const n = fbm(x, y, S, 4, 4, 11), d = hash2(x, y, 3);
    const c = ramp([hex(0x2d3a1c), hex(0x46542a), hex(0x66703a), hex(0x8a8a4e)], n * 0.85 + d * 0.25);
    return d > 0.93 ? [c[0] + 25, c[1] + 25, c[2] + 10] : c;
  });
  T.rock = makeTex('rock', S, (x, y) => {
    const n = fbm(x, y, S, 3, 5, 21);
    const cr = Math.abs(vnoise(x / 9, y / 3.5, 7, 5) - 0.5) < 0.04 ? -40 : 0;
    const c = ramp([hex(0x3a3836), hex(0x5a5753), hex(0x7d7a73), hex(0x9a978d)], n);
    return [c[0] + cr, c[1] + cr, c[2] + cr];
  });
  T.snow = makeTex('snow', S, (x, y) => {
    const n = fbm(x, y, S, 4, 3, 31), d = hash2(x, y, 9);
    const c = ramp([hex(0xa9b6c8), hex(0xd4dde8), hex(0xf2f5fa)], n * 0.9 + 0.1);
    return d > 0.97 ? [255, 255, 255] : c;
  });
  T.dirt = makeTex('dirt', S, (x, y) => {
    const n = fbm(x, y, S, 5, 4, 41), d = hash2(x, y, 4);
    const c = ramp([hex(0x3a2a1c), hex(0x5a4430), hex(0x7a6044), hex(0x8f7a5a)], n);
    return d > 0.95 ? hex(0x6f6a62) : c; // pebbles
  });
  T.bark = makeTex('bark', 32, (x, y) => {
    const n = vnoise(x / 2.2, y / 9, 15, 51) * 0.6 + fbm(x, y, 32, 4, 2, 52) * 0.4;
    return ramp([hex(0x231910), hex(0x3d2c1c), hex(0x5a4430)], n);
  });
  T.pine = makeTex('pine', 32, (x, y) => {
    const n = fbm(x, y, 32, 4, 3, 61), d = hash2(x, y, 62);
    const c = ramp([hex(0x223c2a), hex(0x355a3c), hex(0x4f7a4a), hex(0x77985a)], n * 0.8 + d * 0.3);
    return c;
  });
  T.planks = makeTex('planks', S, (x, y) => {
    const board = Math.floor(y / 8), seam = y % 8 === 0;
    const off = hash2(board, 0, 71) * 64;
    const grain = vnoise((x + off) / 12, y / 1.5, 6, 72 + board);
    const knot = vnoise((x + off) / 5, y / 5, 13, 73) > 0.86 ? -30 : 0;
    const endSeam = ((x + Math.floor(off)) % 32) === 0;
    const base = ramp([hex(0x3b2716), hex(0x5c3e22), hex(0x7a5532)], grain * 0.8 + hash2(board, 1, 74) * 0.3);
    const k = seam || endSeam ? -45 : knot;
    return [base[0] + k, base[1] + k, base[2] + k];
  });
  T.logs = makeTex('logs', S, (x, y) => {
    const row = Math.floor(y / 10), ly = (y % 10) / 10;
    const shade = Math.sin(ly * Math.PI);
    const grain = vnoise(x / 14, y / 1.2, 5, 81 + row);
    const c = ramp([hex(0x2a1a0e), hex(0x4f3520), hex(0x75522f)], shade * 0.75 + grain * 0.25);
    return c;
  });
  T.thatch = makeTex('thatch', S, (x, y) => {
    const n = vnoise(x / 1.5, y / 10, 43, 91) * 0.7 + fbm(x, y, S, 4, 2, 92) * 0.3;
    const row = y % 12 === 0 ? -35 : 0;
    const c = ramp([hex(0x4a3a1e), hex(0x7a6232), hex(0xa28a4a)], n);
    return [c[0] + row, c[1] + row, c[2] + row];
  });
  T.shingles = makeTex('shingles', S, (x, y) => {
    const row = Math.floor(y / 8), off = row % 2 ? 4 : 0;
    const col = Math.floor((x + off) / 8);
    const edge = (y % 8 === 7) || ((x + off) % 8 === 0);
    const n = hash2(col, row, 101) * 0.6 + fbm(x, y, S, 8, 2, 102) * 0.4;
    const c = ramp([hex(0x1f1a17), hex(0x3a302a), hex(0x564840)], n);
    return edge ? [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55] : c;
  });
  T.stone = makeTex('stone', S, (x, y) => {
    const row = Math.floor(y / 11), off = row % 2 ? 9 : 0;
    const bw = 18, col = Math.floor((x + off) / bw);
    const mortar = (y % 11 === 0) || ((x + off) % bw === 0);
    const n = hash2(col, row, 111) * 0.5 + fbm(x, y, S, 6, 3, 112) * 0.5;
    const c = ramp([hex(0x403d3a), hex(0x625e58), hex(0x86817a)], n);
    return mortar ? hex(0x2a2725) : c;
  });
  T.daub = makeTex('daub', S, (x, y) => {
    const n = fbm(x, y, S, 5, 4, 121);
    return ramp([hex(0x8f8070), hex(0xb0a28c), hex(0xc8bba2)], n);
  });
  T.cloth = makeTex('cloth', 32, (x, y) => {
    const w = (x + y) % 2 ? 1 : 0.9, n = fbm(x, y, 32, 4, 2, 131);
    const v = (180 + n * 75) * w;
    return [v, v, v];
  });
  T.leather = makeTex('leather', 32, (x, y) => {
    const n = fbm(x, y, 32, 6, 3, 141);
    const st = (x % 16 === 3 && y % 3 === 0) ? -50 : 0;
    const c = ramp([hex(0x3a2516), hex(0x5c3b22), hex(0x7a5232)], n);
    return [c[0] + st, c[1] + st, c[2] + st];
  });
  T.metal = makeTex('metal', 32, (x, y) => {
    const n = fbm(x, y, 32, 3, 3, 151), s = vnoise(x / 1.2, y / 14, 27, 152);
    const v = 120 + n * 70 + s * 40;
    return [v, v * 1.02, v * 1.06];
  });
  T.fur = makeTex('fur', 32, (x, y) => {
    const n = vnoise(x / 1.3, y / 4, 25, 161) * 0.7 + fbm(x, y, 32, 4, 2, 162) * 0.3;
    return ramp([hex(0x2a241e), hex(0x5a4e40), hex(0x8a7a64)], n);
  });
  T.canvas = makeTex('canvas', 32, (x, y) => {
    const n = fbm(x, y, 32, 4, 3, 171), w = ((x % 2) ^ (y % 2)) ? 0.94 : 1;
    const patch = vnoise(x / 8, y / 8, 4, 172) > 0.8 ? -25 : 0;
    const c = ramp([hex(0x6f5f45), hex(0x9a8662), hex(0xb7a47c)], n);
    return [(c[0] + patch) * w, (c[1] + patch) * w, (c[2] + patch) * w];
  });
  T.rune = makeTex('rune', S, (x, y) => {
    // dark stone with carved glowing runes in the alpha channel -> used as emissive mask
    const n = fbm(x, y, S, 4, 4, 181);
    const c = ramp([hex(0x2b2c30), hex(0x45474c), hex(0x63666b)], n);
    const gx = Math.floor(x / 16), gy = Math.floor(y / 16), lx = x % 16, ly = y % 16;
    const r = mulberry32((gx * 7 + gy * 13 + 5) >>> 0);
    let glyph = false;
    if (lx > 2 && lx < 13 && ly > 1 && ly < 15) {
      if (lx === 7 || lx === 8) glyph = true; // stave
      const branch = Math.floor(r() * 4);
      const yy = ly - 2;
      if (branch === 0 && Math.abs(lx - 8 - yy * 0.6) < 1) glyph = true;
      if (branch === 1 && Math.abs(lx - 7 + yy * 0.6) < 1 && yy < 7) glyph = true;
      if (branch === 2 && (ly === 5 || ly === 6) && lx > 4 && lx < 11) glyph = true;
      if (branch === 3 && Math.abs((lx - 8) - (yy - 6)) < 1 && yy > 2 && yy < 10) glyph = true;
    }
    return glyph ? [40, 60, 70, 255] : [...c, 0];
  }, { alpha: true });
  T.chest = makeTex('chest', 32, (x, y) => {
    const band = (y % 16 < 3) || (x < 3) || (x > 28);
    const n = vnoise(x / 10, y / 1.5, 3, 191);
    const wood = ramp([hex(0x3b2414), hex(0x6a4424)], n);
    const rivet = band && ((x + y) % 7 === 0);
    return band ? (rivet ? hex(0xb8b0a0) : hex(0x4d4a46)) : wood;
  });
  T.grassBlade = makeTex('grassBlade', 32, (x, y) => {
    // 3 blades per tuft, alpha-tested
    const blades = [[8, 0.45], [16, 0.0], [24, -0.4]];
    const t = 1 - y / 32; // 1 at bottom (v=0 top since flipY false -> y=0 top)
    for (const [bx, lean] of blades) {
      const cx = bx + lean * (31 - y) * 0.4;
      const w = 2.2 * (y / 32) + 0.4;
      if (Math.abs(x - cx) < w) {
        const c = ramp([hex(0x7d8a45), hex(0x55642c), hex(0x2c3a17)], y / 32);
        return [...c, 255];
      }
    }
    return [0, 0, 0, 0];
  }, { alpha: true });
  T.water = makeTex('water', S, (x, y) => {
    const n = fbm(x, y, S, 4, 4, 201);
    const c = ramp([hex(0x1a3a4a), hex(0x2a5868), hex(0x4f8a98), hex(0xb8dde4)], Math.pow(n, 1.6));
    return c;
  });
  T.hay = makeTex('hay', 32, (x, y) => ramp([hex(0x6a5426), hex(0xb89a4a)], vnoise(x / 1.2, y / 6, 27, 211)));

  // faces — 16x16, PS1 style, a handful of variants
  T.faces = [];
  const skinTones = [0xc89a7a, 0xa87a5c, 0xe0b898, 0x8c6448];
  const hairs = [0x2a1c12, 0x7a5228, 0xc8a060, 0x9a9a9a, 0x6a2a18];
  for (let i = 0; i < 6; i++) {
    const skin = hex(skinTones[i % skinTones.length]), hair = hex(hairs[i % hairs.length]);
    const beard = i % 2 === 0;
    T.faces.push(makeTex('face' + i, 16, (x, y) => {
      if (y < 4) return hair;
      if ((x === 4 || x === 11) && y === 7) return [20, 24, 28];
      if ((x === 4 || x === 11) && y === 6) return [skin[0] * 0.6, skin[1] * 0.6, skin[2] * 0.6]; // brows
      if (y === 4 && (x < 3 || x > 12)) return hair;
      if (beard && y >= 10 && x > 2 && x < 13) return y === 11 && x > 5 && x < 10 ? [40, 20, 15] : hair;
      if (!beard && y === 11 && x > 5 && x < 10) return [120, 50, 45];
      if (y === 9 && x === 8) return [skin[0] * 0.75, skin[1] * 0.75, skin[2] * 0.75];
      return skin;
    }));
  }
  T.wightFace = makeTex('wightFace', 16, (x, y) => {
    if ((x === 4 || x === 5 || x === 10 || x === 11) && (y === 6 || y === 7)) return [140, 220, 255];
    if (y > 10 && y < 13 && x > 4 && x < 11) return (x % 2) ? [200, 190, 160] : [20, 18, 15];
    const n = hash2(x, y, 221);
    return ramp([hex(0x2e2a24), hex(0x5a5242), hex(0x7a7058)], n);
  });
  return T;
}
