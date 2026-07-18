# Implementation notes (agent memory)

Append-only scratchpad of things learned during the port. Read this first when resuming work.

## Architecture decisions

- **No offline asset pipeline.** We parse the original Virtools NMO/CMO files directly in TS
  (`src/formats/ck2/`), at runtime in the browser and in Node for tests/tools. Assets stay in
  `Ballance_bin/` (gitignored), served to the dev server via a Vite middleware. Maximum
  fidelity, no Blender dependency, no converted-asset drift.
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
  material mapping (01=wood, 02=metal, 03=stone by convention — verify by member names).
- Level_01: 356 objects, 128 meshes, 29 groups, 30 textures, 41 materials. Sectors contain
  the floor entities per stage; checkpoint/reset markers are separate groups ordered by name
  suffix (PC_Checkpoint_01... / PR_Resetpoint_01...).
- All Level_01 textures are external file refs (e.g. `Floor_Top_Borderless.bmp`,
  `Laterne_Verlauf.tga`) matching files in `Ballance/Textures/`.

## Gotchas

- `Sound_RollID_XX`/`Sound_HitID_XX` groups exist per level — use them for the audio matrix
  instead of guessing surface material from names.
- Texture name case differs from file case (e.g. `floor_top_Checkpoint` vs
  `Floor_Top_Checkpoint.bmp`) → resolve asset paths case-insensitively.
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
- Flames (PS/PC), Extra Point orbit + fly-to-HUD animation, Extra Life bob/spin, trafo
  ring animation (2.3s, colors wood #ff9300 stone #00ff1d paper #0091ff), death Pieces_*
  shatter effects, fan particles: cosmetic systems still to build.
- Rails render flat white: need spherical env-map (Rail_Environment.bmp) material path.
- Ball trafo swap is instant; original swaps after the 2.3s trafo animation.
- Modul_29 stays broken on sector reset (original re-links only on level restart) — OK,
  but verify against original edge case.
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
- Fan modul loops Misc_Ventilator.wav via AudioManager.createLoop (positional, bound to the
  instance root; active only with the sector). ModulContext.attachLoop is the hook.
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
- **Menu (rebuild MenuLevelCameraControl):** day sky = C, night lightzone = M;
  warm linear fog #d3c894 100-800; camera ORBITS the dome (I_Dome) at -10 deg/s
  at the authored radius/height (Cam_MenuLevel at (0,40,-95) LH → r=95 h=40);
  Menu_atmo.wav is a ONE-SHOT replayed after random 1-10s gaps (not a loop).
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
- **Audio model (exact original semantics)**: roll loops are created ONCE and play
  forever at volume 0 — only volume/pitch are modulated; per-surface contact
  needs 0.5s sustained to become audible (paper 0.8s) and 0.5s absence to go
  silent (this kills the rail-flicker glitch). Roll volume = Hermite curve keys
  (0,0,3.19)(0.0636,0.1375,0.82)(0.4165,0.41,1.16)(0.9,0.8,0.41)(2,1,0) sampled
  at speed/ref (wood 9, paper 12, stone 15); pitch = min(1, 0.6+0.03*speed).
  Hits are collision-STARTED events using the pre-step velocity projected on the
  contact normal: below 5 nothing plays, volume ramps to max at 30 (dome 15),
  each surface sleeps 0.6s. Ball sounds are 2D (non-positional). Dome has its own
  hit layer (Hit_Wood_Dome / Hit_Stone_Kuppel, no roll). Phys_FloorStopper floors
  additionally bang Hit_WoodenFlap.wav (volume=impact/10).
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
- **Menu (rebuild MenuLevelCameraControl):** day sky = C, night lightzone = M;
  warm linear fog #d3c894 100-800; camera ORBITS the dome (I_Dome) at -10 deg/s
  at the authored radius/height (Cam_MenuLevel at (0,40,-95) LH -> r=95 h=40);
  Menu_atmo.wav is a ONE-SHOT replayed after random 1-10s gaps (not a loop).
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
- **Audio model (exact original semantics)**: roll loops are created ONCE and play
  forever at volume 0 — only volume/pitch are modulated; per-surface contact
  needs 0.5s sustained to become audible (paper 0.8s) and 0.5s absence to go
  silent (this kills the rail-flicker glitch). Roll volume = Hermite curve keys
  (0,0,3.19)(0.0636,0.1375,0.82)(0.4165,0.41,1.16)(0.9,0.8,0.41)(2,1,0) sampled
  at speed/ref (wood 9, paper 12, stone 15); pitch = min(1, 0.6+0.03*speed).
  Hits are collision-STARTED events using the pre-step velocity projected on the
  contact normal: below 5 nothing plays, volume ramps to max at 30 (dome 15),
  each surface sleeps 0.6s. Ball sounds are 2D (non-positional). Dome has its own
  hit layer (Hit_Wood_Dome / Hit_Stone_Kuppel, no roll). Phys_FloorStopper floors
  additionally bang Hit_WoodenFlap.wav (volume=impact/10).
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
fade + falling ball, per the original). Still-open approximations: balloon
fly-off is a kinematic rise (not the original multi-body flight), L12 UFO is
sound-only even though the authored UFO lives in `PE_Balloon.nmo`, tutorial arrows
(Tutorial.nmo) and the intro logo sequence (Intro.nmo) are not implemented,
options subscreens are simplified (volume only).

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
  starts -F first (startState 1 in the altForce table).
