# Porting Ballance (2004) to React + TypeScript + Three.js

## TL;DR

The game splits cleanly into two kinds of content:

1. **Assets** (level meshes, textures, sounds, object placements, semantic groupings) — locked
   inside Virtools 2.x binary files (`.NMO`/`.CMO`, magic `Nemo Fi`), but the Ballance modding
   community has fully reverse-engineered the format. Existing tools convert everything to
   open formats mechanically. **No hand-remodeling needed.**
2. **Behavior** (ball physics, camera, moduls, checkpoints, scoring, menus) — implemented as
   Virtools visual-scripting behavior graphs inside `base.cmo` / `Gameplay.nmo`. These are
   **not portable** and must be reimplemented in TypeScript. The shipped CMO/NMO files,
   plugin DLLs, database, text, and manual are the behavioral specification. Community
   rebuilds may help locate a question, but every value and rule must be confirmed against
   the original game payload before it becomes authoritative here.

So the port = **lossless deployable asset materialization** + **TypeScript reimplementation
of the game rules** on Three.js + a physics engine, with React as the UI shell.

---

## 1. Inventory of the original payload

`Ballance_bin/source1/Ballance` is the directly inspectable installed tree;
`Ballance_bin/source2` is a complementary original disc payload. Static extraction proved
that every gameplay input shared by them is byte-identical. The original payload remains
the sole authority; external ports are only discovery aids whose claims must be confirmed
against these files.

The browser build is self-contained. `npm run sync:assets` reads the primary installed tree
and writes the codebase-owned runtime set to `public/game`: NMO/WAV/TGA/TXT stay byte-exact,
BMPs are repacked losslessly as PNG, and the Atari AVI is decoded to lossless APNG. Every
output has a checksum in `public/game/_manifest.json`; Vite copies the whole set to `dist/`.
Neither the dev server nor the production build serves `Ballance_bin` directly.

| Path | What it is | Port relevance |
|---|---|---|
| `base.cmo` | Virtools composition: engine bootstrap + all game logic graphs | Logic reference only — not convertible |
| `3D Entities/Level/Level_01..12.NMO` (~1–2 MB each) | Per-level scenes: floor/rail/wall meshes, materials, modul placements (as `PH` placeholder objects), and Virtools **groups** carrying semantics (`Sector_XX`, `Phys_Floors`, `Phys_FloorRails`, checkpoints…) | **Primary conversion target** |
| `3D Entities/PH/*.nmo` | Prefabs: 3 balls, 3 trafos, checkpoint (`PC_TwoFlames`), start point (`PS_FourFlames`), end balloon (`PE_Balloon`), extra life/point, dome, box, and 13 `P_Modul_XX` mechanical elements | Convert each to a GLB prefab |
| `3D Entities/Balls.nmo` | Ball meshes + materials (paper/wood/stone + lightning spheres) | Convert |
| `3D Entities/Menu.nmo`, `MenuLevel.nmo` | 3D main-menu scene, source-authored curve camera, menus, credits, and score flow | Converted and runtime-decoded; remaining records stay in the fidelity audit |
| `3D Entities/Gameplay.nmo`, `Levelinit.nmo`, `Sound.nmo`, `Camera.nmo`, `Tutorial.nmo`, `AnimTrafo.nmo`, `Intro.nmo`, `Language.nmo`, `Musicfiles.nmo` | Framework data (camera params, sound mappings, trafo animation, language) | Reference / partial conversion |
| `Textures/` (200 BMP/TGA images) | All surface textures + UI | BMP → lossless PNG; TGA byte-exact |
| `Textures/sky/` (60 files) | 12 skyboxes (A–L) × **5 faces** — Back/Down/Front/Left/Right. Ballance skyboxes have **no top face**; the fog color closes the dome | Convert; special-case the missing +Y face |
| `Sounds/` (62 WAV, ~52 MB) | Hit sounds per material pair (`Hit_Stone_Wood`…), rolling loops per pair (`Roll_*`), death sounds (`Pieces_*`), misc SFX, and music (5 themes × 3 variations + atmos) | Copy byte-exact |
| `Text/Tutorial1..5.txt` | Tutorial overlay strings | Copy byte-exact |
| `Database.tdb` | Highscore DB (proprietary) | Replace with `localStorage` |
| `Bin/`, `BuildingBlocks/`, `Managers/`, `Plugins/`, `RenderEngines/` | Virtools runtime DLLs | Irrelevant |

The current exact/lossless runtime set is 86.4 MiB of file contents; the complete production
directory is about 111 MiB on disk. The untranscoded WAV music is the bulk.

