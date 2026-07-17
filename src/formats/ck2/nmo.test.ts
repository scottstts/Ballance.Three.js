import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from './nmo.ts';
import { CKClassId } from './types.ts';

const GAME_DIR = fileURLToPath(new URL('../../../Ballance_bin/Ballance', import.meta.url));
const hasGame = existsSync(GAME_DIR);

describe.skipIf(!hasGame)('parseNmo on original game files', () => {
  it('parses Level_01.NMO structure', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level/Level_01.NMO')));
    expect(file.info.fileVersion).toBe(8);
    expect(file.objects.length).toBe(file.info.objectCount);
    expect(file.objects.length).toBeGreaterThan(100);

    // semantic groups must exist
    const groupNames = file.groups.map((g) => g.name);
    expect(groupNames).toContain('Sector_01');
    expect(groupNames).toContain('Phys_Floors');
    expect(groupNames).toContain('PS_Levelstart');
    expect(groupNames).toContain('PE_Levelende');

    // groups must reference valid member objects
    const sector1 = file.groups.find((g) => g.name === 'Sector_01')!;
    expect(sector1.memberIndices.length).toBeGreaterThan(0);
    for (const idx of sector1.memberIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(file.objects.length);
    }

    // entities must have meshes with geometry
    const floors = file.groups.find((g) => g.name === 'Phys_Floors')!;
    let checkedMeshes = 0;
    for (const idx of floors.memberIndices) {
      const obj = file.objects[idx];
      if (obj.kind !== 'entity' || obj.meshIndex < 0) continue;
      const mesh = file.objects[obj.meshIndex];
      expect(mesh.kind).toBe('mesh');
      if (mesh.kind === 'mesh') {
        expect(mesh.vertexCount).toBeGreaterThan(0);
        expect(mesh.faceCount).toBeGreaterThan(0);
        expect(mesh.positions.length).toBe(mesh.vertexCount * 3);
        expect(mesh.faceIndices.length).toBe(mesh.faceCount * 3);
        // face indices in range
        for (let i = 0; i < mesh.faceIndices.length; i++) {
          expect(mesh.faceIndices[i]).toBeLessThan(mesh.vertexCount);
        }
        checkedMeshes++;
      }
    }
    expect(checkedMeshes).toBeGreaterThan(0);

    // world matrices must be finite and affine
    for (const e of file.entities) {
      for (let i = 0; i < 16; i++) expect(Number.isFinite(e.worldMatrix[i])).toBe(true);
      expect(e.worldMatrix[15]).toBe(1);
    }
  });

  it('parses all 12 levels without throwing', () => {
    for (let n = 1; n <= 12; n++) {
      const name = `Level_${String(n).padStart(2, '0')}.NMO`;
      const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level', name)));
      expect(file.objects.length).toBeGreaterThan(50);
      expect(file.groups.length).toBeGreaterThan(5);
    }
  });

  it('parses compressed files (Balls.nmo, whole-compressed)', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Balls.nmo')));
    expect(file.objects.length).toBeGreaterThan(0);
    const names = file.objects.map((o) => o.name);
    expect(names.some((n) => n.includes('Ball_Paper'))).toBe(true);
    expect(names.some((n) => n.includes('Ball_Wood'))).toBe(true);
    expect(names.some((n) => n.includes('Ball_Stone'))).toBe(true);
  });

  it('reads texture filename references', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level/Level_01.NMO')));
    const textures = file.objects.filter((o) => o.kind === 'texture');
    expect(textures.length).toBeGreaterThan(0);
    const withNames = textures.filter((t) => t.kind === 'texture' && t.fileNames.some((f) => f.length > 0));
    expect(withNames.length).toBeGreaterThan(0);
  });

  it('reads materials referencing textures', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level/Level_01.NMO')));
    const materials = file.objects.filter((o) => o.kind === 'material');
    expect(materials.length).toBeGreaterThan(0);
    const textured = materials.filter((m) => m.kind === 'material' && m.textureIndex >= 0);
    expect(textured.length).toBeGreaterThan(0);
    for (const m of textured) {
      if (m.kind !== 'material') continue;
      expect(file.objects[m.textureIndex].classId).toBe(CKClassId.Texture);
    }
  });
});
