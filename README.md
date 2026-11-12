# RIMEHOLD — a PSX roguelike saga

A first-person Nordic fantasy action-RPG in PlayStation-1 style, built as a **roguelike**: every run generates a new vale from a seed, and death is permanent.

This is the **gameplay showcase**: one region (Rimehold Vale), a village of NPCs, four quests, five enemy types plus three champions, and six switchable "graphics mixes" that blend 1997 rendering tricks with modern GPU techniques. The full game (more regions, dungeons, meta-progression) builds on this foundation.

**No engine.** three.js is used purely as a WebGL rasteriser; the frame graph, every lit shader, terrain, foliage, AI, combat, audio and UI are hand-written.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

## Controls
| Key | Action |
|---|---|
| `WASD` / mouse | Move / look |
| `LMB` | Attack (hold for a power attack) |
| `RMB` | Firebolt |
| `Q` | Rune Burst (knockback shockwave) |
| `Shift` / `Space` / `C` | Sprint / jump / dodge |
| `E` | Talk, loot, pray at shrines |
| `F` | Drink a healing draught |
| `Tab` / `M` | Character & inventory / map |
| `1`–`6` | Swap graphics mix live |
| `T` (hold) / `Y` | Fast-forward time / cycle weather |
| `G` | Render-tuning panel |

## The graphics mixes
| # | Mix | What it combines |
|---|---|---|
| 1 | **Hybrid Saga** (default) | Vertex snapping, affine UVs, 15-bit ordered dither **+** PCF soft shadows, HDR bloom, god rays, height fog |
| 2 | **Authentic 1997** | 320×240, integer-pixel snapping, full affine warp, Gouraud only, no post |
| 3 | **CRT Phosphor** | Hybrid through a consumer-CRT sim: curvature, scanlines, aperture grille, chromatic fringing |
| 4 | **HD Remaster** | Low-poly art with no wobble, per-pixel light, trilinear mips, 4K shadows, rim light |
| 5 | **Ink & Frost** | 16-colour Nordic palette, Bayer dither, posterised light, Sobel depth outlines |
| 6 | **PAL Tape Memory** | 288-line PAL capture: YIQ chroma bleed, tracking wobble, tape noise |

## Rendering tech
**1997 side:** low internal resolution with nearest upscale · clip-space vertex snapping · affine texture mapping (uv·w / w trick) · per-vertex Gouraud lighting · 15-bit colour with 4×4 Bayer dither · 32–64 px procedurally painted textures with nearest filtering · segmented rigid-part characters.

**Modern side:** custom frame graph (shadow → HDR scene → viewmodel → god rays → dual-Kawase bloom → composite → output) · texel-snapped sun/moon shadow map with 12-tap rotated Poisson PCF · analytic exponential height fog with sun in-scattering · ACES tonemap + split-tone grade · GPU-driven grass field (instances laid out from `gl_InstanceID`, height/density from a float texture, wind + player-interaction bending) · GPU wind on instanced pines · GPU snow · ray-marched aurora, star field, clouds, moon · day/night cycle with weather and snow accumulation on upward faces · noise dissolve with emissive burn edge on death · depth-aware water with shoreline foam · glTF skinned creatures re-skinned with the PSX uber-shader.

## Gameplay
- **Roguelike runs:** seeded layout for village, lake, bandit camp, barrow, ruins, wolf dens, rune shrines and chests. Permadeath, with a run summary at the end.
- **Combat:** light and power attacks, crits, staggers, knockback, hit-stop, Firebolt AoE with burning, Rune Burst, dodge i-frames.
- **Enemies:** wolf packs (bolder at night), bandits and kiting archers, Hrolf the Red, barrow wights that rise from the earth, the Brass Sentinel, and the **Barrow Thane** boss (frost nova, summons the dead). Village guards fight back.
- **Progression:** XP, then a choice of 1 of 3 boons on each level-up (16 perks). Weapons roll 5 rarity tiers and affixes (fire, frost, leech, haste, ruin, storms). Rune shrines bless — or curse.
- **NPCs & quests:** Elder Sigrun, Halvar the Smith (shop + upgrade), Ylva the merchant, Old Bjorn the hunter, Captain Eirik, villagers.

## Layout
```
src/
  core/      rng (seeded), input, procedural WebAudio
  render/    psxMaterial (uber-shader), pipeline (frame graph), sky, particles, textures, presets
  world/     terrain + water, foliage, structures, builder (modelling kit), collision, world assembly
  entities/  player, actor, enemies, npcs, models (segmented rigs + glTF)
  game/      game (run orchestration), items (loot, perks, shrines)
  ui/        hud (compass, bars, dialogue, inventory, map, screens)
```

Third-party assets and licenses: see [CREDITS.md](CREDITS.md).
