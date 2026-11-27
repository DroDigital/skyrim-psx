// "Graphics mixes": curated blends of 1990s console rendering and modern GPU techniques.
// Every knob is also exposed live in the tuning panel (G).

const base = {
  resHeight: 270,        // internal render height (0 = native * resScale)
  resScale: 1,
  vertexSnap: true,
  snapDiv: 2,            // snap grid = internal res / snapDiv (2 == whole-pixel snapping)
  affine: 0.65,
  pixelLighting: false,
  lightSteps: 0,
  smoothTextures: false,
  shadows: true,
  shadowRes: 2048,
  shadowSoft: 1.6,
  shadowDist: 55,
  bloom: 0.55,
  bloomThreshold: 1.0,
  godRays: 0.85,
  exposure: 1.0,
  saturation: 1.05,
  contrast: 1.06,
  splitTone: 0.08,       // cold shadows / warm highlights
  vignette: 0.35,
  colorBits: 5,          // bits per channel (5 = PS1 15-bit), 0 = off
  dither: 1.0,
  palette: false,
  outline: 0,
  grain: 0.03,
  crt: false,
  vhs: false,
  softParticles: true,
  rim: 0,
  fogMul: 1,
  fov: 72,
  drawDistance: 420,
};

export const PRESETS = [
  {
    id: 'hybrid', key: '1', name: 'Hybrid Saga',
    desc: 'The default mix. PS1 geometry wobble, affine textures and 15-bit dithering — lit by soft shadow maps, HDR bloom and volumetric god rays.',
    tags: 'vertex snap · affine · 15-bit dither · PCF shadows · bloom · god rays · height fog',
    s: { ...base },
  },
  {
    id: 'authentic', key: '2', name: 'Authentic 1997',
    desc: 'As close to real PlayStation hardware as we can get: 320×240, integer-pixel snapping, full affine warp, Gouraud only, no shadows or post.',
    tags: '240p · gouraud · no z-precision · CLUT colours',
    s: { ...base, resHeight: 240, affine: 1, shadows: false, softParticles: false, bloom: 0, godRays: 0, splitTone: 0, vignette: 0, grain: 0, saturation: 1.0, contrast: 1.0, fogMul: 1.6, lightSteps: 0, drawDistance: 260, fov: 65 },
  },
  {
    id: 'crt', key: '3', name: 'CRT Phosphor',
    desc: 'Hybrid Saga piped through a simulated consumer CRT: barrel curvature, scanlines, aperture grille, chromatic fringing and phosphor glow.',
    tags: 'CRT · scanlines · aperture mask · chromatic aberration',
    s: { ...base, resHeight: 240, crt: true, bloom: 0.7, grain: 0.02, vignette: 0.2 },
  },
  {
    id: 'remaster', key: '4', name: 'HD Remaster',
    desc: 'What a 2020s remaster of a PS1 game does: keep the low-poly art, drop the wobble, add per-pixel light, trilinear mips, 4K shadows and rim light.',
    tags: 'per-pixel lighting · trilinear · 4k shadows · rim light · soft particles',
    s: { ...base, resHeight: 0, resScale: 0.85, vertexSnap: false, affine: 0, pixelLighting: true, smoothTextures: true, shadowRes: 4096, shadowSoft: 1.2, shadowDist: 70, bloom: 0.45, colorBits: 0, dither: 0, grain: 0.015, rim: 0.6, softParticles: true, fov: 75 },
  },
  {
    id: 'ink', key: '5', name: 'Ink & Frost',
    desc: 'A 16-colour Nordic palette with ordered dithering, posterised light bands and depth-aware ink outlines — like a woodcut that moves.',
    tags: '16-colour palette · bayer dither · sobel outlines · light banding',
    s: { ...base, resHeight: 220, palette: true, softParticles: false, outline: 1, lightSteps: 4, bloom: 0.25, godRays: 0.5, grain: 0, vignette: 0.25, affine: 0.5 },
  },
  {
    id: 'vhs', key: '6', name: 'PAL Tape Memory',
    desc: 'A 288-line PAL capture taped off the telly in 1998: chroma bleed, tracking wobble, tape noise and faded warm colour.',
    tags: '288p PAL · chroma bleed · tracking noise · tape grade',
    s: { ...base, resHeight: 288, vhs: true, saturation: 0.8, contrast: 0.95, splitTone: 0.16, grain: 0.06, bloom: 0.7, vignette: 0.45 },
  },
];

export function presetById(id) { return PRESETS.find((p) => p.id === id) || PRESETS[0]; }
