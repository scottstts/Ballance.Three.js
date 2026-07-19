# Implementation notes (agent memory)

Append-only scratchpad of things learned during the port. Read this first when resuming work.

## Architecture decisions

- **Deployable codebase-owned asset tree.** We parse Virtools NMO files directly in TS
  (`src/formats/ck2/`) at runtime and in Node tests/tools, but the browser never reads
  `Ballance_bin`. `npm run sync:assets` copies the required primary-source assets into
  `public/game`: NMO/WAV/TGA/TXT remain byte-identical, BMPs are losslessly repacked as PNG,
  and Atari AVI becomes lossless APNG. Vite copies this complete tree into `dist/`.
- Format reference: MIT-licensed libcmo21 (cloned to scratchpad; re-clone if needed:
  https://github.com/yyc12345/libcmo21). Our parser is an original TS implementation.
- Behavior reference for gameplay: imengyu/Ballance Unity Rebuild (GPL-3.0) — use for
  *constants and behavior observation only*, do not copy code (license + cleanliness).

## Project conventions

- All terminal commands via `zsh -ic '...'` (project rule). Beware nested-quote escaping; for
  anything complex use separate Edit/Write tools instead of shell string surgery.
- Node is v22.19 with **type stripping on by default**: `node tools/dump-nmo.ts` runs TS
  directly. Consequences: relative imports MUST have explicit `.ts` extensions, **no TS
  `enum`** (use `as const` objects), no parameter properties (`constructor(readonly x: T)`).
  tsconfig has `allowImportingTsExtensions`, so Vite/vitest/tsc all accept `.ts` imports.
- vitest for tests (`npm test`); parser tests read real game files and `describe.skipIf` when
  `Ballance_bin` is absent.
- `tools/dump-nmo.ts <file> [--full]` dumps any NMO's groups/textures/entities/materials —
  use it constantly when reverse-engineering level content.

## CK2/NMO format facts (verified against real files)

- Header 64B: magic "Nemo Fi\0", crc, ckVersion, fileVersion(=8), zero, fileWriteMode,
  hdr1PackSize, dataPackSize, dataUnPackSize, managerCount, objectCount, maxIdSaved,
  productVersion, productBuild, hdr1UnPackSize. Levels are uncompressed (writeMode 0);
  Balls.nmo is whole-compressed (8); base.cmo is 0x0C (viewer|compressed). zlib via fflate.
- Header part 1 (may be zlib'd independently): object table (id, classId, fileIndex, nameLen,
  cp1252 name), plugin deps, included-files blob. Data part: manager chunks (guid + len +
  body — we skip), then per-object: packSize dword + StateChunk.
- StateChunk: byte0 dataVer, byte1 classId, byte2 chunkVer(7), byte3 options; dword[1] =
  dataDwSize; payload dword array from dword[2]. Identifier linked list: data[pos]=ident,
  data[pos+1]=next dword index (0=end), payload between. ALL reads dword-granular (strings
  and byte buffers pad to 4).
- Object refs inside chunks = signed int32 index into the file object table; negative = null.
- Mesh: MATERIALS (count, then per-slot ref + reserved dword), VERTICES (count, saveFlags,
  sizeDw, then pos[] / colors / specColors / normals[] / uvs[] — Single* flags collapse to
  one value; NoNormal means compute), FACES (count, then per face 2 dwords: idx0|idx1,
  idx2|mtlIdx as 16-bit words). Vertex colors BGRA dwords (D3D ARGB layout).
- Material: MATDATA = 4 ARGB colors + specPower + texRef + borderColor + mix1 (8×4-bit:
  texBlend,texMin,texMag,srcBlend,destBlend,shade,fill,texAddress low→high) + mix2
  (bits: twoSided,zWrite,perspCorr,alphaBlend,alphaTest; then zFunc, alphaFunc, alphaRef).
- Texture: TEX_READER (embedded original-container bytes + ext + optional alpha overlay),
  TEX_COMPRESSED (raw BGR channel planes, bottom-up), TEX_FILENAMES (external names).
  Ballance levels use **external filenames only** → we load from Textures/ dir. OLDTEXONLY
  (0x002FF000) mixdata: mipmap byte, flags byte (0x1 transparent, 0x2 videoFmt, 0x4 cube),
  saveOptions byte; then transparentColor; (currentSlot if >1 slot); (videoFmt if flagged).
- 3dEntity: MESHS ident (current mesh ref + potential list), NDATA ident: entityFlags,
  moveableFlags, world matrix as 4 rows × 3 floats (row-major TRS, position in row 3),
  optional place/parent refs + zOrder by flags. **World matrices are absolute** — no
  hierarchy resolution needed for static scenes.

## Level file semantics (from Level_01 dump)

- Groups per level: `Sector_01..NN` (progression), `Phys_Floors`, `Phys_FloorRails`,
  `Phys_FloorStopper`(some levels), `PS_Levelstart`, `PC_Checkpoints`, `PR_Resetpoints`,
  `PE_Levelende`, `P_Extra_Point`, `P_Extra_Life`, `P_Trafo_*`, `P_Ball_*` (trafo-target
  placeholders), `P_Modul_XX` (modul placements), `P_Box`, `P_Dome`, `Shadow`,
  `DepthTestCubes`, and **`Sound_RollID_01..03` / `Sound_HitID_01..03`** — surface→sound
  material mapping (01=stone, 02=wood, 03=metal, matching the three BallSound columns and
  PhysicsContinuousContact outputs).
- Level_01: 356 objects, 128 meshes, 29 groups, 30 textures, 41 materials. Sectors contain
  the floor entities per stage; checkpoint/reset markers are separate groups ordered by name
  suffix (PC_Checkpoint_01... / PR_Resetpoint_01...).
- All Level_01 textures are external file refs (e.g. `Floor_Top_Borderless.bmp`,
  `Laterne_Verlauf.tga`) matching files in `Ballance/Textures/`.

## Gotchas

- `Sound_RollID_XX`/`Sound_HitID_XX` groups exist per level — use them for the audio matrix
  instead of guessing surface material from names.
- Texture name case differs from file case (e.g. `floor_top_Checkpoint` vs
  `Floor_Top_Checkpoint.bmp`) → the synchronized tree and runtime paths are normalized to
  lowercase. Source `.bmp` requests map to committed `.bmp.png` files.
- Virtools is left-handed Y-up; three.js right-handed Y-up → convert by negating Z of
  positions/normals/matrix third row+column and flipping triangle winding.

## Browser automation lessons (Claude browser pane)

- The pane tab reports document.hidden=true: rAF NEVER fires and page timers clamp to >=1s
  (tool js waits >2s can blow the 30s tool timeout). The game loop therefore has a
  setInterval hidden-driver with full catch-up (frameDt cap 1.5s when hidden).
- For deterministic gameplay verification use window.__game (dev-only debug hook):
  setPaused(true) -> input.state flags -> stepSeconds(n) -> read ballPosition()/ticks().
  This steps the 66Hz sim synchronously — throttle-immune and reproducible.
- ALWAYS setPaused(false) before taking a screenshot: the hidden-tab compositor only
  presents while the loop renders continuously; a single present() after pause reads
  black in screenshots even though the canvas contains pixels (verify via drawImage probe).
- React StrictMode double-mounts the game; window.__game is published/cleared by
  GameCanvas only for the surviving instance. Beware stale debug handles after HMR.
- Physics facts confirmed in-engine: wood ball accelerates to ~14 u/s in 3s of push;
  spawn rests at start entity pos; fall below (lowest collider - 30) respawns.

## Fidelity backlog (visual, deferred to verification pass)

- Sky face seams: Down face misaligned vs side faces (LH->RH mirroring of skybox faces
  needs empirical fix; the giant pink quad seen at start plaza IS the Down sky face).
- Rails render flat white: original uses spherical environment mapping
  (Rail_Environment.bmp) — implement matcap/env channel via material effect flags.
- Lighting: three.js has no per-material ambient; original ambient response may need a
  small shader patch (onBeforeCompile) for exact match. Camera look-down angle should be
  compared against original screenshots (rebuild constants: normal Y=30 Z=17 look-at ball).
- Shadow group planes + DepthTestCubes: original uses them for decal shadows and kill
  volumes — kill volumes still to be wired into death logic (currently plain min-Y).

## Verification status (all 12 levels, scripted browser sweep)

- Sweep procedure: boot `?level=N`, `setPaused(true)`, `setLives(99)`, teleport onto each
  `PC_TwoFlames` in order asserting sector advance, then onto the balloon asserting
  `finished`. All 12 levels pass (sector counts 4/5/5/5/5/5/5/5/5/5/6/8, modul instance
  counts 15/35/34/23/35/36/48/67/72/84/72/69).
- vitest layers: parser tests (5) + level-integrity tests (12) — `npm test`.
- CRITICAL Rapier lesson: joints attached to `setEnabled(false)` bodies PANIC the wasm
  solver mid-step and poison the world ("recursive use of an object..." on every later
  call, sim ticks stay 0). Inactive moduls must SLEEP instead (also matches IVP frozen
  semantics). Debug flags: `?nomoduls`, `?nocolliders`, `?moduls=P_Modul_17` bisect boot.
- StrictMode removed in main.tsx: double-boot raced wasm teardown and doubled asset loads.
- Sky seams fixed: LH->RH mirrors every skybox face -> mirror textures horizontally AND
  swap Left/Right images; Down face rotation.z must be 0 (no extra flip).

## Remaining fidelity backlog (post-core polish)

- Balloon finale: physical fly-off (PE_Balloon multi-body: platform 4kg + balloons 0.2kg
  buoyancy 0.1/PSI + plank chain; forces 0.37/0.31 staged shutdown) — currently the level
  ends on touch without the animation. Spec in the modul physics extraction + agent notes.
- Level 12 ends with UFO (endWithUFO) — the UFO geometry, materials, animation,
  behavior, and hyperspace graph are embedded in `PE_Balloon.nmo`; Misc_UFO
  sounds are separate. The authored finale behavior is not yet implemented.
- Flames (PS/PC), Extra Point, Extra Life, trafo, death pieces, and fan
  particles are now source-backed; do not reintroduce the former replacement
  effects listed here.
- Rails render flat white: need spherical env-map (Rail_Environment.bmp) material path.
- Ball trafo swap is instant; original swaps after the 2.3s trafo animation.
- Modul_29 repairs HingeFrame07 on every active-sector reset, as required by
  the source reset graph and deterministic fall validation.
- Feel pass vs original: ball accel/top speed close (14 u/s after 3s push) but rail-feel,
  camera angle (Y30/Z17 lookAt-ball vs original framing) and fog color/distances need
  side-by-side comparison. Rebuild alt ball constants (P_Ball_Wood mass 2 f0.6 e0.2 d0.6)
  differ from GamePhysBallData.json (mass 1.9 f0.8 e0.2 d0.9) — we use the JSON values.
- Hidden-tab automation: sweeps run at full speed via stepSeconds; real-time play needs a
  visible tab (rAF). Music/SFX can only be heard in a visible tab (autoplay gate).

## Reference-image fidelity pass (ref_images/, July 17)

- Ref set: box art (start plaza + flames + stone ball), checkpoint w/ trafo lightning +
  HUD 1857, checkpoint pair, L4 bridge + wood ball, extra-point orbits on pedestals,
  L6 maze, L1 maze + extra-life bubble + HUD 2164, L8 towers + stone ball.
- HUD (original): score bottom-LEFT in metallic rounded wire frame, beige serif digits;
  lives bottom-RIGHT as silver balls in a curved wire cradle; NO sector/level text.
  Implemented as SVG frames + CSS in src/ui/Hud.tsx.
- **CRITICAL D3D material lessons** (fixed in convert.ts):
  1. specularPower==0 means specular DISABLED (mapping it to shininess~1 with gray
     specular washes everything white).
  2. D3D fixed-function MODULATES emissive by the texture; three.js ADDS raw emissive.
     Fix: set emissiveMap = map. This single fix cured the washed-out balls/crates.
- Balls.nmo references texture names with no disk file (BallWood.bmp vs Ball_Wood.bmp):
  the pixels are EMBEDDED in the NMO; loader must fall back file->embedded->raw.
- Historical screenshot calibration (superseded by the binary recovery below):
  ambient 0.32 warm + sun 0.95 + fill 0.18. Do not restore this invented rig;
  the source has one directional light and CKScene ambient #0F0F0F.
- Effects built from original assets: Particle_Flames.bmp sprites (pink flames, big one
  on armed checkpoints, extinguish on crossing), Ball_LightningSphere1-3.bmp additive
  sphere during trafo (2.3s, then ball swap), Ball_<Kind>_pieceNN meshes for death
  shatter with piecesMin/MaxForce impulses, oil-texture bubble + silver ball for Extra
  Life, orbiting silver balls + additive rings for Extra Point, SkyLayer cloud sea at
  y~-180 with slow UV scroll, sky-horizon-sampled fog color per level.
- Remaining known deltas vs original (acceptable/documented): extra-point balls do not
  fly to the HUD on collect (flash+hide instead); L12 UFO ending approximated by the
  balloon rise (the original UFO is embedded in `PE_Balloon.nmo`); menu is DOM-based
  rather than the 3D menu tower; trafo ring animation is the lightning sphere only.

## Continuation batch (loose balls, shadows, flame states)

- **P_Ball_Paper/Wood/Stone are real gameplay props**: loose pushable balls placed on the
  course (19 in L1 alone; the stone balls before the L1 gates). Implemented as sphere-collider
  physics moduls (radius 2; constants from the prefab extraction). The trafo-target theory
  was wrong.
- Ball drop shadow: HardShadow.bmp as a floor decal under the ball via downward Rapier ray
  (exclude ball collider/body). Shadow decal textures are dark-on-white: derive alpha as
  255-luminance and force black ink ("shadow" mode of spriteTexture); glow sprites use
  alpha=luminance ("glow" mode). Using such a texture as map+alphaMap gives a black SQUARE.

### Ball shadow correction (original DLL recovered)

- The old single `4.6`-unit plane, `0.55` opacity, `30`-unit visibility, and invented
  height fade were not source behavior. `Balls.nmo` runs `TT Simple Shadow` from
  `TT_Gravity_RT.dll` with `HardShadow`, `Size Scale=1.2999999523162842`, and
  `Maximum Height=20`.
- The DLL projects the texture vertically into material channels on every intersecting
  floor mesh. It derives footprint width from the target ball's local X bounding box,
  transformed scale, and Size Scale; it does not fade with height. The browser port now
  samples its collision surfaces over that exact footprint and builds a conforming
  overlay, so ramps, domes, and moving moduls receive the projected texture.
- Checkpoint flames now follow original states: big flame only on the ARMED (next)
  checkpoint, two small flames on future ones, none once crossed. flames.arm() at boot for
  PC_TwoFlames_01 and after each crossing for the next.
- Fan modul loops Misc_Ventilator.wav through its independent 25-unit source
  sampler and the authored linear 2..25 attenuation range. The enclosing
  80-unit gate, not sector ownership alone, controls the effect.
- Extra Point collect: spheres rise ~0.35s then chase the camera and shrink (original
  fly-to-HUD approximation), then hide.
- BOOT ORDER MATTERS: AudioManager must be constructed BEFORE ModulManager.create (fan
  moduls call ctx.attachLoop in their constructors).

## Full-scope fidelity audit round (sky table, original UI, IVP semantics)

Sourced by parallel read-only audits of the Unity Rebuild + original data. Key
corrections — several earlier assumptions were WRONG:

- **Per-level sky assignment is NOT sequential.** The primary `AllLevel` table is
  L1=L, L2=E, L3=A, L4=F, L5=C, L6=H, L7=D, L8=G, L9=K, L10=B, L11=J,
  L12=I. All twelve A–L sets are used once. An earlier complementary-port audit
  incorrectly reported L2=F; the original NMO and `assets.ts` use E.
- **Original lighting = ONE white directional light + fixed-function ambient, no
  gameplay fog.** `Light_Ingame` is active+specular at (-5,15,3.6), and its
  matrix forward row gives the direction. Levels tint it only at L9 #E9E9E9 and
  L12 #969696. The CKScene render settings later proved the ambient is #0F0F0F,
  combined with each material's separate ambient color; 0.34 was an approximation.
- **Scenery placements are gray dummies.** PC_TwoFlames_NN / PS_FourFlames_NN /
  PE_Balloon(Levelende)_NN in level NMOs are untextured stand-ins; the textured
  prefabs live in PH/PC_TwoFlames.nmo etc. game.ts hides the dummies and
  instantiates the prefabs (PR_Resetpoint has no prefab — hide only). Under the
  old warm lighting the gray dummies passed as "wood" — that hid the bug.
- **Menu (primary-source correction):** day sky = C, night lightzone = M; warm
  linear fog #d3c894 100-800. `MenuLevel_Init` does not use a constant angular
  orbit: its 44-second looping Bezier Progression feeds `Position On Curve` on
  the closed four-point `I_MenuLevel_Curve`, targeting `Cam_MenuLevel_Target`
  at the origin. `Menu_atmo.wav` is a gain-1 ONE-SHOT replayed after random
  1-10s gaps (not a loop).
- **Original menu/HUD UI is fully reproducible from assets**: Button01_deselect/
  select.tga atlases (capsule 250x60 at (2,1,252,62); medium at (60,191,164,63);
  slider bar (2,102,252,28); round +/- (226,198/226)), Button01_special.tga for
  HUD pieces (score plate (105,185,135,44), under-swoosh (82,199,176,52), amber
  flash variants). Life pieces use `Camera.nmo`'s UV endpoints: ball
  (17,135,29,29), hook (1,134,15,30), curl (47,119,58,61), converted from
  multiples of 1/255 to inclusive pixels. Font_1.tga = cp1252 bitmap font in a
  16x16 grid of 32px cells
  (uppercase + small-caps — render mixed-case text and it looks original),
  Cursor.tga = the menu arrow cursor. src/ui/ogui.ts crops pieces + renders text.
- **Audio model (superseding the earlier complementary-port guesses):** roll contact
  start/end delays are both `.3000000119` for paper, wood, and stone. The serialized
  multiplication operation makes volume `min(1, speed*.05)`; Calculator stores
  `0.5+(a*0.01)` for pitch, with no Hermite curve or per-ball speed reference. Hit
  detectors are stone `(min2,max30,sleep1)`, wood `(2,14,1)`, metal `(2,14,2)`, and
  dome `(1,15,1)`. `physics_RT.dll` uses a strict `speed > min` gate and outputs
  `min(1,speed/max)` without subtracting min. Speed is the magnitude of the two bodies'
  pre-response relative velocity at the contact point, including angular velocity.
  Ball sounds are flat; BallNav activate/deactivate creates/stops their detectors.
  Each Phys_FloorStopper owns a separate `(min.3,max10,sleep.5)` detector, and
  `TT_LinearVolume` converts normalized speed with `x<=.01?0:.02*50^x` (capped at 1).
- **Music**: ~70% of scheduler slots play Music_Atmo_1..3 (volume 0.5-1), gaps
  20-30s after music, 10-20s after atmo, never the same theme variation twice in
  a row. Checkpoints play Misc_Checkpoint.wav (Music_EndCheckpoint is the FINAL
  SECTOR balloon ambient loop, with music muted ~70s). Extra life = Blob + then
  Misc_extraball at +0.317s; extra point = +100 then six staggered +20 with
  Extra_Hit.wav.
- **Death/birth**: falling plays Misc_Fall.wav, the ball keeps falling, the screen
  fades WHITE, respawn at the EXACT reset point (no +4 drop) with the lightning
  sphere + Misc_Lightning.wav; Ball Off occurs at 1s and the replacement stays
  unphysicalized for the source's 3s birth delay before control/countdown resume.
  The shatter pieces + Pieces_*.wav belong to the TRAFO (old ball
  bursts at swap) — not to death. Trafo visual = AnimTrafo.nmo ring cage
  (4 Ringparts + Bars + additive Flashfield) spun procedurally for 2.3s.
- **Scoring**: final level score = level*100 + remaining points + 200*lives, shown
  as a tally (Level Bonus / Time Points / Extra Lives / Total) with Menu_counter
  ticking and Music_Highscore. completeLevel stores that, not raw points.
- **Physics findings**: IVP combines friction AND elasticity multiplicatively →
  Rapier CoefficientCombineRule.Multiply on ball/dynamic colliders (the old Max
  restitution rule caused rail micro-bounce jitter). Rapier trimeshes need
  TriMeshFlags.FIX_INTERNAL_EDGES (=144) or flat floors feel bumpy. Push X/Z are
  INDEPENDENT axes — diagonals are sqrt(2) stronger, do NOT normalize. The paper
  ball is physicalized as its crumpled MESH (BallRadius 0) → convex hull, both
  player and loose props. The older camera values recorded here were later
  disproved by Camera.nmo, Gameplay.nmo, and TT_Toolbox_RT.dll; see the
  source-exact camera section below. UpForce/DownForce in the ball table are
  debug-only.
- **Beware prefab-vs-NMO naming**: the Unity rebuild renamed some parts (its
  "P_Modul_01_Filter" is the NMOs
## Full-scope fidelity audit round (sky table, original UI, IVP semantics)

Sourced by parallel read-only audits of the Unity Rebuild + original data. Key
corrections — several earlier assumptions were WRONG:

- **Per-level sky assignment is NOT sequential.** The primary `AllLevel` table is
  L1=L, L2=E, L3=A, L4=F, L5=C, L6=H, L7=D, L8=G, L9=K, L10=B, L11=J,
  L12=I. All twelve A–L sets are used once. An earlier complementary-port audit
  incorrectly reported L2=F; the original NMO and `assets.ts` use E.
- **Original lighting = ONE white directional light + fixed-function ambient, no
  gameplay fog.** `Light_Ingame` is active+specular at (-5,15,3.6), and its
  matrix forward row gives the direction. Levels tint it only at L9 #E9E9E9 and
  L12 #969696. The CKScene render settings later proved the ambient is #0F0F0F,
  combined with each material's separate ambient color; 0.34 was an approximation.
- **Scenery placements are gray dummies.** PC_TwoFlames_NN / PS_FourFlames_NN /
  PE_Balloon(Levelende)_NN in level NMOs are untextured stand-ins; the textured
  prefabs live in PH/PC_TwoFlames.nmo etc. game.ts hides the dummies and
  instantiates the prefabs (PR_Resetpoint has no prefab — hide only). Under the
  old warm lighting the gray dummies passed as "wood" — that hid the bug.
- **Menu (primary-source correction):** day sky = C, night lightzone = M; warm
  linear fog #d3c894 100-800. `MenuLevel_Init` does not use a constant angular
  orbit: its 44-second looping Bezier Progression feeds `Position On Curve` on
  the closed four-point `I_MenuLevel_Curve`, targeting `Cam_MenuLevel_Target`
  at the origin. `Menu_atmo.wav` is a gain-1 ONE-SHOT replayed after random
  1-10s gaps (not a loop).
- **Original menu/HUD UI is fully reproducible from assets**: Button01_deselect/
  select.tga atlases (capsule 250x60 at (2,1,252,62); medium at (60,191,164,63);
  slider bar (2,102,252,28); round +/- (226,198/226)), Button01_special.tga for
  HUD pieces (score plate (105,185,135,44), under-swoosh (82,199,176,52), amber
  flash variants). Life pieces use `Camera.nmo`'s UV endpoints: ball
  (17,135,29,29), hook (1,134,15,30), curl (47,119,58,61), converted from
  multiples of 1/255 to inclusive pixels. Font_1.tga = cp1252 bitmap font in a
  16x16 grid of 32px cells
  (uppercase + small-caps — render mixed-case text and it looks original),
  Cursor.tga = the menu arrow cursor. src/ui/ogui.ts crops pieces + renders text.
- **Audio model (superseding the earlier complementary-port guesses):** roll contact
  start/end delays are both `.3000000119` for paper, wood, and stone. The serialized
  multiplication operation makes volume `min(1, speed*.05)`; Calculator stores
  `0.5+(a*0.01)` for pitch, with no Hermite curve or per-ball speed reference. Hit
  detectors are stone `(min2,max30,sleep1)`, wood `(2,14,1)`, metal `(2,14,2)`, and
  dome `(1,15,1)`. `physics_RT.dll` uses a strict `speed > min` gate and outputs
  `min(1,speed/max)` without subtracting min. Speed is the magnitude of the two bodies'
  pre-response relative velocity at the contact point, including angular velocity.
  Ball sounds are flat; BallNav activate/deactivate creates/stops their detectors.
  Each Phys_FloorStopper owns a separate `(min.3,max10,sleep.5)` detector, and
  `TT_LinearVolume` converts normalized speed with `x<=.01?0:.02*50^x` (capped at 1).
- **Music**: ~70% of scheduler slots play Music_Atmo_1..3 (volume 0.5-1), gaps
  20-30s after music, 10-20s after atmo, never the same theme variation twice in
  a row. Checkpoints play Misc_Checkpoint.wav (Music_EndCheckpoint is the FINAL
  SECTOR balloon ambient loop, with music muted ~70s). Extra life = Blob + then
  Misc_extraball at +0.317s; extra point = +100 then six staggered +20 with
  Extra_Hit.wav.
- **Death/birth**: falling plays Misc_Fall.wav, the ball keeps falling, the screen
  fades WHITE, respawn at the EXACT reset point (no +4 drop) with the lightning
  sphere + Misc_Lightning.wav; Ball Off occurs at 1s and the replacement stays
  unphysicalized for the source's 3s birth delay before control/countdown resume.
  The shatter pieces + Pieces_*.wav belong to the TRAFO (old ball
  bursts at swap) — not to death. Trafo visual = AnimTrafo.nmo ring cage
  (4 Ringparts + Bars + additive Flashfield) spun procedurally for 2.3s.
- **Scoring**: final level score = level*100 + remaining points + 200*lives, shown
  as a tally (Level Bonus / Time Points / Extra Lives / Total) with Menu_counter
  ticking and Music_Highscore. completeLevel stores that, not raw points.
- **Physics findings**: IVP combines friction AND elasticity multiplicatively ->
  Rapier CoefficientCombineRule.Multiply on ball/dynamic colliders (the old Max
  restitution rule caused rail micro-bounce jitter). Rapier trimeshes need
  TriMeshFlags.FIX_INTERNAL_EDGES (=144) or flat floors feel bumpy. Push X/Z are
  INDEPENDENT axes — diagonals are sqrt(2) stronger, do NOT normalize. The paper
  ball is physicalized as its crumpled MESH (BallRadius 0) -> convex hull, both
  player and loose props. The older camera values recorded here were later
  disproved by Camera.nmo, Gameplay.nmo, and TT_Toolbox_RT.dll; see the
  source-exact camera section below. UpForce/DownForce in the ball table are
  debug-only.
- **Beware prefab-vs-NMO naming**: the Unity rebuild renamed some parts (its
  "P_Modul_01_Filter" is the NMO's "P_Modul_01_Filler"; its "P_Modul_41_Box" is
  the NMO's "P_Modul_41"). NMO names are authoritative here.

## Corrections to earlier "remaining deltas" (now closed)

The older delta list is superseded — as of the fidelity-audit round: the menu IS
the 3D menu tower with the original sprite/font UI (not DOM-styled), the trafo
uses the AnimTrafo.nmo ring cage + old-ball piece burst (not the lightning
sphere — that is the birth effect), extra points fly staggered (+100 then six
+20 with Extra_Hit), and death-by-fall no longer shatters (Misc_Fall + white
fade + falling ball, per the original). The approximation list that originally
followed here is historical and is superseded by later primary-source recovery:
multi-body balloon physics, the full L12 UFO, tutorial arrows/chapters, the intro
sequence, and complete option subscreens are all implemented below.

## Wave-2 audit round (camera prefab values, endgame, menus, coverage)

- **Superseded camera audit:** the values previously recorded here came from a
  secondary rebuild and are not present in the shipped camera graphs. The
  source-exact Camera.nmo/Gameplay.nmo/DLL recovery below replaces them. In
  particular, the original has no SmoothDamp, independent look target,
  timed overview lift, or death/finish follow freeze.
- **Balloon finale**: buoyancy decays (~0.15 -> 0.10 -> 0 over 43s) so the
  rise DEcelerates; the ball rides along; the win tally appears 6s after the
  pass. Port approximates with rate = max(0.35, 3.1*exp(-t/16)).
- **Trafo**: ball is snapped to trafo+2y and held (no control) during the
  2.3s ring spin; old ball bursts at the held spot.
- **Modul_29 bridge is repaired on EVERY sector reset** (not only level
  restart). Modul_08 swing starts its cycle at +F immediately; Modul_26 sack
  also starts +F first (Sequencer `Current=-1` selects Out 1, so startState 0
  in the altForce table).
- **Level coverage audit**: every functional group in all 12 levels is
  handled; 'Shadow'/'invisible'/'test' groups are redundant editor
  groupings. (Correction: later direct set comparison proves selected entities
  intentionally differ between Sound_HitID_* and Sound_RollID_*; see the
  dedicated impact/roll note below.)
  Phys_FloorWoods appears in NO level file (wood floors are tagged by sound
  groups). Only true content gap was the L1 tutorial overlay.
- **Menu truths (from Language.nmo strings)**: score rows are 'Level Bonus:'
  / 'Time Points:' / 'Extra Lives:' / 'Score:' (no "Congratulations"
  anywhere); pause = Restart Level / Exit Level; game over = Restart Level /
  Home; options = Graphics / Controls / Sound subscreens (single Music
  Volume slider; Clouds? yes/no toggle); highscore = per-level top-10 with
  names seeded by "Mr. Default" (4000..400, L12 7000..3600),
  with a post-win 'New highscore entry!' name input. All implemented; the
  win screen shows the tally then the entry then Next Level/Restart
  Level/Home.
- **Intro**: source-backed timing and layout are documented in the later
  "exact intro and light" note. The Microsoft Video 1 AVI is converted to a
  byte-identical lossless APNG at development/preview serve time rather than
  replaced by its still fallback.
- **SkyLayer**: never grow the plane (moire/speckle at grazing angles);
  keep the authored size and make it FOLLOW the camera in XZ with UV
  compensation (offset += delta/size*repeat). Clouds? option toggles it.
- Tutorial arrows in Tutorial.nmo are parked at the origin — the original
  script moves them per step. The later source-backed tutorial implementation
  now performs that movement and chapter sequencing.
- Remaining approximations recorded here were subsequently resolved except
  for the audio/mixer parity work, which remains part of the continuing audit.

## 2026-07-18 original-source cross-check

- `Ballance_bin/source1/Ballance` is the installed game tree. `source2` is an
  original UK/EU disc image payload: InstallShield CABs, the three-page
  multilingual `Quickstart.pdf`, release metadata dated 2004-04-02, and the
  same help files. Static extraction of `Setup/data1.cab` to `/private/tmp`
  showed all gameplay inputs are byte-identical to source1: every NMO/level,
  `base.cmo`, `Database.tdb`, texture, sound, and tutorial text. Treat them as
  complementary evidence; source2 authenticates the disc payload and manual,
  while source1 is the convenient byte-identical asset tree. The dgVoodoo
  files present only in source1 are later compatibility wrappers.
- The original quick-start/manual explicitly confirms: 4:3 resolutions
  (800x600 recommended, not much above 1024x768), Synch to Screen off by
  default, animated Clouds as a Graphics option, ESC pause with options still
  available, remappable movement controls, Left Shift + left/right for fixed
  90-degree camera steps, an invert-camera-rotation option, Space to raise the
  view, and permanent sequential level unlocking.
- Direct `Levelinit.nmo` data-array corrections supersede older notes/code:
  Level 2 uses `Sky_E` (not `Sky_F`), `Phys_FloorStopper` elasticity is 0.3,
  and loose `P_Ball_Stone` friction is 0.7. `base.cmo` highscore arrays contain
  only player name and score—no date. Levels 1-11 seed `Mr. Default` at
  4000..400 by 400; Level 12 seeds `Mrs. Default` at 7000..3400 by 400.
- Correction to every earlier "no UFO model" note: `3D Entities/PH/PE_Balloon.nmo`
  contains `Misc_Ufo.bmp`, `Misc_UFO_Flash.bmp`, `PE_Ufo_env.bmp`, material
  `PE_UFO_Arm`, animation `PE_UFO_Arm_A_04`, behavior `UFO`, behavior
  `Hyperspace`, and the enclosing `PE_Balloon Script`. This prefab is the
  authoritative source for the Level 12 finale; a hand-authored replacement is
  not faithful.

## 2026-07-18 behavior graph and authored UFO recovery

- The CK2 parser now decodes classes 2/3/45/46 (parameters), 6 (behavior
  links), 8 (behaviors), 9 (behavior IO), 15 (object-animation controller
  tracks), and 18 (keyed animations). Behavior NEWDATA has variable headers:
  scripts/composites use a short header while plugin building blocks include a
  prototype GUID plus optional owner/target references. Find the first counted
  reference-array boundary that consumes the payload exactly; do not assume a
  fixed header. The original Gameplay tutorial and PE_Balloon graphs are now
  covered by source-backed tests.
- Version-2 object/sound parameters store a direct CK object reference after
  the type GUID/version; they do not use the version-1 byte-length/value buffer.
  ParameterOut destination arrays expose implicit BB parameter wiring (for
  example the UFO iterator's `Target Position` output writes the Set Position
  block's local Position parameter).
- Correct CK3dEntity NEWDATA validity flags are Place `0x00010000`, Parent
  `0x00020000`, and ZOrder `0x00100000`. The earlier low-bit constants silently
  discarded hierarchy. Prefab instantiation now rebuilds parent-local matrices;
  static visuals remain unchanged while child pieces correctly inherit authored
  rotation/animation.
- The exact UFO sequence is now implemented from original data: 13 path rows
  with waits `[3,2,1,1,1,.5,.5,2,.5,.5,3,2,1.8]`, per-row force/damping,
  rows 4-6 relative to the live ball, 150 degrees/s body rotation with inverse
  top rotation, eight arm tracks of six TCB quaternion keys over 1 second,
  row-11 `Misc_UFO_anim`, ball capture after the arm cycle, and the 800 ms
  `.01 -> 20` hyperspace flash. `Misc_UFO` remains a positional loop over the
  path. The balloon flight visuals move independently while PE_Balloon_MF stays
  fixed as the path referential.
- Live browser validation (`?level=12&finish=1&nowinscreen=1`) exercised the
  full UFO sequence with no console errors; normal Level 1 rendering also
  survived hierarchy reconstruction. The `finish` and `nowinscreen` switches
  are development-only deterministic visual-audit helpers. The in-app browser
  tab and Vite server were closed immediately after validation.
- `M_FontData_01` from Menu.nmo supplies glyph source positions and advance
  metrics directly. The earlier credit UI still duplicated the 23 strings in
  TS, stripped positioning whitespace, inserted synthetic wrapping, and omitted
  the two-logo epilogue; the source-authored menu-flow correction below
  supersedes that implementation.

## 2026-07-18 source-backed level-1 tutorial

- `Tutorial2.txt` is plain Windows-1252 text split on `*`: rows 0-9 are the
  ten English chapters and TutorialArray row 10 is the terminator. The other
  numbered files are the German, Spanish, Italian, and French counterparts.
- `Tutorial_Interface` is CK class 27 (`CK2dEntity`) with normalized rect
  `(0.24332549, 0.74795353)-(0.73307371, 0.98895204)`.
  `Tutorial_Interface_Back` uses `(0.23525, 0.73995)-(0.81555, 1.0)` and the
  source graph fades it to black alpha `0.4705883`. The parser now retains
  these records instead of dropping them as `other`.
- `Gameplay_Tutorial` drives chapters 0-9. The source switch's output labels
  skip the literal name `Out 9`, but list position proves ID 8 is Checkpoints
  and ID 9 is the closing hints chapter. The final row follows after 4 seconds.
- Exact action radii recovered from the nested graphs: KeyEnd 4, ExtraLife 3,
  StoneTrafo 5, HolzTrafo 2.5, Rampe 4.5, ExtraPoint 3, Checkpoint 2.5. The
  opening has a 25-second physics-resume failsafe but still waits for RETURN.
  Q is wired only during the opening chapter.
- Tutorial.nmo supplies the actual circular, overview, direction, and downward
  arrow meshes. The circular/direction/up arrows follow the ball; the down
  arrow is reparented to the current authored marker. Chapters 4-9 freeze CK
  physics and play `Hit_Stone_Kuppel.wav` until RETURN. The browser port now
  implements this full state machine and honors remapped movement keys.
- Live in-app-browser validation covered the opening, camera, overview,
  navigation, remapped movement-key, life-extra, and Q-exit branches. The tab
  and Vite server were closed after the run.

## 2026-07-18 exact intro and light decoding

- `source1` and the statically extracted `source2` disc payload have identical
  SHA-256 hashes for `Intro.nmo`, `Textures/atari.avi`, and `Sounds/ATARI.wav`.
  The intro evidence is therefore common to both original sources.
- `base.cmo` launches `Intro_Start`, starts `Music_Theme_4_1` after exactly
  6000 ms at its serialized gain 1/pitch 1, and invokes `Intro_End` after its parallel main
  loading/minimum-delay controller completes. `Intro.nmo` itself waits 1000 ms,
  plays the 125-frame/25-fps Atari AVI for 5000 ms with `ATARI.wav` at serialized
  gain 0.8000000119/pitch 1, covers to black over 300 ms, then reveals the logo/cloud
  composition through black over 3000 ms. `Intro_End` covers in 300 ms.
- Exact CK2dEntity rectangles are used for Atari, Gravitylogo, two clouds, and
  four edge masks. The cloud UV crops come from `relativeRect`; their position
  and size tracks are linear 2200/2600 ms motions, while their shared material
  fades from alpha 1 to 0 during 1800-2600 ms. The previous third cloud,
  synthetic mask, broad CSS drift, early theme start, and key/click skip were
  not source-authored and were removed.
- Browsers do not decode Microsoft Video 1. The Vite asset middleware now
  converts the read-only AVI on demand with ffmpeg to a 165 KiB lossless APNG.
  A normalized `framemd5` comparison of all decoded RGB24 frames is identical
  between the AVI and APNG. The original `atari.bmp` remains the failure-mode
  fallback, matching `Intro_Init`'s authored fallback path.
- CK light data uses identifier `0x00400000`; its first dword packs type in the
  low byte and Active/Specular flags above it. `Light_Ingame` is type 3
  (directional), active+specular, white, power 1, range 1000, with its exact
  world forward row driving the Three directional target. The temporary point
  light interpretation was incorrect and is superseded.
- Lint, typecheck, 21 unit/regression tests, and the production build pass.
  Live in-app-browser inspection verified the lossless Atari phase, the
  logo/cloud phase, menu handoff, and Level 1 under the corrected light with no
  errors; Rapier emits only its known deprecated-init warning. The tab and
  Vite server were closed after validation.

## 2026-07-18 original module physics recovery

- `docs/modul-physics.json` and `tools/extract-modul-physics.mjs` came from a
  Unity rebuild and are not authoritative. Use the new read-only
  `tools/extract-source-physics.ts` against the original PH NMO files. Plugin
  behavior headers store the target `CKParameterIn` immediately before
  `saveFlags`; resolving source/shared parameter chains recovers exact body,
  joint, collision-mesh, force, and spring values.
- All 12 physical module prefabs now match their original `Physicalize`
  targets. Removed invented colliders on reference/visual parts; corrected
  masses, damping, elasticity, frozen flags, collision enable flags, and every
  serialized center-of-mass shift. Notable old errors included P_Modul_25's
  five nonexistent bodies and `[0,2,0]` COM (source has only Bridge and
  `[-2.5,.2,0]`), P_Modul_37's `.5` elasticity/positive COM (source is `1` and
  `[-7.5,0,0]`), and P_Modul_34 Kiste `.6/.3` friction/elasticity (source is
  `.8/.4`).
- Physicalize's numbered convex CKMeshes are compound collision shapes, not
  render meshes or trimeshes. Prefab instances retain their parsed NMO so
  unbound collision meshes can become one Rapier convex collider per authored
  hull. Compound inertia is computed at unit density, scaled to the exact
  source mass, and placed at the explicit source COM; collision-disabled rope
  bodies remain jointable but have collision/solver groups zeroed.
- `Set Physics Hinge` derives its axis from the joint referential's local Z.
  This explains why most identity frames rotate around prefab Z while
  P_Modul_17's rotated frame produces prefab Y. Sliders derive their axis from
  the two serialized frame points and honor the source's disabled limitation
  flag. P_Modul_03 and P_Modul_17 now create their authored springs.
- Source force timing supersedes Unity values: P_Modul_08 applies +force for
  500 ms, idles 500 ms, applies -force 500 ms, then idles 500 ms; P_Modul_26
  alternates its two forces every 1500 ms (not 1400), relative to the authored
  Fix/Halter referential.
- `physTable.test.ts` parses the read-only original files and checks all 12
  modules' 32 Physicalize bodies plus every hinge/ball-joint target, other
  body, and referential against runtime definitions. The suite is now 45
  passing tests. Levels 7 and 9 stress-loaded the compound bodies/joints in the
  built-in browser without runtime errors; the browser tab and Vite server were
  closed afterward.

## 2026-07-18 exact PE_Balloon physics and departure

- The former hand-authored `finishRise` is removed. `PE_Balloon.nmo` now
  drives an explicit runtime assembly: Platform (six convex hulls), Box_slide,
  eight bridge plates, four ropes, and four balloons; 17 hinges; two sliders;
  one spring; eight continuous float/rope forces; and the finish-only Box
  force. The first Platform/Platte01 hinge is broken by the source finish
  branch while the far bridge hinge remains attached to the world.
- The source's bridge and floating-object selectors reuse Physicalize
  templates, so five serialized Physicalize nodes expand to 18 assembly
  bodies (one additional node has a runtime-selected non-assembly target).
  Do not infer body count from the number of Physicalize building blocks.
- Rapier world reference bodies must inherit the attached body's authored
  rotation. Creating an identity-rotation world body under the level-end's
  180-degree placement made its last hinge and slider axes oppose their body
  frames, injecting catastrophic solver energy through the joint chain even
  though positional anchors matched within 0.0001 units.
- Virtools slider ordering is Target first, Object2 second. Preserve that body
  order in Rapier or the signed `[-30000, 0]` Box_slide limits reverse and
  block the authored departure force. Spring Position 1 belongs to Target and
  Position 2 to Object2/world; the previous endpoint reversal pushed the
  platform in the wrong vertical direction.
- Jointed overlapping pieces have pairwise Rapier contacts disabled, matching
  the IVP assembly behavior and avoiding internal contact impulses. The source
  collision-enabled flags still apply to contacts with unrelated bodies.
- `balloon.test.ts` directly parses the read-only original NMO and verifies all
  18 runtime bodies/hulls, 17 hinge targets/partners/referentials, both slider
  axes and signed limits, spring endpoints/constants, and all nine force
  targets/referentials/vectors/values. A development-only `wakeballoon` URL
  switch supports isolated stability checks without triggering level finish.

## 2026-07-18 source-exact Extra Life and Extra Point

- CK class 37 is `CKSprite3D`. The NMO parser, prefab builder, clone path, and
  dump tool now retain its material, size, transform, and hierarchy; pickups
  use the original silver-ball sprites instead of replacement Three meshes.
- Version-0 structured CK parameters begin with a dword byte count, not a byte
  count. Retaining the complete payload exposed the authored CK2dCurve data.
  `decodeCk2dCurve` reads its 12-dword control points and evaluates their
  Hermite tangents; parser regressions lock the Life Extra's seven scale keys
  and three vertical-position keys to the original bytes.
- `P_Extra_Life.nmo` supplies the bubble, floor glow, silver-ball sprite, and
  exact repeating 2000 ms animation. The scale tracks are `[1,1.2,1]` and
  `[1,.8,1]`; the bob tracks are `[0,-.4,0]` and `[0,1.2,0]`. Collection waits
  317 ms, awards one life, and hides the instance. Both the source2 English
  manual and live restart validation confirm that Life Extras reappear after a
  fall in the active section.
- `P_Extra_Point.nmo` contains the center sprite, six .25-unit satellites, and
  floor glow. Static disassembly of the shipped `TT_Gravity_RT.dll` recovered
  six orbit axes, 5 rad/s orbit speed, 1000 ms fly-away, force .12, damping
  .95, away force 1, away damping .3, width .08, and squared hit threshold 4.
  Its update is Verlet-like: `current + (current - previous) * damping +
  direction * force * dt`.
- Activation uses the graph's 3-unit 3D radius and awards +100. The center and
  floor hide, satellites fly outward then chase, and each true contact awards
  +20. The original particle settings are also retained: one emission every
  90 ms, 1000±250 ms life, .5→.2 size, white→.156862 grey, additive
  `ExtraParticle.bmp`. Crossing a checkpoint discards active satellites and
  Point Extras never respawn, matching the source2 manual's 220 total.
- Live browser validation on Level 2 confirmed +100 activation, six independent
  +20 hits, exact one-second state transition, Life Extra +1 after the source
  delay, Life Extra reappearance after death, and zero console errors. Only
  Rapier's known deprecated-init warning remains; the tab and server were
  closed afterward.

## 2026-07-18 source-exact flames and ball-birth effect

- `PS_FourFlames.nmo` and `PC_TwoFlames.nmo` now provide both the emitter
  transforms and Point Particle parameters. The start uses four small emitters;
  the checkpoint uses its centered big emitter plus two small emitters. Their
  source-alpha/one blending, 20 ms cadence, lifespan/speed/size variances, and
  linear color/size evolution replace the former complementary-port values and
  guessed axis offsets.
- `Balls.nmo`'s ball-birth graph owns a real `Ball_LightningSphere` mesh, its
  three source textures, one texture change per behavior frame, 2*pi rad/s
  rotation, a 1500 ms decoded CK2dCurve scale-up, a 3000 ms sphere lifetime,
  and a point light at local Y=9. The original 28-key 2500 ms blue flicker and
  two-key 1500 ms white fade curves are decoded at runtime rather than
  approximated.
- The graph enables `BallParticle_Frame script` after 2500 ms. Its spherical
  frame, six source emission frames, 60-particle cap, 1600+/-1000 ms life,
  1+/-0.5 speed, 2->3 size, grey-to-transparent color, and additive
  `Particle_Smoke.bmp` sprites are reproduced. Birth no longer stops when the
  one-second control lock ends; each visual component follows its own authored
  lifetime.
- `effects.test.ts` parses the read-only source files and locks the flame and
  birth values to the serialized graphs. Live Level 2 validation confirmed
  burner alignment, near-zero initial sphere scale, the delayed 60-particle
  smoke phase, final sphere/light/group cleanup, and zero browser errors. The
  full gate passes with 55 tests plus lint, typecheck, and production build.

## 2026-07-18 source-exact transformer sequence

- `AnimTrafo.nmo` disproves the old procedural counter-rotation/scale effect.
  After one source frame, all four ring pieces translate along their authored
  frame diagonals by local `(-.5,0,-.5)` over a 350 ms three-key CK2dCurve.
  The bars hierarchy then follows `(0,0,0)->(0,5.2,0)` over a four-key 2000 ms
  curve which rises, holds, and returns. The rings close over the final 200 ms
  two-key curve. The animation copies the active transformer's complete world
  matrix and material-list element 1 color, hides only its main mesh, and
  restores it at exit.
- `FlashAnim` is not a rotating/sine-opacity field. Its source one/one additive
  material retains alpha `0.6470588`; a sequencer applies alternating `+.5`
  and `-.5` horizontal texture scrolls every 50 ms. It is visible only during
  the 2000 ms bar phase. That same phase drives the transformer's shadow
  diffuse alpha `1 -> .19607845 -> 1`; because its progression returns to zero,
  the full-alpha shadow is restored before the close phase.
- `Gameplay.nmo`'s Trafo Manager uses a Euclidean `4.30000019` trigger. It
  unphysicalizes the old ball and runs the shipped `TT Set Dynamic Position`
  spring for 1350 ms with per-axis force 2, damping .7, and transformer-local
  offset `(0,-3,0)`, so the ball converges on local Y=+3. After another 1000 ms
  the old ball's source pieces burst; 150 ms later the new ball is shown and
  physicalized. This is separate from the cage's 2550 ms graph.
- The port now makes the ball kinematic/non-colliding during the source's
  unphysicalized interval, implements the DLL's damped positional recurrence,
  hides the old visual at the burst, and restores a dynamic source-defined
  collider at replacement. Live Level 2 validation covered ring/bar/flash
  phases, convergence to the target, 16 wood pieces, wood-to-stone replacement,
  source mesh restoration, final shadow alpha, texture offset, and zero errors.
  Source-backed trafo regressions bring the suite to 57 tests.

## 2026-07-18 source-exact camera controller

- `Camera.nmo` and `Gameplay.nmo` are byte-identical in source1 and the
  statically extracted source2 installer. `Camera.nmo` authors `Cam_Target`,
  `Cam_OrientRef`, `Cam_Orient`, `Cam_Pos`, and `InGameCam`; the initial camera
  slot is `(21.99987984,34.99972916,-0.00003596)` after handedness conversion.
  The target-camera chunk is perspective, vertical FOV 58 degrees, aspect 4:3,
  near 3, far 1200. The level-end graph temporarily changes far to 2500.
- `Gameplay_Ingame` continuously runs two `TT Set Dynamic Position` nodes.
  `Cam_Target` follows the ball-position frame with force `(10,10,10)` and zero
  damping. `InGameCam` follows `Cam_Pos` with force `(5,.8,5)` and damping
  `(.5,.3,.5)`. Holding CamUp switches only force Y to 2 and offset Y to -50;
  there is no lift timer and the horizontal distance remains 22.
- Static x86 recovery of `TT_Toolbox_RT.dll` at `0x10004a80` established the
  exact per-axis recurrence: `new = current + (followed-current-offset) * force
  * frameSeconds + (current-previous) * damping`, followed by
  `previous=current`. This is a discrete inertial spring, not SmoothDamp.
- Cam Navigation rotates `Cam_Orient` in 90-degree steps over exactly 250 ms.
  Its decoded CK2dCurve is `(0,0,-.0456438474) -> (1,1,1.13457529)`.
  The source initial slot is global +X, so initial Up force is global -X and
  Right is global -Z after the Virtools-to-Three handedness flip. Reset-point
  orientation is unrelated. Camera orientation persists across ball falls;
  Ball Off only toggles the target controller Off/On to reinitialize its stored
  previous position. Both dynamic controllers continue during death and the
  balloon/UFO finish. On `Level_Finish`, however, `Gameplay_Events` disables
  Cam Navigation and reparents `Cam_Pos` to null while preserving its world
  transform. The camera-position controller therefore settles on a fixed slot
  while `Cam_Target` keeps tracking the moving ball: this is the source-authored
  finish look-at framing, not a timer-invented camera mode.
- `camera.test.ts` parses both source graphs and locks all serialized values,
  plus unit-tests the recovered DLL recurrence, initial projection/placement,
  movement axes, 250 ms quarter turn, immediate overview response, and the
  world-preserving finish/Game Over slot detachment.
- Live deterministic death/respawn validation exposed a lifecycle dependency:
  the exact camera correctly followed the falling ball far below the course, but
  the old shortened respawn exposed play before it could return. `Deactivate
  Ball` actually runs a four-key 2000 ms white pulse, unphysicalizes/swaps at
  1000 ms, then `New Ball` waits 3000 ms before physicalizing. The port now uses
  those source intervals, keeps the ball kinematic/non-colliding during birth,
  and lets the continuing camera controllers settle behind the white pulse.
- Virtools `CKMessageType` values are manager-backed integers, not ordinary
  versioned parameters. The parser now retains manager state, decodes the
  `CKMessageManager` string table, and exposes `(manager GUID, int)` values.
  This directly identifies Gameplay event 11 as `Level_Finish`, 12 as
  `Game Over`, 14/16 as Ball/Cam navigation deactivation, and 20 as
  `Counter inactive`; `dump-nmo` prints names instead of guessed IDs.
- The finish branch detaches `Cam_Pos` after two behavior ticks, changes the
  camera clip to 3/2500, and runs `fadeout Sky` for 3000 ms. Despite its name,
  its exact target is the level's `SkyLayer` entity: Levelinit first sets all
  four prelit vertices to filtering color `(200/255,200/255,200/255,1)`, then
  Gameplay linearly filters them to black. The port now initializes and fades
  that buffer directly. Game Over disables camera navigation immediately and
  performs the same null-parent detach after its authored 2000 ms delay.
- Live deterministic validation moved the finish target 106.30 units while
  the camera traveled exactly 0, confirmed the normal `SkyLayer` baseline is
  exactly `0.7843137979507446`, and confirmed the three-second finish value is
  zero. The Game Over target likewise moved 106.30 units after detachment while
  the already-settled camera changed only 0.0074 units of residual spring
  convergence. No browser errors remained; the tab and Vite server were closed.

## 2026-07-18 source-exact ball pieces

- `source1` and the statically extracted `source2` installer contain byte-for-byte
  identical `Balls.nmo`, `Gameplay.nmo`, and `physics_RT.dll` files. Both source
  captures therefore support the same ball-piece behavior; the original files
  remain the authority. A complementary Unity port was useful only as a locator:
  its radial throw, three-second fade, and game-ball force-table reuse contradict
  the shipped graphs and were deliberately not copied.
- `Balls.nmo` owns 16 wood, 17 stone, and 18 paper entities. Runtime pieces now
  preserve every serialized position and orientation. `Physics Impulse` uses the
  piece itself as both referentials: local direction `(0,1,0)` is applied at
  wood `(0,1,0)`, stone `(-.05,1,.05)`, or paper `(-.03,1,.02)`. This recovers
  source torque for stone/paper and removes the former random angular velocity.
- Explosion physicalization is per graph, not per game-ball table. Wood uses
  friction 2, mass .2, damping .3/.2, impulse 1.5..3; stone uses friction 2,
  mass .8, damping .3/.2, impulse 4..9; paper randomizes friction 1..5 and mass
  .02..09, uses damping 6/.5, and impulse .5..1.3. All use elasticity 1,
  convex hulls, multiplicative IVP-style coefficients, and the authored entity
  origin as mass center.
- Paper activates 18 constant `SetPhysicsForce` nodes with world direction
  `(-1,0,+1)` and value .03. Rapier forces persist until reset, so the runtime
  must reset/reapply this value once per 66 Hz step; adding it repeatedly causes
  a false accelerating gale. Controlled live motion confirmed steady negative
  Three X/Z drift after the handedness conversion.
- `Fadeout Manager` starts its 20,000 ms timer when the transformer is entered,
  not when the old ball bursts 2,350 ms later. Piece state carries that elapsed
  transformer time; paper wind stops at source time 20 s, all named materials
  follow their decoded two-second fade, and the bodies are then removed. Sets
  from different ball kinds coexist instead of every new burst clearing all
  prior pieces.
- Wood/stone collision listeners cover only six serialized representative
  pieces for 3,000 ms. They normalize relative collision speed from 2..25 m/s,
  sleep each detector for .5 s, and cycle overlapping 2D instances of the
  corresponding `Pieces_*.wav`. Paper instead plays `Pieces_Paper.wav` once
  when its collision-sound script is activated.
- `effects.test.ts` locks piece counts, transforms, physicalization, all random
  ranges, local impulse points, wind, reset/fade timing, and collision listeners
  directly to `Balls.nmo`/`Gameplay.nmo`. Controlled Level 2 validation covered
  16/18/17 live pieces, authored rotations, simultaneous kinds, corrected paper
  wind, fade at absolute trafo time 20 s, removal at 22 s, and zero browser
  errors. The full gate passes with 64 tests plus lint, typecheck, and production
  build; the browser tab and Vite server were closed afterward.

## 2026-07-18 source-exact end-flow handoff

- `Gameplay_Events` does not open the win tally after six seconds. `fadeout
  Sky` first completes its 3000 ms linear `SkyLayer` filter, then activates the
  composite `Wait` graph. Its `Op` node is serialized with function address
  `0x24b46040`; static recovery from the shipped `ParameterOperations.dll`
  confirms that function calls `CKDataArray::GetRowCount()` on `AllLevel Array`
  (12 rows).
- The following source `Test` has mode 3. Static recovery from `Logics.dll`
  (`Test` GUID `17d66d26:726b7dec`) confirms mode 3 is strict `A < B`.
  Therefore current levels 1–11 select the 10,000 ms timer and level 12 selects
  23,000 ms. After the finish handoff, `End Level` is sent at 13 s or 26 s
  respectively; the handoff itself follows a two-behavior-frame link.
- The `3 keys` graph enables three `Key Event` nodes alongside that timer. Its
  raw DirectInput scan codes are 1, 28, and 57: Escape, Enter, and Space. A
  Pressed event sends `Menu_Click` and exits the wait early. Edges accumulated
  before the sky fade finishes are deliberately discarded because those key
  nodes are still Off in the source then.
- `base.cmo/Event_handler` routes `Dead` to `Menu_Dead Script` and `End Level`
  to `Menu_Score Script`, followed by its high-score branch. Progress/unlock
  persistence now occurs at the `End Level` handoff rather than on contact with
  the balloon. The Game Over branch's source `Delayer` is exactly 2000 ms, so
  its old 2.5 s approximation was removed.
- Source-backed regressions cover the 3 s fade, 10/23 s selector, comparison
  mode, three scan codes, 2 s Game Over delay, and base menu-script targets.
  Deterministic browser validation confirmed hidden/visible boundaries at
  12.8/13.1 s and 25.8/26.1 s, rejected an early Enter, accepted Space after
  the fade, and changed dead to gameover only after 2 s. There were no browser
  errors; the tab and Vite server were closed afterward.

## 2026-07-18 source-exact music and last-stage audio

- The old scheduler came from a complementary Unity rebuild and contradicted
  the shipped `Sound.nmo`: it alternated atmosphere/theme in a single queue,
  weighted atmosphere 70%, randomized its gain, and forbade repeated themes.
  None of those rules exists in the original graph, so they were removed.
- `Music_Manager` runs two independent graphs. `Music_Atmo` draws a uniform
  0–15 s delay, then one of three equal-weight atmosphere waves. `Music_Theme`
  is enabled after an exact 7000 ms and independently draws 0–50 s before one
  of three equal-weight per-level waves. Both Random Switch nodes serialize
  `Forbid twice the same=0`, and each graph draws a new delay only after its
  wave ends. The graphs can overlap.
- `Levelinit.nmo/AllLevel` is the primary authority for the theme assignment:
  `1,5,2,3,1,5,4,2,3,1,3,4`. Its `load Music_ThemeXX` graph reads Music column
  7 and constructs all three `Music_Theme_<N>_<1..3>.wav` objects. The matching
  complementary mapping was retained only after this direct confirmation.
- Start/End Music operate on the whole `All_Musicfiles` group with exact 1000 ms
  linear fades. End Music prevents new scheduled waves; the browser tears the
  now-inaudible sources down after the fade for resource hygiene.
- `last Checkpoint reached` switches only `Music_Theme.Off`; atmosphere remains
  live. `Music_EndCheckpoint` is a flat loop, not positional balloon audio.
  `TT Scaleable Proximity` uses one strict 200-unit threshold in both directions;
  its 200/250 exactness interval deterministically scales checks from 5 to 20
  frames. Ball Off disables the sampler and re-enables it after exactly 3000 ms.
- `Play EndMusic` compares CurrentLevel to max Level with comparison mode 1
  (Equal). Levels 1–11 play only `Music_Final`; level 12 plays only the 7.686 s
  `Music_LastFinal`. The former invented level-12 follow-up `Music_Final` was
  removed. The ending wave and atmosphere remain in the music group; the
  checkpoint loop stops one behavior tick after `Level_Finish`.
- `audio.test.ts` parses `Sound.nmo`, `Levelinit.nmo`, and `Musicfiles.nmo` to
  lock every scheduler delay, selector coefficient/repeat flag, fade, theme,
  last-stage proximity value, frame delay, loop flag, group member, and ending
  selector. Deterministic browser traversal confirmed theme-only shutdown,
  the saved initial proximity window, strict exit/re-entry threshold, and the finish
  overlap. Network capture fetched only `Music_Final.wav` for level 11 and only
  `Music_LastFinal.wav` for level 12. There were zero browser errors; the tab
  and Vite server were closed. The full gate passes with 87 tests plus lint,
  typecheck, and production build (the usual chunk-size warning only).

## 2026-07-18 TT Scaleable Proximity runtime and sector ownership correction

- Static disassembly of shipped `TT_Toolbox_RT.dll` at runtime function
  `0x1001bb70` resolves the building block exactly. `Distance` is the sole
  strict `<` range threshold. `Exactness min/max Distance` controls only an
  adaptive local-frame countdown: at/below min it uses Minimum Framedelay,
  at/above max it uses Maximum Framedelay, and between them it linearly
  interpolates then truncates toward zero. `Squared Distance?` squares the
  current distance and both exactness endpoints before interpolation. There is
  no random choice and no enter/exit hysteresis.
- The plugin string supplies the axis bit field verbatim:
  `X=1,Y=2,Z=4,XY=3,XZ=5,YZ=6,XYZ=7`. The unnamed serialized local is the
  initial countdown. A sampled unknown `Last Check` state emits EnterRange or
  ExitRange on its first check. Its `In` input resets only that transition
  state and preserves the countdown; a full graph reset restores both.
- Recovered outer gates now drive the runtime particle/pickup/end systems:
  start flames use 70/75/120, 5..100 frames, initial 2, XZ squared; checkpoint
  big/small flames use 70/75/150, 10..100 and 20..100, initial 2, XZ squared;
  Life Extra show/hide uses 60/60/70, 5..20, initial 1, XY squared; Point Extra
  orbit On/Off uses 80/85/100, 5..30, initial 2, XYZ squared; PE_Balloon's
  one-shot physics wake uses 70/75/100, 10..60, initial 1, XZ squared; Last
  Stage audio uses 200/200/250, 5..20, initial 2, XYZ non-squared.
- Every `P_Extra_Life_NN` and `P_Extra_Point_NN` placement in all twelve source
  levels belongs to exactly one `Sector_NN` group. Runtime trigger checks and
  animations are now active-sector-only, and a fall restores only Life Extras
  belonging to the restarted sector. Source-lock tests parse every level to
  prevent cross-sector regressions.
- `TT_Toolbox_RT.dll`, `Sound.nmo`, all five affected PH prefabs, and all
  twelve `Level_NN.NMO` files are byte-identical between source1 and the
  statically extracted source2 payload. The two sources independently confirm
  the recovered constants and sector memberships.
- Deterministic browser holds confirmed every strict outer boundary: start and
  checkpoint flames were off at exactly 70 and on at 69.9; the life was hidden
  at exactly 60 XY and shown at 59.9; point behavior was off at exactly 80 and
  on at 79.9; Last Stage exited at exactly 200 and re-entered at 199.9; the
  frozen balloon stayed asleep at exactly 70 XZ, woke at 69.9, and disabled its
  one-shot gate. There were zero browser errors (only Rapier's known init
  warning), and the tab and server were closed. The full gate passes with 119
  tests plus lint, typecheck, and production build; only Vite's established
  chunk-size warning remains.

## 2026-07-18 resolved HUD parity finding: life count

- The user-provided comparison exposed three guessed flex-layout errors: the
  port rendered only the reserve count, left wide gaps, and placed the outer
  cradle after the balls. Static source recovery resolves all three. In
  `Camera.nmo`, `Interface_Life_Kugel`, `Interface_Life_Startbogen`, and
  `Interface_Life_End` serialize their exact screen and atlas rectangles.
  `Gameplay.nmo/Energy` stores `StartLifes=3`; `Init Startlifes` uses the hidden
  entity as a template and its inclusive Counter creates the current attempt
  plus those three reserves. The initial HUD therefore intentionally shows
  four balls.
- A later direct screenshot comparison corrected the initial interpretation:
  `Interface_Life_Kugel` is serialized hidden and serves as the copy template,
  not an on-screen permanent sphere. The first visible copy is placed after the
  loop subtracts one `0.03869999945` X step, so three reserves render at X
  `0.9108999819`, `0.8721999824`, `0.8334999830`, and `0.7947999835`; the hook
  follows at X `0.7739999890`. This keeps the rightmost sphere inside the outer
  cradle exactly as in `ref_images/2.jpg`. `Camera.nmo` is byte-identical in
  source1 and the extracted source2 installer (SHA-256
  `c9151e50dde9d2c2703a4d35de53be414f65ec01367b1c4d3ad36709cfffe888`).
- The four-ball display also exposed a gameplay off-by-one. Source
  `Deactivate Ball` first tests the current `ActLifes` against zero. Its True
  branch runs the reset/fade sequence and only then subtracts one; its False
  branch emits Game Over without subtracting. Thus the three stored reserves
  allow three respawns and the permanent current ball is the fourth attempt.
  `fallLifeOutcome` now follows that test-before-subtract order instead of
  ending the game when the last reserve is consumed.
- `hudLayout.test.ts` locks the implementation to the original CK2dEntity
  rectangles, `Energy.StartLifes`, and gameplay spacing. At 1024x768, live DOM
  bounds were the source-projected ball X positions 972.375, 932.75, 893.125,
  and 853.5; hook X 832.203; cradle X 912. The browser capture is
  `screenshots/hud-life-source.png`; there were zero errors (only Rapier's known
  deprecated-init warning), and the tab/server were closed. `lives.test.ts`
  additionally locks the source Test/Op wiring. The full gate passes with 91
  tests plus lint, typecheck, and production build (the usual chunk warning).

## 2026-07-18 source-exact scene light and SkyLayer drift

- `base.cmo` object 0 contains an embedded CKScene. Its
  `CK_STATESAVE_SCENERENDERSETTINGS` (`0x00080000`) payload is background
  `0xFF808080`, ambient `0x000F0F0F`, fog mode/color 0, start 1, end 100,
  density 1, and two null object IDs. Static disassembly of the shipped
  `CK2.dll` CKScene Save/Load routines confirms that exact field order. The
  prior Three `AmbientLight(..., 0.34)` was not source-authored.
- D3D/Virtools stores ambient separately per material. Three's AmbientLight
  would multiply diffuse instead, so `materialToThree` folds
  `material.ambient * (15/255)` into the texture-modulated emissive term and
  removes the global AmbientLight. Active `Light_Ingame` has Specular enabled;
  powered materials now use their full source specular color rather than the
  previous arbitrary 0.5 scale.
- `Levelinit.nmo/AllLevel` Skytranslation vectors are literal per-second UV
  rates because `Gameplay.nmo/Gameplay_Sky` routes the selected row through
  `animate SkyLayer -> Per Second -> Texture Scroller`. The twelve vectors are
  `( .01,.01),(-.01,.005),(.02,.01),(-.01,.005),(.01,.005),(-.01,.005),
  (-.005,-.005),(.01,0),(-.005,.01),(.02,.01),(.01,.01),(.01,.04)`.
  The former universal `.008,.008` drift was invented.
- The three authority files (`base.cmo`, `Levelinit.nmo`, `Gameplay.nmo`) have
  identical SHA-256 hashes in source1 and the statically extracted source2.
  Regression tests derive sky letters, light colors, sky rates, ambient bytes,
  material ambient, and specular from those originals. Live Level 1 measured
  ~(.020,.020) over 2 s; Level 12 measured ~(.020,.080), with only the #969696
  directional light. Captures are `screenshots/lighting-level{1,12}-source.png`;
  the browser tab and Vite server were closed after validation.

## 2026-07-18 source-exact points HUD

- The former score HUD split `Button01_special.tga` into four guessed plate/swoosh
  crops and positioned them with a `vh` box. `Camera.nmo` instead serializes two
  complete, coincident score layers: `Interface_Points_bg` at normalized screen
  rect `(0.0150000,0.8700008)-(0.2350000,0.9800010)` with inclusive atlas crop
  `(83,186,173,65)`, and `Interface_Points_glow` at the same screen bounds with
  crop `(111,130,144,53)`. The digits entity occupies
  `(0.04999998,0.88416845)-(0.20374992,0.93416858)`.
- `Gameplay_Energy/Init` creates `Font_1` from `M_FontData_01`, then supplies
  Space `(1.5,1)`, Scale `(.8,.9)`, white-to-black color, shadow RGBA
  `(0,0,0,100/255)`, angle `2.3561945`, distance 2, and shadow size `(.8,.9)`.
  Static `Interface.dll` recovery confirms the 2D Text alignment enum maps value
  2 to Right and computes shadow displacement as
  `(-cos(angle),sin(angle))*distance`, hence `(+sqrt(2),+sqrt(2))` pixels. The
  text rectangle also carries exact two-pixel margins.
- The port now derives both complete atlas crops from the serialized UVs, uses
  every source screen rect directly, renders the independent X/Y font scale and
  right alignment, and flashes only on point increases. `Wait Message
  Extrapoint -> Show -> Bezier Progression` supplies the exact 500 ms linear
  alpha fade from one to zero.
- `hudLayout.test.ts` parses `Camera.nmo`, `Gameplay.nmo`, `Font_1.tga`, and
  `Interface.dll` to lock the geometry, crops, font properties, alignment
  meaning, shadow, and fade. At 1024x768, browser bounds matched source
  projection exactly: background `(15.359,668.156,225.273,84.477)`, digits
  `(51.195,679.039,157.438,38.398)`. Live glow samples were opacity
  `1 -> .502 -> 0`; there were zero errors (only Rapier's known deprecated-init
  warning). Capture: `screenshots/hud-score-source.png`. The tab and Vite server
  were closed afterward.

## 2026-07-18 source-exact gameplay trigger spheres

- The level loop formerly approximated checkpoints, extra lives, and the level
  end with hand-sized vertical cylinders. The primary prefab graphs provide the
  actual trigger building blocks. `PC_TwoFlames_MF Script` collects at a strict
  6.5-unit `TT Scaleable Proximity` around `PC_TwoFlames_Flame_Big`, not around
  the placement origin; that target has prefab-local offset
  `(0,1.4948457479,0)`. `P_Extra_Life_MF Script` uses 4.5 units around its
  origin, `P_Extra_Point_MF Script/TT Extra` uses activation distance 3, and
  `PE_Balloon Script` uses only 1 unit around the identity-positioned
  `PE_Balloon_Platform`.
- All three `TT Scaleable Proximity` collection nodes serialize
  `Barycenter?=false`, `Check Axis:=7` (XYZ), and `Squared Distance?=true`.
  Consequently these are strict Euclidean spheres; points on the exact radius
  are outside. The other 60-unit life, 70-unit checkpoint/balloon, and 80-unit
  point proximities in the same prefabs drive visibility or behavior wake-up,
  not collection, and must not be substituted for the inner triggers.
- The four authority prefabs are byte-identical between source1 and the
  statically extracted source2 payload. `levelTriggers.test.ts` parses the
  originals and locks each target, distance, axis/barycenter/squared flag, the
  checkpoint offset, and strict boundary behavior.
- Deterministic browser traversal teleported through every ordered checkpoint
  in all 12 levels (sector counts `4/5/5/5/5/5/5/5/5/5/6/8`) and then entered
  every one-unit platform sphere; all 12 transitioned from `playing` to
  `finished`. The point flow delivered its +100 center and six +20 satellites
  (the observed net +211 includes nine normal countdown ticks), and the life
  flow delivered exactly one life after its delay. There were zero browser
  errors; only Rapier's known deprecated-init warning appeared. The browser and
  dev server were closed afterward. The full gate passes with 99 tests plus
  lint, typecheck, and production build (the usual chunk-size warning only).

## 2026-07-18 source-exact dynamic-module wake and bridge gates

- A read-only global census (`tools/audit-proximity.ts`) now enumerates every
  `TT Scaleable Proximity` and `TT Extra` block across the original NMO tree,
  including parent graph, target, threshold, exactness interval, frame delays,
  axis mask, squared flag, and serialized initial countdown. This is the
  repeatable coverage path for eliminating remaining guessed proximity logic.
- Seven physics prefabs serialize one-shot gates before `Physics WakeUp`:
  P_Modul_01 targets its Pusher at 50 units; P_Modul_03 targets its MF at 35;
  P_Modul_19/25/30/37 target their MF at 50; P_Modul_34 targets Schiebestein at
  50. All use XZ squared distance, initial delay 2, and 10..60 adaptive checks;
  the common exactness interval is 55..100 except Modul_03's 35..50. These
  gates now wake the source-frozen assemblies instead of relying on collision
  side effects.
- P_Modul_29 previously used an invented 3.2-radius/5-height cylinder around
  Platte05 and destroyed joint index 4. Its source graph instead has an outer
  80/85/100 XZ squared wake gate (10..60 frames, initial 2), followed by a
  strict 4-unit XYZ squared stone test around moving Platte06 (exactness 8..20,
  2..30 frames, initial 2). `10 Hinges.input2` destroys HingeFrame07 between
  Platte06 and Platte07, joint index 6. All three details now match the graph.
- Deterministic Level 2 validation held a stone ball on each boundary: 80.0
  kept all nine planks sleeping, 79.9 woke them; 4.0 kept all ten joints, 3.9
  removed exactly the source joint. A forced fall restored all ten joints and
  rearmed the outer gate. There were zero browser errors (only Rapier's known
  init warning), and the tab/server were closed. The full gate passes with 127
  tests plus lint, typecheck, and production build; only Vite's established
  chunk-size warning remains.

## 2026-07-18 source-exact P_Modul_18 fan stack

- `P_Modul_18_MF Script` owns three separate `TT Scaleable Proximity`
  samplers. The outer particle-frame gate is strict 80-unit XZ with exactness
  85..100, delay 10..60, and initial delay 2. The force gate is strict 7-unit
  XZ with exactness 12..20 and delay 1..10. The sound gate is strict 25-unit
  XYZ with exactness 25..30 and delay 1..10. All use squared distance; the two
  inner samplers restart only when the outer gate enters.
- The updraft is the source constant `SetPhysicsForce` direction `(0,1,0)`,
  value `.1`, created only on `InRange` when the ball's bounding box intersects
  the authored hidden `P_Modul_18_Kollisionsquader`. The former guessed wind
  volume was removed. `Misc_Ventilator.wav` uses its serialized linear
  `TT ProximityVolumeControl` range 2..25, and the rotor's source -15 rad/s
  becomes +15 rad/s after the Virtools-LH to Three-RH conversion.
- The particle script is two simultaneous `PlanarParticleSystem` nodes on the
  exact emitter frame. Rendering mode 2 is an untextured Line layer: 100 cap,
  3 particles per behavior tick, 400+/-10 ms life, speed
  39.9999991059, white alpha .235294 to transparent. Static decompilation of
  the original DLL's exact mode-2 callback (`0x2508df80`) proves each segment
  runs from the previous particle position to its current position plus the
  authored Spreading multiplier; P_Modul_18 authors Spreading 0. Its serialized
  initial size 4 and ending size .1 are not read by the Line renderer.
  `Evolutions=2` therefore evolves color only. Rendering mode 3
  is a `Particle_Smoke.bmp` Sprite layer: 40 cap, 20 ms cadence, emission
  1+/-1, 800+/-10 ms life, speed 35.9999984503, size 2.3 to 3, white alpha
  .117647 to transparent. Both use source-alpha/one blending.
- The original runtime emits before advancing live particles for the current
  behavior tick, then renders. The port uses that same order; line endpoint
  colors are the prior and current evolved colors, matching the runtime rather
  than applying one current color to both ends.
- The prefab frame's exact matrix converts local -Z to world +Y while its
  local XY unit plane spreads the plume across the fan opening. Live Level 2
  validation after the exact emit-before-advance correction reached steady
  densities of 78 line particles and 38 smoke sprites. At the fixed 66 Hz game
  step every line segment is exactly `39.9999991059 / 66 = .6060600` units,
  and the live line plume extent was approximately 1x15.76x1.
  Crossing the 80-unit boundary cleared/hid both buffers and stopped sound,
  force, and rotation. The 7-unit gate plus collision box changed a paper ball
  from -4.97 to +3.23 vertical velocity only inside the actual wind volume.
  There were zero browser errors; captures are
  `screenshots/fan-source-particles.png` and
  `screenshots/fan-source-particles-exact.png`, and the browser/server were
  closed.

## 2026-07-18 corrected source HUD rasterization and lightning addressing

- The original-vs-port footage exposed that merely selecting the three source
  lightning bitmaps was insufficient. `Ball_LightningSphere_Mesh` serializes
  UVs from U `1..2` and V `-1..-.25`; its material serializes texture address
  mode 1, min/mag mode 2, black diffuse/ambient, white emissive, `ONE/ONE`
  blending, and disabled Z-write. Replacing the CK texture with the generic
  sprite loader had silently restored Three's clamp addressing, stretching edge
  pixels across the sphere and producing the smooth purple shell. The birth
  mesh now loads its NMO `TextureRec` objects through `loadCkTexture`, retaining
  the authored repeat wrap and displaying the black-background branching
  white-violet arcs. A source-lock test checks the out-of-range UVs and all
  relevant material modes.
- `Balls.nmo/Ball_LightningSphere` wires its looping timer directly to a
  three-output sequencer. No frequency parameter is serialized: the texture
  changes once per behavior tick, starting at texture 1. The delayed smoke
  graph similarly emits across six active behavior frames, not a guessed
  66 Hz texture clock. Rotation remains `2*pi` rad/s, sphere scale remains the
  source 0-to-1 curve over 1500 ms, and the sphere hides at 3000 ms. The smoke
  effect now owns completion, so it ends only after its six bursts and all live
  particles have expired.
- The score rectangle was source-correct but its glyph rasterization was not.
  `Gameplay.nmo/Gameplay_Energy/2D Text` stores `Text Properties=1`.
  `Interface.dll` names bit 1 `Screen Proportionnal`; static recovery of the
  draw path at `0x25391bf0` shows normalized glyph U metrics multiplied by the
  active render width and V metrics by its height, followed by the authored
  `.8/.9` font scale. The `(1.5,1)` Space X value is then added as a literal
  render-target-pixel advance. The port had instead scaled 512x512 atlas pixels
  from a fixed 32-pixel cell, making the timer much too small.
- HUD text now scales from the active, centered 4:3 game frame while retaining
  `Camera.nmo`'s normalized entity bounds, right alignment, two-pixel clipping
  margins, gradient, and shadow. At 1280x960 the live digit cell is 54 pixels
  high and a four-digit score is about 165 pixels wide, matching the original
  `ref_images/2.jpg` frame; the prior fixed-cell path was about half that size.
  Captures are `.playwright-mcp/lightning-1280x960.png`,
  `.playwright-mcp/hud-source-text-1280x960.png`, and
  `.playwright-mcp/lightning-hud-2048x1152.png`. The latter confirms that a
  2048x1152 viewport projects the HUD inside a centered 1536x1152 source frame.
  Visual inspection showed branching lightning and the corrected HUD with zero
  browser errors; only Rapier's known deprecated-init warning appeared. The
  browser tab and dev server were closed afterward. The full gate passes with
  129 tests plus lint, typecheck, and production build; only Vite's established
  chunk-size warning remains.

## 2026-07-18 source-exact collision mixer and deployable assets

- `Sound.nmo/Hit Sounds` contains four independent PhysicsCollDetection blocks:
  collision IDs 1..4 are stone `(2,30,1)`, wood `(2,14,1)`, metal `(2,14,2)`,
  and dome `(1,15,1)` for min speed, max speed, and post-hit sleep seconds.
  Static decompilation of `physics_RT.dll`'s handler proves its gate is strict
  `speed > min`; the normalized output is `min(1,speed/max)`, not the former
  `(speed-min)/(max-min)` approximation. The event input is a relative-speed
  vector, so the port snapshots all Rapier rigid-body linear/angular velocities
  before solving and measures both bodies at each solver contact point.
- `MultiRollSoundControl` multiplies `TT SpeedOMeter.Absolute Speed` by the
  serialized `SoundVolumeFactor=.05`; the operation GUID pair
  `38996b85:334e35c2` resolves to Multiplication in the shipped
  `ParameterOperations.dll`. Its Calculator expression is exactly
  `0.5+(a*0.01)`. `Roll Paper` and `Roll Wood/Stone` both serialize `.3` second
  contact-on and contact-off delays. The old complementary-port Hermite curve,
  per-ball references, pitch clamp, and `.5/.8` delays were removed.
- `HitSound Woodenflaps` is independent of BallNav and creates one detector for
  every `Phys_FloorStopper` member: min `.3`, max `10`, sleep `.5`, no collision
  ID filter. `TT_Toolbox_RT.dll`'s `TT_LinearVolume` implementation is
  `x<=.01 ? 0 : .02*pow(50,x)`, capped at 1. The old global `.25` second cooldown
  and linear gain were removed. Ball hit/roll graphs now follow BallNav
  activate/deactivate, and all detector/contact timers advance on the fixed
  66 Hz simulation clock rather than render frames.
- Runtime assets no longer come from a Vite `/bin` middleware. `npm run
  sync:assets` materializes 317 primary-source inputs under `public/game`:
  NMO/WAV/TGA/TXT are byte-identical, 184 BMPs become lossless PNGs, and
  `atari.avi` becomes lossless APNG. Paths are lowercased to preserve Virtools'
  case-insensitive lookup semantics; `.bmp` requests map to `.bmp.png`.
  `_manifest.json` pins every bundled checksum and the source authority.
  `assets.test.ts` verifies all 317 hashes and complete 12-level/26-prefab/
  62-sound coverage. `vite build` now creates a self-contained ~111 MiB `dist/`
  with 318 game files plus the APNG and no runtime reference to `Ballance_bin`.

## 2026-07-18 CKWaveSound layout and flat mixer correction

- Static decompilation of the shipped `CK2.dll` WaveSound constructor,
  save/load, `SetType`, loop, streaming, and attachment paths recovered the
  complete `CKWaveSound` state layout. The NMO parser now decodes filename,
  length in milliseconds, flag/type bits, priority, gain/pan/pitch, cones,
  min/max distance model, entity attachment, position, and direction. All 41
  `Sound.nmo` waves are type 1 flat/background, gain 1, pan 0, pitch 1, and
  unattached. Only `Misc_Ventilator_01` has the serialized loop bit.
- One-shots previously emitted through `THREE.PositionalAudio` were wrong.
  `Simple Sound Messages` uses direct flat Wave Players for lightning, level
  start, fall, checkpoint, trafo, life blob, menu cues, and extra-ball. Each
  message stops its existing player immediately and starts it one 66 Hz
  behavior tick later; the port now uses reusable restart players with that
  timing. `Play Sound Instance` in the extra-point and wooden-flap graphs has
  `2D=1`; the two extra start and three satellite hit instances serialize
  volume 1, so the former `Extra_Hit` 0.8 reduction was removed. The bridge
  tear Wave Player and UFO grab sound are also flat.
- Fan and UFO loops remain distance-reactive, but not spatially panned. Their
  type-1 WaveSounds are modulated by `TT ProximityVolumeControl`: the fan uses
  ball-to-emitter distance with a linear 2..25 range and gain 1; the UFO uses
  `Cam_Pos` to body distance with a 30..150 range. Runtime loops are therefore
  flat `THREE.Audio` objects with manually controlled linear gain. This also
  removes the old fan 0.7 volume fudge.
- `PE_Balloon.nmo/UFO` runs `TT SpeedOMeter` over 0..100 and Calculator `a+1`,
  giving the loop pitch range 1..2. The grab script's own Wave Player starts
  `Misc_UFO_anim` exactly when the one authored `Start Anim?` row begins.
  Separately, iterator row 11 stops/starts `Music_Final` one behavior tick
  later; the port had incorrectly used row 11 for `Misc_UFO_anim`. These are
  now distinct runtime events. Binary-backed tests lock all 41 sound records,
  flat-instance flags/volumes, direct-player restart edges, UFO targets,
  distance inputs, speed range, and calculator expression.

## 2026-07-18 ambient blitz and life-HUD template correction

- `Gameplay.nmo/Gameplay_Blitz` is an independent ambient system, not part of
  the ball-birth lightning. Its initially hidden, non-specular directional
  `Light_Blitz` waits 4000 ms, then repeats after a newly sampled uniform
  10000..90000 ms interval. Each flash shows the light for a decoded eight-key
  200 ms double-pulse curve; `Donner` reaches `All_Sound` after 150 ms.
  `Sound.nmo/Donner` stops the dynamically loaded flat
  `Sounds/Music_thunder.wav` immediately and starts it one behavior tick later.
- `BlitzSystem` follows those timelines on the fixed simulation clock, uses the
  source transform/power, and freezes only for the three pause-menu phases,
  matching the graph's Pause/Unpause Level binary memory. Live deterministic
  validation covered initial delay, both pulse lobes, thunder HTTP 200, exact
  hide, repeat scheduling, and a one-second pause hold with zero browser errors.
- A second life-HUD screenshot exposed that the earlier source interpretation
  still placed the hidden `Interface_Life_Kugel` template itself on screen.
  `Init Startlifes` subtracts the 0.0387 X step before positioning the first
  visible copy. At 1280x960, four-ball live bounds now match the original:
  left edges 1166, 1116, 1067, 1017; hook 991; cradle 1140..1256. The rightmost
  ball ends at 1222 instead of protruding past the cradle. Captures remain in
  `screenshots/`/`.playwright-mcp/`; the browser and server were closed.

## 2026-07-18 source-authored life-HUD transitions

- `Gameplay.nmo/Gameplay_Energy` serializes reserve changes as ordered composite
  behaviors rather than an instantaneous count redraw. `Life_Up` runs `add Life`
  (the new copy starts hidden), `Move LifeEnd` for 300 ms, then `FadeIn Lifeball`
  for 300 ms. `Sub Life` runs `sub Life`, `FadeOut  Lifeball` for 300 ms, then
  the other `Move LifeEnd` for 300 ms. All three progressions are linear.
- The React HUD now drives those exact stages from a deterministic state machine
  and serializes multi-reserve changes one source step at a time. Loading unmounts
  the HUD so a restart recreates `Init Startlifes` immediately instead of visually
  awarding old reserves one by one. Source-lock tests verify both 300 ms values,
  the parent-graph edges, and the visible phase ordering.
- `Gameplay.nmo`, `Camera.nmo`, and `Menu.nmo` are byte-identical between source1
  and the statically extracted source2 package, so the life geometry/behavior and
  the next menu audit apply to both original distributions. At 1280x960 the live
  steady-state bounds remain x=1165.945, 1116.414, 1066.875, and 1017.344 for the
  four 56-pixel spheres, with the hook at x=990.719 and the right sphere ending at
  x=1221.945 inside the cradle. No browser errors were present (only Rapier's known
  deprecated-init warning).

## 2026-07-18 source-authored menu and end-level flow

- `Menu.nmo` authors every screen in normalized 4:3 coordinates. `M_BlackScreen`
  is x=.30..70 at alpha 155/255; main/pause/end capsules are x=.35..65 and use
  atlas UV y=.51372..74510. Level select is one column of twelve x=.4031..5969
  fields at .06 Y intervals, not a two-column web grid. Highscore has two small
  level arrows, ten fixed rows, and one context-sensitive bottom capsule (`Back`
  normally, `Next` after a new score), never simultaneous Next and Back buttons.
- Main graph button edges are Start, Highscore, Options, Credits, Exit. Pause is
  Restart Level, Highscore, Options, Exit Level, Back. `Menu_Dead` exposes Restart
  Level and Home. `Menu_End` exposes Restart Level, Highscore, Options, Home, and
  Next Level (inactive on level 12). Confirmation uses the two serialized small
  Yes/No fields rather than generic OK/Back capsules.
- `base.cmo/Highscore` proves the finish chain is `Menu_Score`, optional
  `Menu_HighscoreEntry`, context-Next `Menu_Highscore`, then `Menu_End`. The old
  port skipped/reordered those screens. `Menu_Score` fades in for 200 ms, waits
  one second per stage, counts Time Points using accumulated-value thresholds
  80/500/9999 and steps 1/5/25, removes one remaining reserve every 610 ms for
  200 points, waits up to four seconds, and fades out for 200 ms. Escape, Enter,
  and Space invoke its fast path. The life removal now drives the existing source
  HUD transition rather than merely computing a bonus.
- `M_Button_Up`, `M_Button_Over`, and `M_Button_Inactive` use the deselect, select,
  and special atlases respectively. Disabled controls must therefore use their
  serialized special-atlas crop, not CSS opacity. `M_Score_Highlight` is a
  (251,255,0) alpha-masked texture at 89/255 opacity; `M_Score_Line` is an
  untextured white entity. Options root/graphics/controls/sound and credits now
  use their serialized rectangles. Credits are sequential Text Fader pages with
  the graph's `length*50+1500 ms` timing, not a continuous vertical roll.
- A same-level restart previously retained `GameCanvas` because its React key was
  only the level number. The store now increments a run id for each Load/Reset/
  Next Level action so every authored load message creates a fresh engine.

## 2026-07-18 source-authored credits fader and logo epilogue

- Credits now read all 23 rows directly from `Menu.nmo/Menu_Credits_Strings` at
  runtime. Every leading newline, embedded newline, and space is preserved; the
  title and copy are independent centered text layers, matching the two source
  `2D Text` nodes instead of a synthetic sequential/wrapped web column.
- `Text Fader` calculates its hold from the copy string only as
  `length*50+1500 ms`. Its `1st shorter` graph tests row index Equal 0 and
  subtracts 2000 ms only for that first page. Both text fonts use fixed 500 ms
  linear fade-in/out around the hold, with the serialized `.6/.65` title and
  `.4/.45` copy scales, white-to-black gradient, and half-alpha black shadow.
- Counter completion does not immediately repeat the text pages. It fades the
  `M_Credits_Logo1` source crop in/hold/out for 500/4000/500 ms, then Logo2 for
  2000/4000/500 ms, waits 1000 ms, and restarts the counter. Both logo rectangles
  and their UV halves are locked to the original NMO; `Logo.bmp` remains part of
  the repository-owned runtime asset set.

## 2026-07-18 independent impact/roll surface recovery

- The original level groups are not interchangeable: direct set comparison of
  all twelve NMOs finds 21 entity assignments whose `Sound_HitID_*` and
  `Sound_RollID_*` values differ. Examples include metal-only impact rails in
  levels 1, 2, 4-6, and 8-11, level 2's stone-only `A02_Floor_03` impact, and
  level 5's roll-only stone `A03_Modul16`. The port had built both hit and roll
  lookup tables from `Sound_RollID_*`, silently losing these authored choices.
- Static colliders now retain separate hit and roll surface maps. Collision
  start events select `Sound_HitID_*`; the delayed continuous contact mixer
  selects `Sound_RollID_*`. Prefab colliders still register the same explicitly
  decoded material for both where no independent level groups exist. A new
  all-level source-lock enumerates the complete intentional difference set.
- `Sound.nmo/Simple Sound Messages` uses reusable Wave Players: Menu_Click,
  Menu_Load, Menu_Dong, and Menu_Highscore stop immediately and play one 66 Hz
  behavior tick later at their CKWaveSound gain 1. `Menu.nmo`'s two 37 ms
  Menu_counter players alternate immediately so ticks can overlap. The React
  menu mixer now follows both paths; its former 0.7 counter/highscore gains and
  the extra Dong on the ordinary Highscore button were not source-authored.

## 2026-07-18 IVP damping and actuator integration recovery

- `Balls.nmo/Physicalize_GameBall` is the active player-ball table. Its rows are
  paper `(friction .5, elasticity .4, mass .2, linear/rot damping 1.5/.1,
  force .065)`, stone `(.5,.1,10,.3/.1,.92)`, and wood
  `(.8,.2,1.9,.9/.1,.43)`. The port's paper damping had drifted to 1.3; it is
  now 1.5 and a source-lock covers every serialized column.
- Static recovery of shipped `physics_RT.dll` shows `Physicalize` copies the
  serialized damping floats directly to IVP's `speed_damp_factor` and
  `rot_speed_damp_factor`. IVP damps before committing force impulses and
  gravity using `1-damping/66` for every coefficient Ballance serializes (with
  its exponential high-value fallback retained). Rapier instead uses implicit
  `1/(1+damping/66)` after forces. Passing the same number to Rapier was
  therefore neither mathematically nor temporally equivalent.
- Runtime dynamic bodies now keep Rapier damping at zero and apply the IVP law
  explicitly before each 66 Hz world step. This covers player/loose balls,
  every dynamic modul body, and trafo shatter pieces. A direct free-body probe
  confirmed that initial X velocity 1 plus a one-unit tick impulse at paper
  damping produces 1.97727275 (IVP target 1.97727273), while gravity remains
  exactly -20/66 on the other axis.
- `SetPhysicsForce` constructs an IVP controller whose shipped vtable returns
  priority 1500 (`IVP_CP_ACTUATOR`). It queues the force as an async impulse;
  priority-1000 gravity then damps prior velocity, commits that impulse, and
  adds gravity. `FORCE_SCALE=66` is consequently source semantics, not tuning.
  Pre-contact audio snapshots now predict this same force/gravity phase after
  damping before measuring relative point velocity.

## 2026-07-18 primary-source menu camera recovery

- Static parsing now retains `CKCamera`, `CKTargetCamera`, `CKCurve`, and
  `CKCurvePoint` records instead of treating their camera/curve payloads as
  opaque. `Cam_MenuLevel` serializes a perspective FOV of 0.9500215054 radians
  (54.4322227 degrees), 4:3 aspect, near/far 20/550, and targets the separate
  identity-position `Cam_MenuLevel_Target` at the origin.
- `MenuLevel_Init` loops a 44,000 ms two-key identity Bezier Progression into
  `Position On Curve` with Follow=false and Bank=false. The curve is closed,
  has four ordered points `[499,500,501,498]`, and the runtime evaluates their
  saved cubic-Hermite tangents in the curve's transformed referential. This
  supersedes the earlier complementary-port claim of a hand-authored -10 deg/s
  orbit around `I_Dome_MF`.
- `Menu_atmo` is a flat/background, non-looping 15,952 ms CKWaveSound at gain 1
  and pitch 1. Its graph plays once and waits a random 1-10 seconds after the
  end event; the normalized settings value passes through `TT_LinearVolume`
  before becoming its additional runtime gain.

## 2026-07-18 recorded menu stone-ball animation recovery

- `MenuLevel.nmo/Record Anim` is not a small TCB rotation track. Its controller
  payload contains 4,445 linear position keys, 4,445 linear quaternion keys,
  and 4,445 linear scale keys at animation times 0 through 4444, with declared
  length 4445. The NMO parser now walks tagged controller blocks and continues
  to decode the finale UFO's six-key TCB rotation tracks unchanged.
- `Ball_Stone Script` starts `Play Animation 3D Entity` with `Record Anim`, an
  exact 59,246 ms duration, a two-key identity progression, and Loop=true. The
  menu backdrop now linearly evaluates the saved position/scale keys, slerps
  the saved rotations, converts the absolute Virtools transform to Three's
  handedness, and repeats at the graph boundary. The first recorded position
  exactly matches `I_Ball_Stone`'s serialized world position.

## 2026-07-18 shipped TT SkyAround recovery

- `MenuLevel.nmo/TT Sky` and `Gameplay.nmo/TT Sky` use prototype GUID
  `36691920:3b261630`. Static decompilation of the read-only source1
  `TT_Toolbox_RT.dll` resolves its declaration to `TT SkyAround` and its
  procedural execute function. The behavior creates `TT_SkyAround_Mesh` plus
  `TT_SkyAround_Entity`, marks the entity RenderFirst, NoZBufferWrite, and
  NoZBufferTest, and repositions it to the active camera without inheriting
  camera rotation when Orientation Object is null.
- Ballance sets Side Materials=4, Top Material=false, Bottom Material=true,
  Quadratic SideFaces=true, side height fallback 10, and Y=0. Quadratic mode
  replaces that fallback with the radius chord: `sqrt((r-r*cos(2pi/4))^2 +
  (-r*sin(2pi/4))^2)`. Menu radius/distortion are 70/.099999994; gameplay is
  100/.149999991. The execute function clamps Distortion but does not consume
  it again when constructing this mesh.
- Each of four sectors duplicates four side vertices and emits triangles
  `[2,0,1]` and `[2,3,0]` with D3D UVs `(1,1),(0,1),(0,0),(1,0)`. Its optional
  bottom duplicates center/current/next vertices and emits `[2,1,0]`; radial
  UVs are `normalizedXZ*.5+.5`. Material order comes from both source graphs as
  Back, Right, Front, Left, Down. After the Virtools-to-Three handedness flip,
  this is a diamond-oriented open-top prism, not the port's former 1500-unit
  axis-aligned cube and invented solid zenith plane. The recovered menu/game
  radii, topology, groups, winding, and UVs now have source-lock tests.

## 2026-07-18 shipped quaternion TCB recovery

- `Play Animation 3D Entity` evaluates its `Object Animation` input through
  virtual slot `+0xe4`. Static tracing from `3DTransfo.dll` into the read-only
  source1 `CK2_3D.dll` resolves the UFO controller tag `0x45b52a02` to its TCB
  quaternion evaluator, rather than the port's former segment Slerp.
- CK2_3D lazily builds two Squad controls per key. It hemisphere-corrects both
  neighbours, uses `LnDif(a,b)=ln(conjugate(a)*b)`, applies the serialized
  tension/continuity/bias and non-uniform key-time factors, then multiplies the
  current key by the exponential of the incoming/outgoing logarithmic tangent.
  Segment phase is eased with previous `EaseFrom` and next `EaseTo`.
- The shipped `VxMath.dll` confirms Squad as Slerp of endpoint and control
  Slerps at `2t(1-t)`. Its Slerp takes the shortest quaternion hemisphere and
  uses a linear branch when `1-abs(dot) <= .01`. The browser finale now follows
  this exact path for all eight six-key UFO arm tracks; controller tags and
  representative sub-key rotations are source-locked.

## 2026-07-18 source frame modes and control remapping

- `Menu.nmo/Menu_Opt_Graphics/Update Settings` sends the Synch toggle through
  two `Time Settings` blocks from `BuildingBlocksAddons1.dll`. The DLL declares
  Frame Rate as `Free=1,Synchronize to Screen=2,Limit=3`; the true branch uses
  mode 2, while false uses mode 3 with Frame Limit Value 60. The port now uses
  `requestAnimationFrame` only for the synchronized branch and a 60 Hz limited
  presentation timer otherwise, for both gameplay and the 3D menu. The fixed
  66 Hz simulation remains independent, matching the source's separate time
  and physics managers.
- `Language.nmo/all_keys` is the complete remapping whitelist: 72 rows whose
  parameter values are one-based while integer `DB_Options` stores the
  zero-based row index. This proves the defaults exactly: 68/69/70/71 are the
  four arrows, 39 is left Shift, and 53 is Space. `SetKey/Update` searches this
  table and loops `TT_Key Waiter` after `Not Found`; it does not accept an
  arbitrary scan code and does not replace the visible value with a prompt.
  Browser remapping now accepts the same 72 physical keys, retains the old
  source label while highlighted, ignores unsupported keys, and lets Escape
  cancel. The English labels—including the shipped German-layout punctuation
  and Y/Z placement—are source-locked row for row.

## 2026-07-18 original audio gain audit

- A read-only census tool now scans every shipped NMO/CMO for CKWaveSound
  records and the sound building blocks targeting them. `Sound.nmo` contains
  41 flat/background waves at gain 1, pan 0, pitch 1, and priority .5; only
  `Misc_Ventilator_01` is serialized looping. `Intro.nmo/ATARI` is the distinct
  exception at gain .8000000119, pitch 1, and non-looping.
- The prior intro gain/pitch assumption was disproved directly by both wave
  records and their owning graphs. `Intro.nmo/Atari-Logo` has a direct Wave
  Player and no volume/pitch control. `base.cmo/Intro Start` likewise plays
  `Music_Theme_4_1` after 6000 ms at its saved gain 1/pitch 1; `Preload Sound`
  reads and restores those properties rather than overriding them. Neither cue
  is routed through the later `DB_Options` music mixer.
- The sound option persists its UI percentage as normalized float `value*.01`.
  Both `Menu.nmo/Volume` and `Sound.nmo/Fade In Music` feed that normalized
  value through shipped `TT_LinearVolume`: `x<=.01 ? 0 : .02*50^x`, capped at
  1. The port now applies this acoustic curve consistently to menu atmosphere,
  high-score music, and gameplay music instead of treating the stored setting
  as linear gain. Per-level audio teardown also removes its browser gesture
  listeners so restarts no longer accumulate event handlers.

## 2026-07-18 source-exact energy timer and alternating-force starts

- `Gameplay.nmo/Energy` row 0 is the sole authority for `StartPoints=1000`,
  `StartLifes=3`, `Timefactor=500` ms, and `LifeBonus=200`. The normal Timer
  graph uses Test mode 6 (`>=`) on elapsed time and mode 2 (`!=`) on points,
  subtracting one point per complete interval without going below zero.
- `TT_Timer` prototype `6ac67901:7d2a6059` was recovered statically from the
  shipped read-only `TT_Toolbox_RT.dll`. Its helper stores an active byte and
  accumulated float: Reset sets active/zero, Pause and Play only toggle the
  byte, and each execute adds `CKBehaviorContext.DeltaTime` while active. Thus
  pause, ball birth/death, and tutorial time-factor freezes preserve a partial
  500 ms interval rather than resetting or consuming it.
- `Deactivate Ball` sends `Counter inactive` before its fall sequence and `New
  Ball` sends `Counter active` only after the 3000 ms birth delay. A transformer
  sends neither message, so the countdown continues while the old ball changes.
  `Level_Finish` is subtler: Cam/Ball navigation stop immediately, then a link
  with activation delay 2 reaches `Counter inactive`, null-parent `Cam_Pos`,
  clipping 3/2500, and `fadeout Sky`. The runtime now keeps the countdown live
  for those two 66 Hz behavior steps, snapshots the score afterward, and starts
  the three-second sky fade at that handoff instead of at the proximity hit.
- Direct source graphs also correct an old scratch-note error. P_Modul_08 creates
  its +Z force after a one-frame edge, then runs +/idle/-/idle in four 500 ms
  stages. P_Modul_26's Sequencer starts at `Current=-1`, so its first Out 1
  creates the +Z force; it alternates signs every 1500 ms. Binary-backed tests
  now lock both initial signs, stages, force values, referentials, and delays.

## 2026-07-18 source loading screen recovery

- The installed source1 `base.cmo` and the statically extracted source2 copy are
  byte-identical (`sha256 4adcf457eab13168a59144c538b146a410208c5f98e3bb8b1c217a638c80177b`).
  Both author the loading display as the textureless 2D entity/material
  `Ladebalken`, not as `Cursor_busy`: X starts at zero, Y is `.9700004458`, and
  `TT Set_2DSprite` supplies height `.03` and a growing width.
- `Loading_Screen` divides one by `LoadingCount=9`, shows the entity, and adds
  that step before waiting for `Part_Loaded`. Its serialized local `Sizefactor`
  is already `4/9`, so the first visible updated state is `5/9`; four messages
  reach full width. Alpha is linearly interpolated at the same progress from
  RGBA `(1,.65882355,0,.15686275)` to `(1,.65882355,0,1)`. Preserve this saved
  state rather than resetting the browser bar to zero or inventing nine events.
- The browser maps the four remaining messages to completed scene construction,
  sky construction, gameplay effects, and modul construction. The full bar is
  retained for `Load_Object`'s serialized two-frame delayed completion link.

## 2026-07-18 source-authored highscore entry

- Source1 and the statically extracted source2 copies of `Menu.nmo` are
  byte-identical (`sha256 024f7fa2d9a7b7eedb10b2d3871b01cb2ac350cafd1562c8814772e102361cdf`).
  `Menu_HighscoreEntry` resets `TT InputString` from `base.cmo/DB_Options`
  row 0, column 9 (`LastPlayer`, shipped value `name`), limits it to `Max
  Size=9`, then writes the exact `StringWithoutCaret` back to that cell.
  Blank and whitespace-only strings are therefore retained; trimming or a
  browser-only `Player` fallback is not source-equivalent.
- `M_HighEntry_Score` occupies normalized rect
  `(.38,.43133345)..(.62,.50133342)` and displays `%d %s` from the final score
  plus the English language value `Points`. `M_HighEntry_NameEntry` remains at
  `(.38,.52733356)..(.62,.59733367)`, with a black material alpha of 110/255.
  The input display uses `Font_1` and the white `M_Caret` (`Caret Size=.1`), so
  the browser's native Georgia text/caret was replaced by the source bitmap
  renderer over an invisible keyboard-input proxy.
- `base.cmo/Check Highscore` compares total score against row 9 with Test mode
  5, statically established elsewhere as strict `A > B`. An equal score does
  not qualify. The source temporarily inserts `xxxxxxxxxxxxxxxxxxxx`, sorts,
  then replaces that marker with `LastPlayer`; the browser achieves the same
  visible top-ten result while preserving the exact submitted name.
- The leaderboard rank is not dynamic text. `M_Highscore_Number01..10` are ten
  separate 16x16 crops along the top of `M_Button_Inactive`, each with its own
  normalized rectangle over `M_Highscore_Place01..10`. The row graph draws only
  player and score with `GameFont_03` (`Scale=.35,.4`, Text Properties bit 1),
  shifts the player by normalized X `.035`, and right-aligns the score with
  margins `(2,2,10,2)`. The title and entry score/title use `GameFont_01`
  (`.45,.55`); the live entry string uses `GameFont_02` (`.7,.8`) and left
  alignment. Source-locked layout tests now cover every rank sprite, crop,
  font scale, offset, alignment, and margin.
- The complete shared font-role pass replaces arbitrary browser pixel heights:
  `GameFont_01` is `.45,.55` for primary capsule labels; `GameFont_02` is
  `.7,.8` for screen titles and the live highscore input; `GameFont_03` is
  `.35,.4` for compact rows/fields; inactive level entries use gray
  `GameFont_03a` at the same scale; `Menu_Score` uses `GameFont_04` at `.6,.6`.
  Each source node has Text Properties bit 1 and therefore rasterizes from the
  512-square `Font_1` atlas relative to the current centered 4:3 render target,
  with the white-to-black grade and shipped shadow rather than CSS type.
- `M_Opt_Keys_Key1..6` are separate right-side text targets, not text sharing a
  flex row with `M_Opt_Keys_Field1..6`. Their exact rectangles start at
  normalized X `.504999876`, while field labels remain left-aligned with two
  pixel margins. `M_Opt_Gra_ResField` and `M_Opt_Sound_VolField` are static
  `M_Button_Up` surfaces; they must not be rendered permanently in hover state.

## 2026-07-18 exact DepthTestCubes collision volumes

- The former port converted every `DepthTestCubes` object to a world-axis
  `THREE.Box3`, expanded it uniformly by ball radius, then added a guessed
  `lowest floor - 30` kill threshold. This enlarged rotated cube volumes into
  their world AABBs, killed at the wrong corners, treated the paper convex hull
  as a sphere, and introduced a death plane absent from the original.
- Every one of the 12 original level files contains a non-empty
  `DepthTestCubes` group of actual mesh entities; several are rotated. The
  browser now installs those authored world-space triangles as invisible
  non-response Rapier sensors. A collision-start edge against the current ball
  collider triggers the existing source death sequence, so wood/stone spheres
  and paper's convex hull use their real collision shapes without blocking the
  fall or producing impact audio.
- `Gameplay.nmo/get maxDepth` separately iterates the exact named group, extracts
  candidate bounds, and uses Test mode 3 (strict `<`) to retain its minimum.
  `Gameplay.nmo/DepthTest` is the fallen-object cleanup graph: it has its own
  iterator, Physicalize/Unphysicalize, Hide, Set Position, and serialized 200
  offset. It does not authorize a browser-only floor-derived player kill plane.
  Binary-backed tests cover both graphs and every level's member/mesh set.

## 2026-07-18 score counter presentation cadence

- `Menu_Score` advances its accumulated Time Points counter from a behavior-frame
  edge, not an unconditional 16.67 ms web timeout. The port now schedules each
  1/5/25 increment through the source presentation-frame path: display
  `requestAnimationFrame` when Graphics Synch is enabled, or the shipped 60 Hz
  limiter when disabled. The serialized millisecond waits and 610 ms reserve
  conversion cadence remain time-based and unchanged.

## 2026-07-18 source menu keyboard and option transactions

- The menu's keyboard selection is stored in the `RollOver?` columns, not left
  to browser focus. `Menu_Main_ShowHide`, `Menu_Start_ShowHide`, and
  `Menu_Options_ShowHide` select row zero; `Menu_Pause_ShowHide` and
  `Menu_End_ShowHide` select their last row. The shared graph listens to scan
  codes 200/208/28/1 (up/down/Return/Escape), wraps the active row, skips
  inactive entries, swaps `M_Button_Up`/`M_Button_Over`, and routes Return or
  the screen-specific Escape row through `Menu_Click`. These states and edges
  now drive the browser sprites and actions directly.
- `Menu_YesNo` is a separate horizontal graph: scan codes 203/205 select
  Yes/No, No is highlighted by Initialize, Return invokes the selection, and
  Escape always follows No. Highscore and Credits each bind both Return and
  Escape to Back; their global source keys no longer depend on an HTML element
  already having focus.
- The three option subgraphs hold editable values locally. Back runs their
  `Update Settings`/`Save Database` path; Escape exits without that update, and
  Controls explicitly restores its backup arrays. The browser now stages all
  fields accordingly. Sound alone previews `Menu_Atmo` volume as the source
  `Volume` graph does, then restores the saved volume on Escape.

## 2026-07-18 tutorial wait/action choreography correction

- `Kapitel Wait` does not show lessons 4–8 as soon as the previous action
  finishes. Its five XZ-only `TT Scaleable Proximity` gates wait at 16 units
  from ExtraLife, 14 from SteinTrafo, 4.5 from Rampe, 18 from ExtraPoint, and
  20 from Checkpoint. Only then does the interface appear and freeze physics.
  After Return, the paired action graph advances at 3/5/2.5/3/2.5 units. The
  former browser sequence displayed every later lesson one target too early.
- `Wait for Rampe` tests the live ball object against `Ball_Wood` with Test
  mode 2 (`!=`): a stone/paper ball sees the wood-transformer hint, while a
  player who already reached the ramp as wood skips straight to the Point
  Extra wait. After the checkpoint action, `Kapitel Wait` delays 4000 ms before
  showing the closing hints; their Return ends the tutorial. The old port put
  that delay after the closing Return instead.
- All tutorial proximity nodes serialize axis mask 5 (XZ) and use a strict
  boundary. `Tutorial Text/FadeIn` and both font FadeOut graphs share the 200 ms
  `Text FadeTime`; initial panel reveal is 200 ms and later proximity reveals
  are 300 ms. `Font_Tutorial` uses scale `.4,.5`, spacing `(-1.3,-1)`, margins
  2 on every side, white-to-black grading, and the 120-degree/four-pixel half-
  alpha shadow. The React overlay now preserves those source values and fades
  out instead of disappearing synchronously.

## 2026-07-18 tutorial arrow and physics choreography

- `Kapitel Aktion/FadeIn` and `FadeOut` interpolate arrow-material diffuse
  alpha over 500 ms, while `MoveKeys/FadeOut` uses 600 ms. Every completed
  action then passes through a separate 510 ms `Delayer` before the tutorial
  array advances. The arrow objects now retain their authored meshes,
  transforms, and source fades through that full handoff rather than being
  swapped synchronously.
- `Set Pfeilrunter` first detaches and restores the arrow, then writes position
  `(0,0,0)` relative to the selected `Tut_*` marker and parents it there. The
  saved `Tutorial.nmo` transform happens to sit `(-1,+1,0)` from its initial
  ExtraPoint parent, but that editor-state offset is overwritten by the graph;
  it must not be added again in the browser. The mesh itself starts 2.199 units
  above its pivot, so a zero marker-relative position still draws above the
  target.
- The four `MoveKeys` arrows use remapped forward/back/left/right controls and
  absolute Z scale `1 -> 1.8 -> 1`, with each leg lasting 150 ms. Completion
  waits for all four release animations or the separate 4-unit `Tut_KeyEnd`
  XZ gate, then runs the 600 ms group fade. Its proximity has exactness range
  0/4, frame delays 1/10, and serialized initial counter 2.
- Chapters 1–3 do not pause physics. `Init` freezes chapter 0, Return (or its
  25-second safety branch) restores time factor 2, and the camera-rotation,
  camera-height, and movement chapters continue live. Only target lessons
  4–8 and the final lesson freeze again. The backing panel remains visible
  while text fades between chapters 0–3, then hides independently after
  `MoveKeys`; later target lessons reveal it anew with the 300 ms curve.
- All five outer and five inner gates now run the recovered `TT Scaleable
  Proximity` fixed-frame cadence, not a per-PSI radius check. Outer exactness
  ranges are 23/40, 25/35, 5/10, 40/60, and 35/50; inner ranges are uniformly
  1/10. Every gate uses min/max frame delays 1/10, initial counter 2, XZ mask
  5, non-squared distance, and the plugin's strict `EnterRange` edge.

## 2026-07-18 fan local-box intersection correction

- `P_Modul_18/Physics Force` feeds `CurrentLevel` row 0, column 1
  (`ActiveBall`) and the hidden `P_Modul_18_Kollisionsquader` to `Box Box
  Intersection`; both serialized hierarchy inputs are false. The graph checks
  this on the adaptive proximity node's `InRange` output, creates the authored
  `.1` force on True, and destroys it on False.
- `Collisions.dll` registers the behavior at GUID
  `64154401-76cf37af`. Its recovered executor obtains collision manager GUID
  `38244712`, then calls vtable slot `.BoxBoxIntersection(entity1, hierarchy1,
  true, entity2, hierarchy2, true)`. The SDK contract defines those true flags
  as local-box mode: each mesh-local bound is transformed into an oriented
  bounding box before intersection.
- The previous browser code expanded the wind mesh to a world `Box3` and
  compared it with a radius cube. That admitted empty corners around rotated
  volumes and discarded the paper mesh's asymmetric bounds. The runtime now
  performs OBB-vs-OBB SAT from the exact current ball mesh and hidden volume
  mesh. Original placements that prove this distinction are
  `L2:P_Modul_18_04`, `_06`, `_07`, and `L12:P_Modul_18_01`.

## 2026-07-18 exact English menu cells

- `Language.nmo/language` has 52 rows. The browser now locks and uses the
  entire serialized English column rather than normalized web labels. This
  restores two leading spaces on Back and option-field captions, colons on
  `Level Bonus:`, `Time Points:`, `Extra Lives:`, and `Score:`, and the source
  casing `Next level`.
- `Strings YesNo Menu` reads row 19 (`OK`) for the left button and row 20 (an
  intentionally empty string in every language) for Cancel. The previous
  visible `Yes`/`No` labels were taken from the unrelated graphics-option rows
  34/35. The cancel capsule remains accessibility-labeled without adding
  pixels absent from the original.

## 2026-07-19 placement census, trafo manager, and DepthTest recovery

- **Every P_* group member is a placement.** Levelinit Replace PH runs
  Group to Array with no name filter; L04 and L12 author 19 `_NNa` suffixed
  placements (7+3 transformers, 1 loose stone ball, 3+3 extra points, and two
  L12 fans P_Modul_18_10a/11a) that the port's former `_\d+$` regexes
  silently dropped. All placement enumerations (moduls, extra points, extra
  lives) now instantiate every group member; L04 runs 20 live transformers.
- **Trafo Manager selection is nearest-only.** Get Nearest In Group over the
  level-wide attribute group, then Test mode 3 (distance < 4.3000002) and
  `Ist Trafo != Ball?` (mode 2). A same-kind nearest transformer blocks a
  farther mismatched one inside 4.3 (authored overlaps: L05 Wood_04/Stone_05
  at 7.07, L12 Wood_07a/Stone_14 at 6.07). ModulManager now scans all
  transformers each tick (sector-independent), picks the strict nearest, and
  the graph's sequential busy state maps to the pendingTrafo gate.
- **Ball fall detection is BallManager's AABB scan.** Group Iterator over
  DepthTestCubes + Box Box Intersection (both hierarchy flags false): world
  AABB of the cube entity vs world AABB of the ball entity, ONE cube per
  behavioral frame, round-robin. The port replaced its invisible trimesh
  sensors with this exact scan (ball geometry bounds transformed by the body
  pose; behavioral frame maps to the 66 Hz tick).
- **DepthTest fallen-prop cleanup implemented.** get maxDepth =
  min(0, min DepthTestCubes world-AABB min Y); DepthTest subtracts 200 once,
  then round-robins ONE member of the runtime DepthTest group per behavioral
  frame; below threshold: Unphysicalize, Hide, Set Position (0,0,0). Group
  membership = union of Levelinit DepthTestGroups rows P_Ball_Paper,
  P_Ball_Wood, P_Ball_Stone, P_Box (source-locked). The P_Modul_03
  falling-parts Add To Group has NO target parameter in the shipped binary
  (it adds the MF frame to the group - a shipped no-op): Modul_03 walls are
  NOT culled; do not "fix" this. Culled props restore on sector reset
  (Activate Sector type 2/3 = Set World Matrix + Show + Physicalize).
- Unphysicalize maps to a fixed body with all colliders disabled (never a
  disabled body: Rapier panics on joints attached to disabled bodies).

## 2026-07-19 Physic Time Factor 2 - the port ran at half speed

- Static recovery of physics_RT.dll (corroborated line-for-line by the
  doyaGu/physics_RT community decompilation): Set Physics Globals stores
  factor*0.001; the manager's PostProcess advances the IVP environment by
  smoothedFrameMs * that value, and IVP fires PSIs every 1/66 of a PHYSICS
  second. Shipped Ballance therefore simulates TWO physics-seconds per wall
  second (132 PSI/s). Factor 0 (pause/tutorial freeze) halts PSIs with no
  catch-up debt. The DLL default is 1; Ballance's graphs set 2 on every
  resume path.
- The port now runs PHYSICS_TIME_FACTOR (=2) world steps per 66 Hz behavior
  tick in all three stepping sites (playing, dead fall, finished). Behavior
  clocks (module 500 ms stages, trafo/birth/energy timers, proximity frame
  delays, audio contact delays) remain 1x wall time, exactly like the
  original's render-frame behavior graphs. Rapier forces set behavior-side
  persist across both PSIs = IVP controllers firing each PSI. Collision
  events are drained per PSI against that PSI's pre-solve snapshot.
- Deterministic validation: a wood ball (damping .9) free-falling one wall
  second reaches vy = -18.594, matching the closed-form 132-PSI IVP series
  -0.30303*(1-0.98636^132)/0.013636 = -18.60 (a 66-PSI run would read -13.2).
- Death-path corrections from the Deactivate Ball graph: the white pulse
  exists ONLY on the lives>0 branch. Game over = no fade, no unphysicalize,
  no hide - the ball keeps falling; menu after the 2000 ms delay; music KEEPS
  playing (no End Music is serialized on the Dead path). New Ball
  physicalizes the CURRENT ActiveBall: dying after a transformation respawns
  the transformed kind (the port's sector-entry-kind revert was invented and
  is removed). The replacement ball is hidden until the 3000 ms birth ends
  (only the lightning sphere is visible), from level start too.
- Pause parity: Esc sends BallNav deactivate (roll loops stop, detectors
  torn down) then Pause Level -> End Music = one-second fade of the music
  GAIN only; schedulers keep drawing waves silently. Unpause fades back and
  re-arms ball sounds only if they were active. Implemented via a store
  phase subscription; gameover endMusic() was removed.

## 2026-07-19 Shadow receivers, menu cues, and graphics label

- CORRECTION to the Wave-2 note: the level `Shadow` groups are NOT redundant
  editor groupings. Levelinit's `set Floor` runs Set Attribute over exactly
  that group with the Floor-manager attribute, and TT_Gravity_RT's
  TT Simple Shadow projects only onto Floor-attribute objects. The group is
  a non-empty strict subset of the floor union in all 12 levels (rails,
  stoppers, invisible helpers, and moving moduls are excluded). BallShadow
  now restricts its ray sampling to those receiver colliders (source-locked
  in levelIntegrity).
- Graphics resolution field: the source Create String joins width/height
  with the serialized " * " delimiter (spaces). The shipped mode list is a
  runtime enumeration filtered to bpp 16, width 640..1600, ratio within
  [1.333,1.3334]; on period hardware it equals the six Dummy_ScreenModes
  rows the port ships. Resolution persists in the registry, not DB_Options.
- Menu_End/Restart Level owns a serialized YesNo ? composite (Menu_Dead has
  none). base.cmo's Exit Level / reset Level / Load Level branches send
  Menu_Load first; the pause-exit, pause-restart, end-restart, and
  next-level transitions now play that cue.
- Shipped no-ops discovered: Sound.nmo's Unpause->Fade Out route targets a
  nonexistent object named "Music" (iterates nothing), and "Sound_Refresh"
  (activated by Unpause Level) exists in no shipped file. Do not implement
  either.

## 2026-07-19 source sector lifecycle (Activate/Deactivate Sector)

- Prefab copies load HIDDEN at the authored pose with ICs captured in that
  state (every P_Modul/PC/PS/PE prefab part serializes visible=false).
  Activate Sector stamps the placement matrix, Shows, and physicalizes
  (types 2/3) or runs the MF script fresh (type 1); Deactivate destroys
  joints/forces, unphysicalizes, and Restore IC leaves the authored
  arrangement hidden. Death tears down and rebuilds the ACTIVE sector
  (deactivate then activate, 4 behavior frames apart, behind the white
  pulse); checkpoints deactivate the old sector without reactivating it.
- Port implementation: Modul.activate() = show + fresh home transforms +
  dynamic bodies (frozen asleep); deactivate() = hide + fixed bodies with
  colliders disabled at home pose (joints stay attached but inert - Rapier
  panics only on DISABLED bodies). ModulManager parks every instance
  deactivated at creation; setSector(1) performs the boot activation.
  P_Modul_18 fans are the one prefab with no Hide/Restore IC on
  deactivation - they stay visible (flag on FanModul).
- The Trafo Manager scan ignores never-stamped moduls: unactivated copies
  are parked away from their placements in the source, so a next-sector
  transformer is unreachable until its checkpoint. Bridge (Modul_29)
  activation repairs a broken HingeFrame07 exactly like a sector reset.
- PE_Levelende is a PH row of the LAST sector: the balloon prefab shows
  only when the final sector activates, and ANY final-sector death re-runs
  its teardown/rebuild (assembly re-frozen at authored poses, one-shot
  70-unit wake gate re-armed). Implemented as BalloonPhysics.resetAssembly.
- Deferred follow-ups: (1) New Ball stamps Cam_MF with the reset-point
  matrix + Restore IC - reconcile with the locked camera controller before
  changing the rig. (2) The fan housing colliders (Gitter/Boden fixed parts,
  friction .7/.4) have no recovered Physicalize backing - audit what makes
  the original fan grid solid.

## 2026-07-19 VX_EFFECT, mesh channels, and the rail reflection recovery

- The material effect save is chunk identifier 0x10000 (the port's
  MAT_DATA5): an object ref to the effect parameter followed by the
  VX_EFFECT enum. MAT_DATA3 (0x4000) never occurs in shipped materials -
  the old parser read effect 0 for everything. Exactly 18 materials carry
  effects: trafo shells + AnimTrafo rings + UFO env (TexGen Reflect 2),
  menu rails + dome env (TexGen Chrome 3), and I_DomeEnvironment
  (effect 2 = TexGen with referential, NULL referential = camera, Reflect).
- CK2_3D maps Reflect to D3D CAMERASPACEREFLECTIONVECTOR and Chrome to
  CAMERASPACENORMAL, both via texture matrix diag(0.4,-0.4) + (0.5,0.5).
  Implemented as an onBeforeCompile texgen (u=0.4x+0.5, v=-0.4y+0.5 over
  view-space normal/reflection). Textures load flipY=false, so the D3D
  constants apply verbatim; view-space x/y agree across the mirrored-Z
  conversion, and for Reflect the eye vector's x/y products cancel the
  mirror too.
- CKMesh MATERIAL CHANNELS (mesh chunk 0x4000) are extra blended passes:
  [count] then per channel [matRef][flags][srcBlend][dstBlend][uvCount]
  [uvs]. Dome + UFO Top/Body each own one Zero/SrcColor (multiplicative)
  channel over PE_Ufo_env / P_DomeEnvironment. Rendered as a child mesh
  with CustomBlending Zero/SrcColor, depthWrite off; prefab instantiation
  carries the overlay children.
- LEVEL rails have NO effect. Levelinit's `set Env. Mapping` runs
  TT_ReflectionMapping once per Phys_FloorRails member: a CPU bake of the
  mesh base UVs from the invisible FixCube at the world origin
  (V=normalize(camLocal-pos), R=2(N.V)N-V, u=(R.x+1)/2, v=(R.z+1)/2 in
  entity-local ORIGINAL space; the mirrored port uses v=(1-R.z)/2). Level
  rail reflections are static origin bakes that do NOT track the camera;
  shared meshes re-bake per member (last member wins, same as source).
  Non-grouped rail meshes keep their file-authored UVs. The former matcap
  heuristic (texture name contains "environment") was removed.
- The rail materials render as ordinary lit Phong with their authored
  colors (Rail diffuse .392/.463/.522, specular .824 power 10, emissive
  .486/.525/.588, ModulateAlpha) - "rails render flat white" is closed.

## 2026-07-19 post-batch 12-level sweep

- After the factor-2 physics, sector lifecycle, AABB death scan, placement
  recovery, and VX_EFFECT batches: the full deterministic sweep passed on
  all 12 levels (every ordered checkpoint advanced its sector, every
  balloon teleport reached `finished`), L1 via the tutorial Q exit. Zero
  console errors. Visual checks: L1 opening scene, 3D menu tower with
  Chrome rails and Reflect trafo shells, L2 sector-2 moduls appearing on
  the checkpoint and sector-1 loose props disappearing; balloon hidden
  until the final sector; game-over falls without a fade; stone kind
  retained through respawn; wood free-fall vy after one wall second is
  -18.594 = the exact 132-PSI IVP series.
- Remaining audit follow-ups: the Cam_MF respawn stamp reconciliation, the
  fan-housing collider provenance, and a side-by-side feel/visual pass
  against original gameplay footage now that the physics rate matches.

## 2026-07-19 playtest findings round (user-reported, evidence-resolved)

- **Thunder is last-level-only.** Gameplay_Ingame/activate Scripts runs
  `letzer Level?`: Get Cell CurrentLevel[0][0] -> Test mode 1 (==) against
  the AllLevel row count, guarding the one conditional Activate Script.
  Gameplay_Blitz itself contains only the Pause/Unpause Binary Memory gate
  (no level test) - the port previously ran the blitz on every level; it is
  now constructed only for level 12 (blitz.test locks the gate).
- **D3D lights per VERTEX.** The fixed-function pipeline computes specular
  at vertices and interpolates the color (added after texturing via
  SPECULARENABLE). Floor_Top_* materials serialize specular 0x989898 power
  100, which per-pixel Phong turned into a glossy road; per-vertex on flat
  coarse plates is effectively matte. materialToThree now zeroes three's
  per-pixel specular and renders the serialized specular through a
  vertex-computed (Gouraud) patch using the scene's one specular light
  (Light_Ingame + per-level tint, published by addLightRig). The texgen and
  Gouraud patches compose in one onBeforeCompile.
- **Tutorial opening holds the birth.** New Ball's `activate Tutorial?`
  (level==1 && GameSettings Tutorial?) activates Gameplay_Tutorial and
  blocks at Wait Message "Tutorial Ready" BEFORE the Ball_Lightning send;
  `Tut continue/exit` sends Tutorial Ready on the opening chapter's Return
  (and its Q exit). Nothing spawns until then: no ball, no lightning, no
  counter (Counter active fires only after the birth). The port now holds
  the birth on the tutorial level until TutorialSystem.birthReleased.
- **WASD is the port's one approved deviation.** DEFAULT_SETTINGS ships
  W/S/A/D for movement (the shipped DB_Options defaults remain the four
  arrows and stay locked as SOURCE_DEFAULT_MOVEMENT_KEYS); saves whose
  movement keys exactly match the old arrow defaults migrate once to WASD,
  custom remaps are preserved. Everything stays remappable through the
  72-key whitelist.
- **Shatter debris never blocks the player ball.** The piece Physicalize
  blocks (Init Ballpieces + Wood/Paper/Stone Explosion) serialize IVP
  Collision Group "Ball" while the player ball physicalizes with no group;
  in the original the debris does not collide with the player. Rapier
  interaction groups now model the exclusion (PLAYER_BALL_COLLISION_GROUPS
  bit 1 / BALL_PIECE_COLLISION_GROUPS filtering bit 1 out); pieces still
  collide with world geometry and loose props. The full physics_RT
  collision-group rule (incl. Phys_FloorStopper's "Ball" group) is under
  separate static analysis - do not extend groups further without it.
- Level start ALSO runs New Ball (birth lightning at boot on every level) -
  already implemented; noted here because the tutorial hold sits in front
  of it only on level 1.

## 2026-07-19 top-level script coverage census

- Enumerated every top-level (unreferenced) behavior script in base.cmo,
  Gameplay.nmo, Levelinit.nmo, and Sound.nmo and checked each against the
  implemented systems. Three had never been examined:
- `base.cmo/Default Level` (flags 0x4003, the boot orchestrator): its
  children are the already-recovered Screen Modes / intro / loading /
  database / Synch to Screen paths plus environment plumbing (Set Language
  via TT_ReadRegistry, GetSystemVersion, Show Evaluation Copy ? gated off
  in retail, Player Active?). Nothing gameplay-visible is unimplemented;
  the browser fixes the English language column the UK release defaults to.
- `base.cmo/Debug_Info` serializes behaviorFlags 0x4002 - the active bit
  (0x1) present on Default Level is absent, and its activation path runs
  through `set DebugMode`, whose DB debug flag ships off. The FPS/texture
  displays and the Exit Player key are retail-inert; the port correctly
  omits them.
- `Gameplay.nmo/Gameplay_Refresh` (activated with Reset by Unpause Level):
  re-reads DB_Options and its `Tutorial freeze/unfreeze` branch drives one
  of the Set Physics Globals writers through a Parameter Selector - factor
  0 if the tutorial freeze is live, else 2. The port's settings
  subscription plus the tutorial-frozen PSI skip already reproduce both
  effects; no change needed.
- The remaining graph files' top-level scripts (all Menu_* screens,
  MenuLevel_Init + flame + ball-anim scripts, Balls.nmo's init/lightning/
  explosion/reset-pieces/wind/coll-sound/shadow/particle scripts, both
  AnimTrafo scripts; Camera.nmo and Tutorial.nmo have none) all map to
  already-recovered systems. `Balls_Init` is Ops + Init Ballpieces.
- A full string-parameter sweep of base.cmo/Gameplay/Levelinit/Sound/
  Tutorial finds NO reference to the level groups named `invisible` or
  `test`: the Wave-2 "redundant editor groupings" claim is now
  evidence-backed for those two (Shadow was the exception - it is the
  TT Simple Shadow receiver set).

## 2026-07-19 fan housing collision provenance resolved

- P_Modul_18.nmo contains exactly four entities (MF frame, Particle frame,
  Rotor, hidden Kollisionsquader) and NO Physicalize block anywhere. The
  solid surface at 88 of 92 fan placements is ordinary static level
  geometry: the Modul18_Top/Gitter grid faces are baked into A*_Floor_*/
  A*_Wood_* meshes that belong to Phys_Floors (fixed concave, 0.7/0.3,
  with their own stone or wood Sound_HitID/RollID membership). L12 fans
  01/02 and L4 fans 05/06 have NO grid - open wind shafts by design.
  A04_VentiDeckel (L4) is a decorative cap in no group at all.
- The port's former FanModul Gitter/Boden makeFixedPart branch was dead
  code (loadPrefab yields only the three real parts) whose invented
  0.7/0.4 values coincide with Levelinit's FixCube physicalize - which has
  Enable Collision FALSE. The branch was deleted; behavior is unchanged
  because the level-mesh static colliders already provide the authentic
  collision and sounds.
- The level P_Modul_18_XX placement entities are marker meshes deleted by
  Replace PH at runtime; they never carry physics or sound groups.

## 2026-07-19 Cam_MF respawn stamp - camera yaw resets at every rebirth

- CORRECTION to the source-exact camera section: "Camera orientation
  persists across ball falls ... Reset-point orientation is unrelated" is
  WRONG. Cam_MF is the master PARENT of the whole rig (Cam_Target with
  Cam_Orient/Cam_Pos/Cam_OrientRef beneath, and InGameCam). Gameplay.nmo's
  New Ball runs, in order: Set World Matrix ActiveBall <- CurrentResetpoint
  (hierarchy), TT Restore IC Cam_MF (hierarchy), Set World Matrix Cam_MF <-
  the same matrix (hierarchy). New Ball runs at LEVEL START and at every
  death (Ball OFF + 1 behavior frame, hidden behind the full-white pulse).
- The camera ICs are captured by the ENGINE at load: every Cam_* object
  serializes scene-activity flags 0xd0, and CKScene::AddObject saves the
  object state as its InitialValue when bit 0x80 is set. Restore IC
  therefore collapses the rig to its authored Camera.nmo arrangement -
  wiping any Cam Navigation quarter turns - and the stamp teleports it
  rigidly onto the reset frame: camera = resetPos + authoredLocal rotated
  by the frame. Every level has mid-course reset yaws (90/180/-90/0 mix),
  and PR_Resetpoint_01 is yaw 180 on ALL twelve levels - the port's old
  yaw-0 start camera sat on the OPPOSITE side of the ball.
- Port fixes: resetPointFrom yaw is the mirrored heading atan2(fwd.x,
  -fwd.z) (the old -fwd.x form was exact only for 0/180 and landed 44
  units wrong for +-90 points); respawn() and level start now run
  rig.resetTo(resetPosition, resetYaw) plus the ball rotation stamp.
  camera.test locks the rig slot against the raw serialized reset matrices
  of L01/L02/L12 (17 points, within 0.01 of the exact stamp composition).
  Live validation: start camera at (-22,35,0) relative yaw pi; a quarter
  turn to pi/2 snaps back to pi after death; the L2 sector-4 -90 reset
  point respawns at exactly +pi/2. PR_Resetpoint (not PS_FourFlames) is
  the camera authority.

## 2026-07-19 baseline repair: seven committed-red tests resolved by bytes

- The prior "progress save" wave left 7 failing tests. Every dispute was
  settled against the original files; the runtime needed no behavior change,
  and three menuLayout constants were corrected to serialized values.
- **CK_ARRAYTYPE_PARAMETER cells are object references.** `Energy.Timefactor`
  (column type 5, param GUID `54b4422b:730f0f4f` = TIME) stores index 10725;
  that object is a nameless CKParameterOut whose float value is exactly 500
  (ms). Tests reading parameter-typed cells must resolve the reference, not
  compare the raw index. TIME parameters serialize float milliseconds.
- `base.cmo/Check Highscore` owns TWO `Test` blocks: the score qualification
  is the one whose `iB` input resolves to a `Get Cell` output (mode 5, strict
  `A > B`, confirming the existing runtime); the other Test (mode 6) compares
  a different Get Cell value against local constant 10. Select graph blocks
  structurally, never by first-name match.
- `Test`-mode enums must be read as int32; reading them through a float helper
  yields denormals (raw 6 = 8.4e-45). loadingSource now reads int.
- `M_Options_But_Back` (.4030999541282654-.5906002521514893) and
  `M_Credits_But_Back` (.4031502306461334-.5906505584716797) are separate
  serialized entities 5e-5 apart; the shared constant was split.
- `GameFont_03`/`GameFont_03a` scale Y is float32 0.4 = 0.4000000059604645
  (0x3ECCCCCD); the hand-typed 0x3ECCCCCC was one ULP off.
- Menu_Highscore/Init: the authored name shift lives in the `Position` input
  `[.035,0]`; `Name_X_Off` is a graph LOCAL saved with live bytes `[0,0]`.
  Locals persist whatever was live at save time - never lock tests to them.
- DepthTestCubes rotation truth: `L01/L02 Quader03` serialize a 90-degree yaw
  (basis [0,0,1 / 0,1,0 / -1,0,0]); L03 cubes carry X scale 1.61; L12 cubes
  carry X/Z scale 1.2214289903640747. Rotation detection must inspect all six
  off-diagonal basis elements; m[1]/m[4] alone are blind to yaw.
- TT SkyAround vertex positions live in Float32Array; test expectations must
  round through Math.fround and normalize -0 (the source D3D buffer is
  float32 as well).
- Lesson: the last commit wave landed without a green gate. Run the full
  gate (lint, typecheck, 209 tests, build) BEFORE each commit.

## 2026-07-19 Levelinit physicalization tables source-locked

- Levelinit.nmo serializes three authoritative dataArrays: Physicalize_Floors
  (Phys_FloorRails/Phys_Floors 0.7/0.3 mass 1 col-group Floor;
  Phys_FloorStopper 0.7/0.3 mass 1 col-group Ball; all Enable Col),
  Physicalize_Convex (P_Box dynamic 1kg 0.7/0.3 damp .1/.1; P_Ball_Paper
  0.2kg 0.5/0.4 damp 1.5/.1 as mesh hull; P_Dome FIXED 0.2/0.8), and
  Physicalize_Balls (P_Ball_Wood 2kg 0.6/0.2 damp .6/.1 radius 2;
  P_Ball_Stone 10kg 0.7/0.1 damp .2/.1 radius 2). Boolean cells are
  CK_ARRAYTYPE_PARAMETER object refs like Energy.Timefactor.
- Every existing runtime value already matched; new physTable tests lock
  FLOOR_GROUPS and the five loose-prop MODUL_PHYS entries to these rows.
- FLOOR_GROUPS carried an invented Phys_FloorWoods row; the source table has
  exactly three rows and no level group uses that name, so it was removed.
- The same Levelinit graph area also authors placeholder FixCubes
  (fixed, friction .7, elasticity .4, collision DISABLED) and the
  Activate/Deactivate Sector Physicalize paths for placeholder types - the
  sector activation audit should start from init Placeholders.
