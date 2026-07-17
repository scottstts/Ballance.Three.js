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