---

## 2. Key ecosystem tools (all verified to exist, maintained by the Ballance modding community)

- **[libcmo21](https://github.com/yyc12345/libcmo21)** — C++ library reading/writing Virtools 2.1
  files with zero Virtools dependency (reverse-engineered from `CK2.dll`/`VxMath.dll`). Ships
  **BMap**, a dynamic library purpose-built for loading Ballance maps, and **PyBMap** Python
  bindings. Also includes **Unvirt**, an interactive NMO inspector — useful for debugging.
- **[BallanceBlenderHelper (BBP)](https://github.com/yyc12345/BallanceBlenderHelper)** — Blender
  plugin (Blender 3.6 LTS+) that imports/exports NMO directly: meshes, materials, textures,
  transforms, groups. The workhorse for the asset pipeline.
- **[nmo2escn](https://github.com/yyc12345/nmo2escn)** — converts maps for the OpenBallance
  (Godot) project and, importantly, **emits JSON files describing Virtools grouping data** in
  two established schemas (OpenBallance-style and imengyu-style). Steal the schema.
- **[Ballance Unity Rebuild](https://github.com/imengyu/Ballance)** (GPL-3.0) — useful
  complementary prior art and a way to identify areas worth auditing. It is not a source of
  truth: values and behavior are re-derived from this install's original NMO/CMO graphs,
  DLLs, database, text, and manual rather than copied from the rebuild.
- Prior art proving web feasibility: a [Ballance imitation demo in Three.js + Ammo.js](https://discourse.threejs.org/t/ballance-imitation-demo-using-three-js-and-ammo-js/6773).

---

## 3. Phase A — Asset pipeline (implemented)

The active pipeline is `scripts/sync-game-assets.mjs`. It reads the local, read-only original
tree and writes `public/game` plus `public/game-derived`. Those outputs are committed as the
port's owned runtime asset set and copied into production builds. Re-running the script is a
deliberate source refresh; normal dev/build operation has no dependency on the original tree.

### 3.1 Geometry + semantics: direct NMO runtime parsing

The implemented path does not convert geometry to GLB. `src/formats/ck2/` parses the
source-exact NMO at runtime, retaining meshes, materials, texture slots, transforms, groups,
animations, parameters, and raw chunks. `src/engine/sceneBuilder.ts` converts Virtools'
left-handed data into Three.js. This avoids a Blender dependency and preserves behavioral
records for source-lock tests.

The placement model remains important: level files contain placeholder objects such as
`P_Modul_03_01`; their transforms say where an instance belongs, while `PH/P_Modul_03.nmo`
defines what it is. Runtime loads the PH prefab, rebuilds its authored parent hierarchy, and
instantiates it at each placeholder transform.

### 3.2 Textures

The synchronization script repacks all 184 BMPs to lossless PNG while preserving their
source request name as `<name>.bmp.png`; 16 TGAs stay byte-exact because the port's decoder
handles their palette/RLE/alpha semantics directly. Skyboxes use all 60 authored images:
12 sets × five faces, with no top face. Runtime builds a five-sided cube and closes the open
direction with the source horizon color.

### 3.3 Audio

The implementation keeps all 62 source WAVs byte-identical and decodes them through Web
Audio. This avoids codec drift in a fidelity build. The naming encodes the material matrix:
`Hit_<ball>_<surface>` and `Roll_<ball>_<surface>`; `Sound.nmo/BallSound` supplies the exact
row/column routing.

---

## 4. Phase B — Runtime architecture

### 4.1 Stack

- **Vite + React 19 + TypeScript (strict)**
- **Three.js, vanilla, engine-owned canvas** — not react-three-fiber. A fixed-timestep
  physics game with lots of imperative per-frame state is cleaner with an engine core that
  owns the loop; React renders the DOM UI (menus, HUD, dialogs) above the canvas.
- **Physics: Rapier** (`@dimforge/rapier3d-compat`) — WASM rigid bodies, trimesh colliders,
  CCD, and joints, wrapped by a 66 Hz compatibility layer recovered from the shipped IVP
  runtime. Original coefficients are never treated as generic Rapier tuning values: the
  port applies IVP's explicit pre-force damping law itself, converts `SetPhysicsForce` from
  one impulse per PSI, and uses the source multiplicative contact coefficients.
- **State bridge: zustand** (engine writes, React subscribes) + a tiny event bus.
- **Audio: Web Audio** via `THREE.PositionalAudio` + a music state machine.
- Persistence: `localStorage` (highscores, unlocked levels, key bindings) replacing `Database.tdb`.

### 4.2 Suggested repo layout

```
ballance-web/
  scripts/sync-game-assets.mjs
  public/game/            # committed deployable NMO/WAV/TGA/TXT/lossless PNG tree
  public/game-derived/    # lossless APNG intro movie
  tools/                  # binary archaeology and extraction helpers
  src/
    ui/                   # React: menus, HUD, level select, options, tutorial overlays
    engine/
      assets.ts           # static bundled-asset resolver and NMO cache
      sceneBuilder.ts     # direct runtime CK2/NMO scene construction
    game/                 # 66 Hz physics/gameplay, camera, moduls, effects, audio
```

### 4.3 Core systems to reimplement (the actual work)

1. **Ball + input.** Arrow keys apply a camera-relative horizontal force; no jump. Three ball
   types with distinct mass / push force / friction / restitution / damping — decode the
   original Physicalize and controller graphs rather than guessing. Falling below the sector kill
   plane → life lost → respawn at current checkpoint. `Pieces_*` belongs to trafo shatter,
   not ordinary falls.
2. **Camera rig.** `Camera.nmo` authors the 58° 4:3 target camera (near 3, far 1200), its
   22-unit horizontal / 35-unit vertical slot, and the target/orientation hierarchy.
   `Gameplay.nmo` supplies two `TT Set Dynamic Position` controllers: the target follows the
   ball at force `(10,10,10)`, while the camera follows the rotated slot at force
   `(5,.8,5)` and damping `(.5,.3,.5)`. The plugin DLL's exact recurrence is implemented,
   rather than a generic SmoothDamp. Shift+←/→ applies the source two-key CK2dCurve over
   250 ms in 90° steps. Space immediately switches vertical force to 2 and offset Y to -50;
   releasing it restores force .8 and offset 0. Camera orientation persists across deaths.
   `Level_Finish` disables navigation and reparents `Cam_Pos` to null: its world slot freezes
   while the target controller keeps tracking the ball, producing the source finish framing.
3. **Sector/checkpoint system.** Levels are partitioned into `Sector_XX`. Reaching a
   checkpoint (`PC_TwoFlames`) completes the sector: its source `TT Scaleable Proximity`
   checks a strict 6.5-unit all-axis sphere around the big flame, whose prefab-local centre is
   `(0,1.49484575,0)`. The previous sector's moduls deactivate and the next sector's
   activate/reset. Source `TT Scaleable Proximity` gates wake initially frozen moving
   assemblies before contact; these use each prefab's authored target, XZ distance, adaptive
   frame cadence, and strict boundary. Death resets the active sector's moduls. End = enter the strict 1-unit
   all-axis sphere around `PE_Balloon_Platform` → source multi-body fly-off,
   fixed-position/look-target camera,
   three-second `SkyLayer` prelit fade, then the source `Wait` graph. Levels 1–11 send
   `End Level` after another 10 seconds; level 12 waits 23 seconds. Escape, Enter, or Space
   can skip only that post-fade wait. `base.cmo` routes `End Level` to `Menu_Score`.
4. **Trafos.** `P_Trafo_{Paper,Wood,Stone}` transform the ball type on contact, with the
   `AnimTrafo` ring animation and old-ball piece burst. The lightning sphere belongs only
   to ball birth/respawn. Its mesh deliberately uses out-of-range UVs with the serialized
   repeat address mode, `ONE/ONE` additive blending, and three black-background source
   bitmaps to form the branching white-violet arcs; clamping those UVs creates an incorrect
   smooth purple shell.
5. **Scoring/lives.** Level point budget counts down at the original two points/second;
   remaining points bank at level end. `P_Extra_Life` uses its source 2-second CK2dCurve
   bob/squash animation, is shown only inside its 60-unit XY proximity gate, collects inside
   the authored strict 4.5-unit all-axis sphere, awards one life after 317 ms, and reappears
   when its active section restarts. `P_Extra_Point` enables its orbit only inside an 80-unit
   all-axis gate, then activates inside the authored strict 3-unit sphere for +100 and sends six
   original sprites outward for 1000 ms, then pursues the ball using the shipped
   `TT_Gravity_RT.dll` Verlet update. Each real satellite contact adds +20 (220 total), while
   checkpoint crossing discards any remaining satellites. Point extras never reappear. Every
   pickup is owned by exactly one source `Sector_NN` group across all 12 levels; inactive-sector
   scripts cannot animate, collect, or respawn.
6. **Audio logic.** Impact sounds are chosen by (ball material × surface material × impact
   speed), and rolling loops use the source contact delays and linear speed controls. The
   exact roll rules are volume `min(1,speed*.05)`, pitch `0.5+speed*.01`, and identical `.3 s`
   contact-on/off delays. Surface hit detectors use stone `(min2,max30,sleep1)`, wood
   `(2,14,1)`, metal `(2,14,2)`, and dome `(1,15,1)`; volume is `speed/max` after a strict
   minimum gate. `Sound.nmo`
   runs atmosphere (uniform 0–15 s delay) and theme (enabled after 7 s, uniform 0–50 s delay)
   as independent equal-weight three-track schedulers with immediate repeats allowed. The
   last checkpoint switches only the theme off; its flat loop uses one strict 200-unit
   proximity threshold. The serialized 200/250 exactness range deterministically scales checks
   from 5 to 20 frames; it is neither hysteresis nor randomness. Both Start/End Music fades are 1 s.
   Levels 1–11 finish with `Music_Final`; level 12 selects only `Music_LastFinal`. Static level
   geometry keeps independent `Sound_HitID_01..03` and `Sound_RollID_01..03` maps—21 authored
   entity assignments differ—so impact-start and continuous-contact detectors must not share a
   lookup. Menu message players likewise retain their one-66-Hz-tick restart edge and gain 1;
   the two immediate score-counter players alternate to permit overlapping 37 ms ticks.
7. **Menus/UI in React.** Main menu (optionally rendering the converted `MenuLevel` 3D tower
   behind it), level select with unlock progression, pause, options, tutorial text from
   `Text/*.txt`, and the original sprite-font HUD (points and lives). The life display uses
   `Camera.nmo`'s exact normalized CK2dEntity rectangles and `Gameplay.nmo`'s reserve-life
   construction: the hidden source template is copied for the current attempt plus every
   reserve, beginning one 0.0387 X step to the left, with the hook following the leftmost
   copy. Reserve changes also retain `Gameplay_Energy`'s serialized two-stage animation:
   an added sphere stays hidden while the hook moves left for 300 ms, then fades in for
   300 ms; a removed sphere fades out for 300 ms before the hook moves right for 300 ms.
   The HUD is constructed only after level loading, so a restart initializes the four
   starting spheres immediately instead of replaying pickup animations. `Deactivate Ball` tests
   the reserves before subtracting one, so three initial reserves correctly provide four
   attempts and Game Over occurs only on the next fall from zero. The points display likewise
   uses `Camera.nmo`'s complete background/glow atlas regions and exact screen rectangles;
   `Gameplay_Energy` supplies right alignment, two-pixel margins, `.8/.9` font scale,
   white-to-black color, down-right shadow, and the 500 ms `Extrapoint` glow fade. Its
   `Text Properties=1` enables `Screen Proportionnal` rasterization: normalized glyph metrics
   scale against the active centered 4:3 render target, while Space X remains a literal pixel
   advance. Fixed 512x512-atlas cell sizing is therefore not source-equivalent. Menu screens
   likewise use `Menu.nmo`'s exact 4:3 rectangles and material-specific atlas UVs: a 40%-wide
   center band, one-column 12-level selector, fixed highscore/options fields, inactive-state
   special-atlas sprites, and the exact 23-row credit fader. Credit newlines/spaces remain
   verbatim, fade-in/out are fixed at 500 ms, page wait is `copy.length*50+1500 ms` (with
   the first row reduced by 2000 ms), and the authored two-logo 5 s/6.5 s epilogue precedes
   the 1 s repeat delay. End Level follows the serialized
   Score → optional name entry → context-Next highscore → End menu chain. Score timing and
   reserve conversion are behavior-driven, including the 200 ms fades, 1/5/25 accumulated
   counter steps, 610 ms life subtraction cadence, and three authored skip keys.
8. **Source scene lighting and cloud motion.** The embedded CKScene in `base.cmo` stores
   ambient `0x000F0F0F`. Because Virtools has a distinct per-material ambient channel, the
   renderer folds `materialAmbient * sceneAmbient` into the texture-modulated emissive term
   instead of using Three's diffuse-based `AmbientLight`. `Light_Ingame` remains the single
   active+specular directional source, tinted only by the `AllLevel.Light` values for levels
   9 and 12. `SkyLayer` uses the twelve `AllLevel.Skytranslation` vectors through the
   source `Per Second -> Texture Scroller` behavior rather than a common guessed rate.
9. **Shipped procedural sky geometry.** `MenuLevel.nmo` and `Gameplay.nmo` instantiate the
   `TT Sky` prototype from `TT_Toolbox_RT.dll`; they do not use an arbitrary engine skybox.
   Static recovery of the DLL's `TT SkyAround` runtime function establishes a four-sector
   camera-centered, world-aligned prism whose side materials are ordered Back, Right, Front,
   Left, followed by a four-triangle Down fan. The outward-wound object is rendered first with
   both Z testing and Z writes disabled. Ballance enables its quadratic side option, which
   derives the height from one radius chord, and disables the top material entirely. The menu
   serializes radius 70 and distortion .1; gameplay serializes radius 100 and distortion .15.
   The port reconstructs the DLL topology and D3D UVs directly, including the diamond-sector
   orientation and wrap addressing, instead of adding an unowned zenith cap.

### 4.4 Moduls present in this install (each = one TS behavior class)

`P_Modul_01, 03, 08, 17, 18, 19, 25, 26, 29, 30, 34, 37, 41` — the mechanical elements
(seesaws, swinging boards, fans that push the paper ball, elevators, pushable blocks and
pillars, breakaway/trapdoor floors, dome cage, etc.), plus the singletons: `P_Ball_*`,
`P_Trafo_*`, `PC_TwoFlames`, `PS_FourFlames`, `PE_Balloon`, `P_Extra_Life`,
`P_Extra_Point`, `P_Box`, `P_Dome`.

Don't guess behaviors from names. The matching original `PH/*.nmo` behavior
graph and shipped runtime DLL are the primary authority for every modul.
External rebuilds may explain an opaque enum or supply a complementary asset,
but cannot override the original binary. Each TS class builds source-authored
bodies/joints and implements its serialized `activate() / deactivate() /
reset()` sector lifecycle and sound/control graph.

Implement in level order of appearance — Level 1 needs only a handful.

---

## 5. Milestones

- **M0 — Pipeline spike (highest information value).** Manually run BBP on `Level_01.NMO`,
  export GLB + groups JSON, render statically in Three.js with skybox + fog. Proves the
  entire asset thesis before any engine code.
- **M1 — Rolling.** Rapier world from `Phys_*` groups, wood ball with input + camera rig,
  kill plane, respawn. *The game becomes fun here — this is also the feel checkpoint.*
- **M2 — Level loop.** Sectors, checkpoints, balloon finish, lives/points, HUD, death/restart.
- **M3 — Moduls + trafos.** Level 1's set first, then per-level until all 13 exist.
- **M4 — Feel pass.** Side-by-side against the original (it runs under dgVoodoo/Wine or on a
  Windows box): tune ball constants, contact materials, and especially **rail behavior**.
- **M5 — Menus, audio, persistence, polish.** Music machine, options, highscores, tutorial,
  loading screens, the menu tower.

Ship levels progressively — a deployed build with Level 1 fully playable beats 12 half-broken levels.

---

## 6. Risks, honestly ranked

1. **Physics compatibility — the make-or-break.** The browser still solves contacts with
   Rapier rather than the shipped IVP engine, so all-level rail/contact validation remains
   essential. The surrounding integration is source-derived: fixed 66 Hz PSI, exact
   `Physicalize_GameBall` and prefab values, independent input axes, per-PSI actuator impulses,
   IVP's explicit damping before force/gravity, multiplicative friction/restitution, authored
   mass centers/inertia, CCD, and internal-edge-fixed level trimeshes. Any remaining solver
   difference is measured as a defect rather than hidden by hand-tuned ball constants.
2. **Group/attribute completeness.** If BBP's export misses some semantic data (per-object
   attributes beyond groups), fall back to PyBMap for a targeted extractor. Validate against
   nmo2escn's output early.
3. **Modul behavioral fidelity.** Mitigated by the Unity Rebuild reference; budget real time
   per modul for observation and tuning, not just coding.
4. **Texture quirks.** TGA alpha, palettized BMPs, additive-blend materials (flames, glow) —
   handle per-material in the pipeline spike.
5. **Asset distribution policy.** The engineering requirement is a self-contained build, now
   satisfied by `public/game`. Any licensing or public-hosting policy remains a repository-owner
   decision and does not change the original binaries' role as primary technical authority.

---

## 7. First concrete steps

```bash
# 1. Blender 3.6 LTS + BallanceBlenderHelper release zip
# 2. Import "3D Entities/Level/Level_01.NMO", poke around: find Sector_* groups,
#    Phys_Floors, placeholder objects — confirm the semantic layer survives
# 3. Export GLB, load in a 20-line Three.js scene
# 4. If that works end-to-end, scaffold the repo and script the pipeline
```
