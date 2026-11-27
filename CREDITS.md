# Credits & third-party assets

## Libraries
| Library | Use | License |
|---|---|---|
| [three.js](https://threejs.org) r187 | WebGL rasteriser only (no scene editor, no EffectComposer, no built-in lit materials) | MIT |
| [simplex-noise](https://github.com/jwagner/simplex-noise.js) | Terrain heightfield noise | MIT |
| [lil-gui](https://lil-gui.georgealways.com) | Live render-tuning panel (`G`) | MIT |
| [Vite](https://vitejs.dev) | Dev server / bundler | MIT |

## 3D models (`public/assets/models/`)
| File | Used as | Source | License |
|---|---|---|---|
| `fox.glb` | Grey Wolf & Frost Alpha (desaturated + re-skinned with the PSX shader) | [Khronos glTF-Sample-Assets — Fox](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox) | Model by PixelMannen (CC0); rigging & animation by tomkranis (CC-BY 4.0); glTF conversion by @AsoboStudio and @scurest (CC-BY 4.0) |
| `sentinel.glb` | Brass Sentinel mini-boss | [three.js examples — RobotExpressive](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive) | By Tomás Laulhé (Quaternius), CC0; modifications by Don McCurdy |

## Fonts (loaded from Google Fonts)
Cinzel, Pixelify Sans, IM Fell English — all SIL Open Font License.

## Everything else
Textures, buildings, props, characters, sky, audio and music are generated procedurally in code at load time.