- **Level coverage audit**: every functional group in all 12 levels is
  handled; 'Shadow'/'invisible'/'test' groups are redundant editor
  groupings; Sound_HitID_* == Sound_RollID_* memberships in all levels;
  Phys_FloorWoods appears in NO level file (wood floors are tagged by sound
  groups). Only true content gap was the L1 tutorial overlay.
- **Menu truths (from Language.nmo strings)**: score rows are 'Level Bonus:'
  / 'Time Points:' / 'Extra Lives:' / 'Score:' (no "Congratulations"
  anywhere); pause = Restart Level / Exit Level; game over = Restart Level /
  Home; options = Graphics / Controls / Sound subscreens (single Music
  Volume slider; Clouds? yes/no toggle); highscore = per-level top-10 with
  names+dates seeded by "Mr. Default" 2004/8/8 (4000..400, L12 7000..3600),
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
- `M_FontData_01` from Menu.nmo now supplies glyph source positions and advance
  metrics directly. The 23 original `Menu_Credits_Strings` records render and
  scroll correctly in the browser (including the original dedication and
  publisher/team blocks); no synthetic credits remain.

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
  6000 ms at source gain 0.5, and invokes `Intro_End` after its parallel main
  loading/minimum-delay controller completes. `Intro.nmo` itself waits 1000 ms,
  plays the 125-frame/25-fps Atari AVI for 5000 ms with `ATARI.wav` at gain
  0.5 and pitch 0.8, covers to black over 300 ms, then reveals the logo/cloud
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
  three source textures, a 66 Hz texture sequence, 2*pi rad/s rotation, a
  1500 ms decoded CK2dCurve scale-up, a 3000 ms sphere lifetime, and a point
  light at local Y=9. The original 28-key 2500 ms blue flicker and two-key
  1500 ms white fade curves are decoded at runtime rather than approximated.
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
  23,000 ms. Including the preceding sky fade, `End Level` is sent at 13 s or
  26 s respectively.
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
  `TT Scaleable Proximity` starts with `Last Check=true`, samples after random
  inclusive 5–20-frame delays, enters below 200 units, and exits above 250.
  Ball Off disables the sampler and re-enables it after exactly 3000 ms.
- `Play EndMusic` compares CurrentLevel to max Level with comparison mode 1
  (Equal). Levels 1–11 play only `Music_Final`; level 12 plays only the 7.686 s
  `Music_LastFinal`. The former invented level-12 follow-up `Music_Final` was
  removed. The ending wave and atmosphere remain in the music group; the
  checkpoint loop stops one behavior tick after `Level_Finish`.
- `audio.test.ts` parses `Sound.nmo`, `Levelinit.nmo`, and `Musicfiles.nmo` to
  lock every scheduler delay, selector coefficient/repeat flag, fade, theme,
  last-stage proximity value, frame delay, loop flag, group member, and ending
  selector. Deterministic browser traversal confirmed theme-only shutdown,
  the saved initial proximity window, exit/re-entry hysteresis, and the finish
  overlap. Network capture fetched only `Music_Final.wav` for level 11 and only
  `Music_LastFinal.wav` for level 12. There were zero browser errors; the tab
  and Vite server were closed. The full gate passes with 87 tests plus lint,
  typecheck, and production build (the usual chunk-size warning only).
## 2026-07-18 resolved HUD parity finding: life count

- The user-provided comparison exposed three guessed flex-layout errors: the
  port rendered only the reserve count, left wide gaps, and placed the outer
  cradle after the balls. Static source recovery resolves all three. In
  `Camera.nmo`, `Interface_Life_Kugel`, `Interface_Life_Startbogen`, and
  `Interface_Life_End` serialize their exact screen and atlas rectangles.
  `Gameplay.nmo/Energy` stores `StartLifes=3`, but `Init Startlifes` preserves
  the original ball entity and runs a Counter of three copies. The initial HUD
  therefore intentionally shows four balls.
- Ball copies begin at X `0.9495999813` and proceed left by
  `0.03869999945`; the hook X is `0.9287999868 - ActLifes*0.03869999945`
  (`Calculator` expression `a-(b*c)`). The React HUD now renders those normalized
  rectangles directly, including the permanent current ball and moving hook,
  rather than approximating them with flexbox. `Camera.nmo` is byte-identical in
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
