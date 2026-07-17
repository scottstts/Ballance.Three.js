# Porting Ballance (2004) to React + TypeScript + Three.js

## TL;DR

The game splits cleanly into two kinds of content:

1. **Assets** (level meshes, textures, sounds, object placements, semantic groupings) — locked
   inside Virtools 2.x binary files (`.NMO`/`.CMO`, magic `Nemo Fi`), but the Ballance modding
   community has fully reverse-engineered the format. Existing tools convert everything to
   open formats mechanically. **No hand-remodeling needed.**
2. **Behavior** (ball physics, camera, moduls, checkpoints, scoring, menus) — implemented as
   Virtools visual-scripting behavior graphs inside `base.cmo` / `Gameplay.nmo`. These are
   **not portable** and must be reimplemented in TypeScript. The good news: open-source
   rebuilds (notably the Ballance Unity Rebuild) already did the archaeology and serve as a
   behavioral spec.

So the port = **one-time asset conversion pipeline** + **TypeScript reimplementation of the
game rules** on Three.js + a physics engine, with React as the UI shell.

---

## 1. Inventory of `Ballance_bin/Ballance`

| Path | What it is | Port relevance |
|---|---|---|
| `base.cmo` | Virtools composition: engine bootstrap + all game logic graphs | Logic reference only — not convertible |
| `3D Entities/Level/Level_01..12.NMO` (~1–2 MB each) | Per-level scenes: floor/rail/wall meshes, materials, modul placements (as `PH` placeholder objects), and Virtools **groups** carrying semantics (`Sector_XX`, `Phys_Floors`, `Phys_FloorRails`, checkpoints…) | **Primary conversion target** |
| `3D Entities/PH/*.nmo` | Prefabs: 3 balls, 3 trafos, checkpoint (`PC_TwoFlames`), start point (`PS_FourFlames`), end balloon (`PE_Balloon`), extra life/point, dome, box, and 13 `P_Modul_XX` mechanical elements | Convert each to a GLB prefab |
| `3D Entities/Balls.nmo` | Ball meshes + materials (paper/wood/stone + lightning spheres) | Convert |
| `3D Entities/Menu.nmo`, `MenuLevel.nmo` | 3D main-menu scene (the menu tower) | Convert (later milestone) |
| `3D Entities/Gameplay.nmo`, `Levelinit.nmo`, `Sound.nmo`, `Camera.nmo`, `Tutorial.nmo`, `AnimTrafo.nmo`, `Intro.nmo`, `Language.nmo`, `Musicfiles.nmo` | Framework data (camera params, sound mappings, trafo animation, language) | Reference / partial conversion |
| `Textures/` (84 files, BMP/TGA) | All surface textures + UI | Convert to PNG |
| `Textures/sky/` (60 files) | 12 skyboxes (A–L) × **5 faces** — Back/Down/Front/Left/Right. Ballance skyboxes have **no top face**; the fog color closes the dome | Convert; special-case the missing +Y face |
| `Sounds/` (62 WAV, ~52 MB) | Hit sounds per material pair (`Hit_Stone_Wood`…), rolling loops per pair (`Roll_*`), death sounds (`Pieces_*`), misc SFX, and music (5 themes × 3 variations + atmos) | Transcode to web codecs |
| `Text/Tutorial1..5.txt` | Tutorial overlay strings | Copy as JSON |
| `Database.tdb` | Highscore DB (proprietary) | Replace with `localStorage` |
| `Bin/`, `BuildingBlocks/`, `Managers/`, `Plugins/`, `RenderEngines/` | Virtools runtime DLLs | Irrelevant |

