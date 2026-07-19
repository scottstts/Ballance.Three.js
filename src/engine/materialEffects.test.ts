/**
 * VX_EFFECT and material-channel authority: the effect save is the 0x10000
 * material chunk (object ref to the TexGen parameter + enum), and the
 * dome/UFO environment overlays are CKMesh material channels (0x4000).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { MaterialRec, MeshRec, NmoFile } from '../formats/ck2/types.ts';

const GAME_DIR = fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url));

function material(file: NmoFile, name: string): MaterialRec {
  const rec = file.byName.get(name)?.find((entry): entry is MaterialRec => entry.kind === 'material');
  if (!rec) throw new Error(`missing material ${name}`);
  return rec;
}

function mesh(file: NmoFile, name: string): MeshRec {
  const rec = file.byName.get(name)?.find((entry): entry is MeshRec => entry.kind === 'mesh');
  if (!rec) throw new Error(`missing mesh ${name}`);
  return rec;
}

function texGenType(file: NmoFile, rec: MaterialRec): number | null {
  const parameter = rec.effectParameterIndex >= 0 ? file.objects[rec.effectParameterIndex] : null;
  if (parameter?.kind !== 'parameter' || !parameter.valueBytes || parameter.valueBytes.length < 4) return null;
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
}

describe.skipIf(!existsSync(GAME_DIR))('material effects and channels', () => {
  it('recovers the authored TexGen materials', () => {
    const menu = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/MenuLevel.nmo')));
    // Menu rails: live Chrome (camera-space normal).
    const rail = material(menu, 'I_Rail');
    expect(rail.effect).toBe(1);
    expect(texGenType(menu, rail)).toBe(3);
    // Menu trafo shells: live Reflect.
    expect(material(menu, 'I_Trafo_Wood').effect).toBe(1);
    expect(texGenType(menu, material(menu, 'I_Trafo_Wood'))).toBe(2);
    // The only TexGen-with-referential material (NULL referential = camera).
    expect(material(menu, 'I_DomeEnvironment').effect).toBe(2);

    const dome = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Dome.nmo')));
    const domeEnvironment = material(dome, 'P_DomeEnvironment');
    expect(domeEnvironment.effect).toBe(1);
    expect(texGenType(dome, domeEnvironment)).toBe(3);

    const balloon = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/PE_Balloon.nmo')));
    const ufoEnvironment = material(balloon, 'PE_Ufo_env');
    expect(ufoEnvironment.effect).toBe(1);
    expect(texGenType(balloon, ufoEnvironment)).toBe(2);

    const trafoAnim = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/AnimTrafo.nmo')));
    expect(material(trafoAnim, 'AnimTrafo_RingParts').effect).toBe(1);
    expect(texGenType(trafoAnim, material(trafoAnim, 'AnimTrafo_RingParts'))).toBe(2);
  });

  it('recovers the dome and UFO environment channels as Zero/SrcColor passes', () => {
    const dome = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Dome.nmo')));
    const domeMesh = mesh(dome, 'P_Dome_MF_Mesh');
    expect(domeMesh.channels).toHaveLength(1);
    expect(domeMesh.channels[0].sourceBlend).toBe(1); // VXBLEND_ZERO
    expect(domeMesh.channels[0].destBlend).toBe(3); // VXBLEND_SRCCOLOR
    expect(domeMesh.channels[0].uvs.length / 2).toBe(domeMesh.vertexCount);
    expect(dome.objects[domeMesh.channels[0].materialIndex]?.name).toBe('P_DomeEnvironment');

    const balloon = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/PE_Balloon.nmo')));
    for (const name of ['PE_UFO_Top_Mesh', 'PE_UFO_Body_Mesh']) {
      const rec = mesh(balloon, name);
      expect(rec.channels).toHaveLength(1);
      expect(rec.channels[0].sourceBlend).toBe(1);
      expect(rec.channels[0].destBlend).toBe(3);
      expect(balloon.objects[rec.channels[0].materialIndex]?.name).toBe('PE_Ufo_env');
    }
  });

  it('keeps level rails effect-free (their reflection is the origin UV bake)', () => {
    const level = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level/Level_01.NMO')));
    for (const rec of level.objects) {
      if (rec?.kind !== 'material') continue;
      expect(rec.effect, `${rec.name} must not carry a baked effect`).toBe(0);
    }
  });
});