Raw asset footprint: ~136 MB → expect ~30–40 MB web-ready after transcoding (audio is the bulk).

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
- **[Ballance Unity Rebuild](https://github.com/imengyu/Ballance)** (GPL-3.0) — complete
  open-source reimplementation. Loads original NMO levels; reimplements **every modul
  behavior**, ball physics constants, sector rules, scoring. This is the **behavioral spec**
  for the TS rewrite. (License note: re-derive behavior rather than transliterating C# if a
  non-GPL license matters to you; if not, just make the port GPL-3.0.)
- Prior art proving web feasibility: a [Ballance imitation demo in Three.js + Ammo.js](https://discourse.threejs.org/t/ballance-imitation-demo-using-three-js-and-ammo-js/6773).

---

## 3. Phase A — Asset pipeline (offline, run-once, lives in `tools/`)

Everything below reads from a **local, user-supplied** game folder and writes to
`public/assets/` (gitignored — the assets are copyrighted by Atari/Cyparade and must not be
committed or publicly deployed; only the code is yours to license).

### 3.1 Geometry + semantics: NMO → GLB + groups JSON

Recommended path — **headless Blender + BBP**, scripted:

```
tools/export_level.py   (run via: blender --background --python …)
  for each Level_XX.NMO:
    1. BBP import (meshes, materials, texture refs, transforms, groups)
    2. export Level_XX.glb (glTF binary, Y-up right-handed — Blender handles the
       axis conversion from Virtools' left-handed space; verify winding/normals once)
    3. dump Level_XX.groups.json: { objectName: [groupNames…] } — mirrors the
       nmo2escn schema. This is the level's entire semantic layer:
         Sector_01..N            → progression sectors
         Phys_Floors             → static trimesh colliders, floor material
         Phys_FloorRails         → static colliders, rail material
         Phys_FloorStopper       → invisible walls
         PS_Levelstart / PC_Checkpoints / PE_Levelende
         P_Extra_Life / P_Extra_Point / P_Trafo_* / P_Modul_XX placements
         DepthTestCubes, shadow/decor groups, …
  same for PH/*.nmo prefabs, Balls.nmo, MenuLevel.nmo
```

Fully-scriptable alternative (no Blender in the loop): **PyBMap** → custom glTF writer.
More control, more code. Start with Blender; switch only if it blocks automation.

The placement model matters: level files contain *placeholder objects* (`P_Modul_03_01` etc.)
whose transforms say *where* a modul instance goes; the PH prefab GLBs say *what* it is.
Runtime instantiates prefab at placeholder transform — exactly how the original works.

### 3.2 Textures

`BMP/TGA → PNG` (Pillow or ImageMagick). Watch for: TGA alpha channels (glass, gradients,
fonts), palette BMPs, and non-power-of-two sizes (fine in WebGL2). Skyboxes: 5 faces only —
build the sky as a 5-sided cube (or cubemap with a solid-color +Y face matching the fog color).

### 3.3 Audio

`ffmpeg WAV → .m4a (AAC)` (universal browser support; Opus/OGG optional secondary). Keep
short SFX under Web Audio as decoded buffers; stream music. The naming already encodes the
logic: `Hit_<ball>_<surface>`, `Roll_<ball>_<surface>` — the impact/rolling sound matrix is
data-driven for free.

---

## 4. Phase B — Runtime architecture

### 4.1 Stack

- **Vite + React 18 + TypeScript (strict)**
- **Three.js, vanilla, engine-owned canvas** — not react-three-fiber. A fixed-timestep
  physics game with lots of imperative per-frame state is cleaner with an engine core that
  owns the loop; React renders the DOM UI (menus, HUD, dialogs) above the canvas.
- **Physics: Rapier** (`@dimforge/rapier3d-compat`) — best-maintained WASM engine, trimesh
  colliders, CCD, joints, deterministic enough. (Ammo.js is the closer-to-original
  alternative; Rapier's API/tooling wins for a new TS codebase.)
- **State bridge: zustand** (engine writes, React subscribes) + a tiny event bus.
- **Audio: Web Audio** via `THREE.PositionalAudio` + a music state machine.
- Persistence: `localStorage` (highscores, unlocked levels, key bindings) replacing `Database.tdb`.

### 4.2 Suggested repo layout

```
ballance-web/
  tools/                  # Phase A pipeline (python + shell)
  public/assets/          # generated, gitignored
    levels/Level_01.glb + Level_01.groups.json …
    prefabs/  balls/  textures/  sky/  audio/
  src/
    app/                  # React: menus, HUD, level select, options, tutorial overlays
    engine/
      core/               # loop (fixed 120 Hz physics / rAF render, interpolation), scene, loader
      physics/            # rapier world, materials table, collision-event → sound router
      ball/               # controller, ball defs (paper/wood/stone), trafo logic
      camera/             # Ballance chase rig: 90° step rotation, lift-to-survey, follow lag
      level/              # groups.json interpreter, sector manager, spawn/respawn, kill plane
      moduls/             # one class per element (see 4.4)
      audio/              # sfx matrix, rolling-loop controller, music state machine
    game/                 # top-level state machine: boot → menu → loading → playing → paused → death → finish → highscore
```

### 4.3 Core systems to reimplement (the actual work)

1. **Ball + input.** Arrow keys apply a camera-relative horizontal force; no jump. Three ball
   types with distinct mass / push force / friction / restitution / damping — pull reference
   constants from the Unity Rebuild rather than guessing. Falling below the sector kill
   plane → `Pieces_*` death effect → life lost → respawn at current checkpoint.
2. **Camera rig.** The iconic scheme: camera follows at fixed offset; Shift+←/→ rotates in
   90° steps around the ball; Space lifts the camera for overview while held. Smooth lag on
   follow, slerp on rotation.
3. **Sector/checkpoint system.** Levels are partitioned into `Sector_XX`. Reaching a
   checkpoint (`PC_TwoFlames`) completes the sector: previous sector's moduls deactivate,
   next sector's activate/reset. Death resets the active sector's moduls. End = touch the
   balloon (`PE_Balloon`) → fly-off animation → score tally.
4. **Trafos.** `P_Trafo_{Paper,Wood,Stone}` transform the ball type on contact, with the
   `AnimTrafo` animation and lightning-sphere effect.
5. **Scoring/lives.** Level point budget counts down over time; `P_Extra_Point` +points,
   `P_Extra_Life` +life; remaining points bank at level end. Exact numbers: crib from the
   Unity Rebuild / original observation.
6. **Audio logic.** Impact sounds chosen by (ball material × surface material × impact
   speed); rolling loops cross-faded by contact material with velocity-scaled volume/pitch;
   per-level music themes with variation shuffling and atmo layers.
7. **Menus/UI in React.** Main menu (optionally rendering the converted `MenuLevel` 3D tower
   behind it), level select with unlock progression, pause, options, tutorial text from
   `Text/*.txt`, HUD (lives, points, sector).

### 4.4 Moduls present in this install (each = one TS behavior class)

`P_Modul_01, 03, 08, 17, 18, 19, 25, 26, 29, 30, 34, 37, 41` — the mechanical elements
(seesaws, swinging boards, fans that push the paper ball, elevators, pushable blocks and
pillars, breakaway/trapdoor floors, dome cage, etc.), plus the singletons: `P_Ball_*`,
`P_Trafo_*`, `PC_TwoFlames`, `PS_FourFlames`, `PE_Balloon`, `P_Extra_Life`,
`P_Extra_Point`, `P_Box`, `P_Dome`.

Don't guess behaviors from names — for each modul, read the corresponding Unity Rebuild
implementation and/or observe the original, then write the TS class: constructor builds
bodies/joints from the prefab GLB, `activate() / deactivate() / reset()` hooks for the
sector system, collision handlers for sound.

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

1. **Physics feel — the make-or-break.** The original uses an Ipion/early-Havok-era engine
   whose ball-on-rail contact (two parallel curved rails) has a very particular feel, and the
   speedrun community will notice everything. Mitigations: dedicated rail-tuning test scene;
   consider a rail-assist (detect dual-rail contact, damp lateral velocity); CCD on the ball;
   fixed 120 Hz step. Accept "faithful, not identical."
2. **Group/attribute completeness.** If BBP's export misses some semantic data (per-object
   attributes beyond groups), fall back to PyBMap for a targeted extractor. Validate against
   nmo2escn's output early.
3. **Modul behavioral fidelity.** Mitigated by the Unity Rebuild reference; budget real time
   per modul for observation and tuning, not just coding.
4. **Texture quirks.** TGA alpha, palettized BMPs, additive-blend materials (flames, glow) —
   handle per-material in the pipeline spike.
5. **Licensing.** Code: your choice (GPL-3.0 if you lean on the Unity Rebuild closely).
   Assets: Atari/Cyparade copyright — local conversion for personal use is the community
   norm; don't commit or publicly host them. A public deployment would need a "bring your own
   game files" loader (user drops the folder / zip into the browser, pipeline runs client-side
   or pre-baked locally) — exactly how OpenBallance handles it.

---

## 7. First concrete steps

```bash
# 1. Blender 3.6 LTS + BallanceBlenderHelper release zip
# 2. Import "3D Entities/Level/Level_01.NMO", poke around: find Sector_* groups,
#    Phys_Floors, placeholder objects — confirm the semantic layer survives
# 3. Export GLB, load in a 20-line Three.js scene
# 4. If that works end-to-end, scaffold the repo and script the pipeline
```
