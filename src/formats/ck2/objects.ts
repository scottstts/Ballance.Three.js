/**
 * Per-class object state loaders for the CK classes Ballance data uses.
 */
import { StateChunk } from './stateChunk.ts';
import {
  CKClassId,
  CKArrayType,
  Ident,
  VertexSaveFlags,
  type CKRecord,
  type DataArrayRec,
  type DataArrayValue,
  type EmbeddedBitmap,
  type Entity2dRec,
  type Entity3dRec,
  type GroupRec,
  type LightRec,
  type MaterialRec,
  type MeshRec,
  type ObjectBase,
  type ParameterRec,
  type BehaviorLinkRec,
  type BehaviorIoRec,
  type BehaviorRec,
  type ObjectAnimationRec,
  type KeyedAnimationRec,
  type RGBA,
  type Sprite3dRec,
  type TextureRec,
} from './types.ts';

function argbToRgba(v: number): RGBA {
  return [((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255, (v & 0xff) / 255, ((v >>> 24) & 0xff) / 255];
}

function loadBase(index: number, id: number, classId: number, name: string, chunk: StateChunk | null): ObjectBase {
  let visible = true;
  let hierHidden = false;
  if (chunk) {
    if (chunk.seekIdentifier(Ident.OBJECT_HIDDEN) >= 0) {
      visible = false;
    } else if (chunk.seekIdentifier(Ident.OBJECT_HIERAHIDDEN) >= 0) {
      visible = false;
      hierHidden = true;
    }
  }
  return { index, id, classId, name, visible, hierHidden };
}

const ENTITY_FLAG_PLACEVALID = 0x00010000;
const ENTITY_FLAG_PARENTVALID = 0x00020000;
const ENTITY_FLAG_ZORDERVALID = 0x00100000;

function loadEntityInto(base: ObjectBase, chunk: StateChunk): Entity3dRec {
  const rec: Entity3dRec = {
    ...base,
    kind: 'entity',
    meshIndex: -1,
    worldMatrix: identityMatrix(),
    entityFlags: 0,
    moveableFlags: 0,
    zOrder: 0,
    placeIndex: -1,
    parentIndex: -1,
  };
  if (chunk.seekIdentifier(Ident.ENTITY_MESHS) >= 0) {
    rec.meshIndex = chunk.objectRef();
    chunk.objectRefArray(); // potential meshes, unused
  }
  if (chunk.seekIdentifier(Ident.ENTITY_NDATA) >= 0) {
    rec.entityFlags = chunk.u32();
    rec.moveableFlags = chunk.u32();
    const m = rec.worldMatrix;
    // stored as 4 row vectors of 3 floats (right, up, forward, position)
    for (let row = 0; row < 4; row++) {
      m[row * 4 + 0] = chunk.f32();
      m[row * 4 + 1] = chunk.f32();
      m[row * 4 + 2] = chunk.f32();
      m[row * 4 + 3] = row === 3 ? 1 : 0;
    }
    if (rec.entityFlags & ENTITY_FLAG_PLACEVALID) rec.placeIndex = chunk.objectRef();
    if (rec.entityFlags & ENTITY_FLAG_PARENTVALID) rec.parentIndex = chunk.objectRef();
    if (rec.entityFlags & ENTITY_FLAG_ZORDERVALID) rec.zOrder = chunk.i32();
  }
  return rec;
}

function identityMatrix(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function loadEntity2d(base: ObjectBase, chunk: StateChunk): Entity2dRec {
  const rec: Entity2dRec = {
    ...base,
    kind: 'entity2d',
    flags: 0,
    rect: [0, 0, 1, 1],
    relativeRect: [0, 0, 1, 1],
    materialIndex: -1,
    parentIndex: -1,
  };
  const dataSize = chunk.seekIdentifier(Ident.ENTITY2D_ONLY);
  if (dataSize >= 36) {
    rec.flags = chunk.u32();
    rec.rect = [chunk.f32(), chunk.f32(), chunk.f32(), chunk.f32()];
    rec.relativeRect = [chunk.f32(), chunk.f32(), chunk.f32(), chunk.f32()];
  }
  if (chunk.seekIdentifier(Ident.ENTITY2D_MATERIAL) >= 4) rec.materialIndex = chunk.objectRef();
  if (chunk.seekIdentifier(Ident.ENTITY2D_HIERARCHY) >= 4) rec.parentIndex = chunk.objectRef();
  return rec;
}

function loadSprite3d(base: ObjectBase, chunk: StateChunk): Sprite3dRec {
  const loaded = loadEntityInto(base, chunk);
  const { kind: _kind, meshIndex: _meshIndex, ...entity } = loaded;
  const rec: Sprite3dRec = {
    ...entity,
    kind: 'sprite3d',
    spriteFlags: 0,
    size: [1, 1],
    offset: [0, 0],
    uvRect: [0, 0, 1, 1],
    materialIndex: -1,
  };
  if (chunk.seekIdentifier(Ident.SPRITE3D_DATA) >= 40) {
    rec.spriteFlags = chunk.u32();
    rec.size = [chunk.f32(), chunk.f32()];
    rec.offset = [chunk.f32(), chunk.f32()];
    rec.uvRect = [chunk.f32(), chunk.f32(), chunk.f32(), chunk.f32()];
    rec.materialIndex = chunk.objectRef();
  }
  return rec;
}

function loadMesh(base: ObjectBase, chunk: StateChunk): MeshRec {
  const rec: MeshRec = {
    ...base,
    kind: 'mesh',
    flags: 0,
    materialSlots: [],
    vertexCount: 0,
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    colors: null,
    faceCount: 0,
    faceIndices: new Uint16Array(0),
    faceMaterials: new Uint16Array(0),
  };
  if (chunk.dataVersion < 9) return rec; // pre-mesh-change format not used by Ballance

  if (chunk.seekIdentifier(Ident.MESH_FLAGS) >= 0) {
    rec.flags = chunk.u32();
  }
  if (chunk.seekIdentifier(Ident.MESH_MATERIALS) >= 0) {
    const count = chunk.u32();
    for (let i = 0; i < count; i++) {
      rec.materialSlots.push(chunk.objectRef());
      chunk.u32(); // reserved dword after each slot
    }
  }
  let saveFlags = 0;
  if (chunk.seekIdentifier(Ident.MESH_VERTICES) >= 0) {
    const vertexCount = chunk.u32();
    rec.vertexCount = vertexCount;
    if (vertexCount) {
      saveFlags = chunk.u32();
      chunk.u32(); // payload dword size incl. itself
      rec.positions = new Float32Array(vertexCount * 3);
      rec.normals = new Float32Array(vertexCount * 3);
      rec.uvs = new Float32Array(vertexCount * 2);

      if (!(saveFlags & VertexSaveFlags.NoPos)) {
        for (let i = 0; i < vertexCount * 3; i++) rec.positions[i] = chunk.f32();
      }
      if (!(saveFlags & VertexSaveFlags.SingleColor)) {
        const colors = new Uint32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) colors[i] = chunk.u32();
        rec.colors = colors;
      } else {
        const c = chunk.u32();
        if (c !== 0xffffffff) {
          rec.colors = new Uint32Array(vertexCount).fill(c);
        }
      }
      if (!(saveFlags & VertexSaveFlags.SingleSpecularColor)) {
        chunk.skipDwords(vertexCount);
      } else {
        chunk.skipDwords(1);
      }
      if (!(saveFlags & VertexSaveFlags.NoNormal)) {
        for (let i = 0; i < vertexCount * 3; i++) rec.normals[i] = chunk.f32();
      }
      if (!(saveFlags & VertexSaveFlags.SingleUV)) {
        for (let i = 0; i < vertexCount * 2; i++) rec.uvs[i] = chunk.f32();
      } else {
        const u = chunk.f32();
        const v = chunk.f32();
        for (let i = 0; i < vertexCount; i++) {
          rec.uvs[i * 2] = u;
          rec.uvs[i * 2 + 1] = v;
        }
      }
    }
  }
  if (chunk.seekIdentifier(Ident.MESH_FACES) >= 0) {
    const faceCount = chunk.u32();
    rec.faceCount = faceCount;
    rec.faceIndices = new Uint16Array(faceCount * 3);
    rec.faceMaterials = new Uint16Array(faceCount);
    // each face: 2 dwords = idx0,idx1 | idx2,mtlIndex (16-bit words, LE)
    for (let i = 0; i < faceCount; i++) {
      const a = chunk.u32();
      const b = chunk.u32();
      rec.faceIndices[i * 3] = a & 0xffff;
      rec.faceIndices[i * 3 + 1] = a >>> 16;
      rec.faceIndices[i * 3 + 2] = b & 0xffff;
      rec.faceMaterials[i] = b >>> 16;
    }
  }
  if (saveFlags & VertexSaveFlags.NoNormal) {
    buildNormals(rec);
  }
  return rec;
}

function buildNormals(rec: MeshRec): void {
  const { positions, normals, faceIndices } = rec;
  for (let i = 0; i < faceIndices.length; i += 3) {
    const a = faceIndices[i] * 3;
    const b = faceIndices[i + 1] * 3;
    const c = faceIndices[i + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vi of [a, b, c]) {
      normals[vi] += nx;
      normals[vi + 1] += ny;
      normals[vi + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
}

function loadMaterial(base: ObjectBase, chunk: StateChunk): MaterialRec {
  const rec: MaterialRec = {
    ...base,
    kind: 'material',
    diffuse: [1, 1, 1, 1],
    ambient: [0.3, 0.3, 0.3, 1],
    specular: [0.5, 0.5, 0.5, 1],
    emissive: [0, 0, 0, 1],
    specularPower: 0,
    textureIndex: -1,
    textureBorderColor: 0,
    textureBlendMode: 1,
    textureMinMode: 3,
    textureMagMode: 3,
    sourceBlend: 1,
    destBlend: 1,
    shadeMode: 3,
    fillMode: 3,
    textureAddressMode: 1,
    twoSided: false,
    zWrite: true,
    alphaBlend: false,
    alphaTest: false,
    zFunc: 4,
    alphaFunc: 8,
    alphaRef: 0,
    effect: 0,
  };
  if (chunk.seekIdentifier(Ident.MAT_DATA) >= 0 && chunk.dataVersion >= 5) {
    rec.diffuse = argbToRgba(chunk.u32());
    rec.ambient = argbToRgba(chunk.u32());
    rec.specular = argbToRgba(chunk.u32());
    rec.emissive = argbToRgba(chunk.u32());
    rec.specularPower = chunk.f32();
    rec.textureIndex = chunk.objectRef();
    rec.textureBorderColor = chunk.u32();
    let mix = chunk.u32();
    rec.textureBlendMode = mix & 0xf;
    mix >>>= 4;
    rec.textureMinMode = mix & 0xf;
    mix >>>= 4;
    rec.textureMagMode = mix & 0xf;
    mix >>>= 4;
    rec.sourceBlend = mix & 0xf;
    mix >>>= 4;
    rec.destBlend = mix & 0xf;
    mix >>>= 4;
    rec.shadeMode = mix & 0xf;
    mix >>>= 4;
    rec.fillMode = mix & 0xf;
    mix >>>= 4;
    rec.textureAddressMode = mix & 0xf;
    let mix2 = chunk.u32();
    rec.twoSided = !!(mix2 & 0b1);
    rec.zWrite = !!(mix2 & 0b10);
    rec.alphaBlend = !!(mix2 & 0b1000);
    rec.alphaTest = !!(mix2 & 0b10000);
    mix2 >>>= 8;
    rec.zFunc = mix2 & 0xff;
    mix2 >>>= 8;
    rec.alphaFunc = mix2 & 0xff;
    mix2 >>>= 8;
    rec.alphaRef = mix2 & 0xff;
  }
  if (chunk.seekIdentifier(Ident.MAT_DATA3) >= 0) {
    rec.effect = chunk.u32();
  }
  return rec;
}

const cp1252 = new TextDecoder('windows-1252');

function loadTexture(base: ObjectBase, chunk: StateChunk): TextureRec {
  const rec: TextureRec = {
    ...base,
    kind: 'texture',
    fileNames: [],
    embedded: [],
    raw: null,
    mipmap: false,
    transparent: false,
    transparentColor: 0,
    saveOptions: 0,
    videoFormat: -1,
  };
  let slotCount = 0;
  const loaded: boolean[] = [];

  if (chunk.seekIdentifier(Ident.TEX_READER) >= 0) {
    slotCount = chunk.u32();
    const width = chunk.u32();
    const height = chunk.u32();
    chunk.u32(); // bpp
    for (let i = 0; i < slotCount; i++) {
      const embedded = readSpecificFormatBitmap(chunk, width, height);
      rec.embedded[i] = embedded;
      loaded[i] = embedded !== null;
    }
  } else if (chunk.seekIdentifier(Ident.TEX_COMPRESSED) >= 0) {
    slotCount = chunk.u32();
    for (let i = 0; i < slotCount; i++) {
      const raw = readRawBitmap(chunk);
      if (raw) {
        rec.raw = raw;
        loaded[i] = true;
      }
    }
  }

  if (chunk.seekIdentifier(Ident.TEX_FILENAMES) >= 0) {
    const count = chunk.u32();
    slotCount = Math.max(slotCount, count);
    for (let i = 0; i < count; i++) {
      rec.fileNames[i] = chunk.string();
    }
  }

  const onlySize = chunk.seekIdentifier(Ident.TEX_OLDTEXONLY);
  if (onlySize >= 0 || chunk.seekIdentifier(Ident.TEX_ONLY) >= 0) {
    let mix = chunk.u32();
    rec.mipmap = (mix & 0xff) !== 0;
    mix >>>= 8;
    const flags = mix & 0xff;
    rec.transparent = !!(flags & 0x1);
    const hasVideoFmt = !!(flags & 0x2);
    mix >>>= 8;
    rec.saveOptions = mix & 0xff;
    rec.transparentColor = chunk.u32();
    if (slotCount > 1) chunk.u32(); // current slot
    if (hasVideoFmt) rec.videoFormat = chunk.u32();
  }
  return rec;
}

function readSpecificFormatBitmap(chunk: StateChunk, width: number, height: number): EmbeddedBitmap | null {
  const transProp = chunk.u32();
  const extRaw = chunk.bytes(4);
  let ext = cp1252.decode(extRaw);
  const nul = ext.indexOf('\0');
  if (nul >= 0) ext = ext.substring(0, nul);
  chunk.skipDwords(2); // reader guid
  const imgByteSize = chunk.u32();
  if (imgByteSize === 0) return null;
  const bytes = chunk.bytes(imgByteSize);
  let alpha: Uint8Array | number | null = null;
  if (transProp === 2) {
    const alphaCount = chunk.u32();
    if (alphaCount === 1) {
      alpha = chunk.u32() & 0xff;
    } else {
      alpha = chunk.buffer();
    }
  }
  return { ext: ext.toLowerCase(), bytes, alpha, width, height };
}

function readRawBitmap(chunk: StateChunk): { width: number; height: number; rgba: Uint8Array } | null {
  const bytePerPixel = chunk.u32();
  if (bytePerPixel === 0) return null;
  const width = chunk.u32();
  const height = chunk.u32();
  chunk.skipDwords(4); // alpha/red/green/blue masks
  const bufOpt = chunk.u32() & 0xf;
  if (bufOpt !== 0) return null; // jpeg-compressed channels unsupported
  const blue = chunk.buffer();
  const green = chunk.buffer();
  const red = chunk.buffer();
  const alpha = chunk.buffer();
  const pixelCount = width * height;
  if (blue.length < pixelCount || green.length < pixelCount || red.length < pixelCount) return null;
  const rgba = new Uint8Array(pixelCount * 4);
  for (let p = 0; p < pixelCount; p++) {
    rgba[p * 4] = red[p];
    rgba[p * 4 + 1] = green[p];
    rgba[p * 4 + 2] = blue[p];
    rgba[p * 4 + 3] = alpha.length >= pixelCount ? alpha[p] : 0xff;
  }
  // stored bottom-up; flip to top-down
  const flipped = new Uint8Array(pixelCount * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    flipped.set(rgba.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  return { width, height, rgba: flipped };
}

function loadGroup(base: ObjectBase, chunk: StateChunk): GroupRec {
  const rec: GroupRec = { ...base, kind: 'group', memberIndices: [] };
  if (chunk.seekIdentifier(Ident.GROUP_ALL) >= 0) {
    rec.memberIndices = chunk.objectRefArray().filter((i) => i >= 0);
  }
  return rec;
}

function loadDataArray(base: ObjectBase, chunk: StateChunk): DataArrayRec {
  const rec: DataArrayRec = { ...base, kind: 'dataArray', columns: [], rows: [], members: [] };
  if (chunk.seekIdentifier(Ident.DATAARRAY_FORMAT) >= 0) {
    const count = chunk.u32();
    for (let i = 0; i < count; i++) {
      const name = chunk.string();
      const type = chunk.u32();
      const parameterGuid: [number, number] | null =
        type === CKArrayType.Parameter ? [chunk.u32(), chunk.u32()] : null;
      rec.columns.push({ name, type, parameterGuid });
    }
  }
  if (chunk.seekIdentifier(Ident.DATAARRAY_DATA) >= 0) {
    const count = chunk.u32();
    for (let rowIndex = 0; rowIndex < count; rowIndex++) {
      const row: DataArrayValue[] = [];
      for (const column of rec.columns) {
        switch (column.type) {
          case CKArrayType.Int:
            row.push(chunk.i32());
            break;
          case CKArrayType.Float:
            row.push(chunk.f32());
            break;
          case CKArrayType.String:
            row.push(chunk.string());
            break;
          case CKArrayType.Object:
          case CKArrayType.Parameter:
            row.push(chunk.objectRef());
            break;
          default:
            // Unknown columns are a single dword in Virtools 2.1 data arrays.
            row.push(chunk.u32());
            break;
        }
      }
      rec.rows.push(row);
    }
  }
  const membersSize = chunk.seekIdentifier(Ident.DATAARRAY_MEMBERS);
  if (membersSize >= 0) {
    for (let i = 0; i < membersSize / 4; i++) rec.members.push(chunk.u32());
  }
  return rec;
}

function loadLight(base: ObjectBase, chunk: StateChunk): LightRec {
  const entity = loadEntityInto(base, chunk);
  const rec: LightRec = {
    ...base,
    kind: 'light',
    entity,
    lightType: 1,
    color: [1, 1, 1, 1],
    constAttenuation: 1,
    linearAttenuation: 0,
    quadAttenuation: 0,
    range: 5000,
    hotSpot: 0.6981317,
    falloff: 0.7853982,
    falloffShape: 1,
    active: true,
    specularFlag: false,
    lightPower: 1,
  };
  const lightDataSize = chunk.seekIdentifier(Ident.LIGHT_DATA);
  if (lightDataSize >= 24) {
    // Lowest byte is VXLIGHT_TYPE; upper bytes are CKLight::LightFlags.
    const typeAndFlags = chunk.u32();
    rec.lightType = typeAndFlags & 0xff;
    rec.active = (typeAndFlags & 0x100) !== 0;
    rec.specularFlag = (typeAndFlags & 0x200) !== 0;
    rec.color = argbToRgba(chunk.u32());
    rec.constAttenuation = chunk.f32();
    rec.linearAttenuation = chunk.f32();
    rec.quadAttenuation = chunk.f32();
    rec.range = chunk.f32();
    if (rec.lightType === 2 && lightDataSize >= 36) {
      rec.falloff = chunk.f32();
      rec.hotSpot = chunk.f32();
      rec.falloffShape = chunk.f32();
    }
  }
  if (chunk.seekIdentifier(Ident.LIGHT_DATA2) >= 0) rec.lightPower = chunk.f32();
  return rec;
}

function loadParameter(base: ObjectBase, chunk: StateChunk): ParameterRec {
  const rec: ParameterRec = {
    ...base,
    kind: 'parameter',
    typeGuid: null,
    valueVersion: 0,
    valueBytes: new Uint8Array(0),
    valueObjectIndex: -1,
    destinationIndices: [],
    ownerIndex: -1,
    sharedIndex: -1,
    sourceIndex: -1,
    disabled: chunk.seekIdentifier(Ident.PARAMETER_IN_DISABLED) >= 0,
  };

  const valueSize = chunk.seekIdentifier(Ident.PARAMETER_OUT_VALUE);
  if (valueSize >= 8) {
    const end = chunk.cursor + valueSize / 4;
    rec.typeGuid = [chunk.u32(), chunk.u32()];
    if (chunk.cursor < end) rec.valueVersion = chunk.u32();
    if (chunk.cursor < end) {
      const remainingDwords = end - chunk.cursor;
      if (rec.valueVersion === 2 && remainingDwords === 1) {
        rec.valueObjectIndex = chunk.objectRef();
      } else {
        // Primitive parameter values (version 1) store a byte count. Complex
        // runtime types (version 0), including CK2dCurve, store a packed
        // CKStateChunk preceded by its dword count instead. Keeping the full
        // packed value is essential: treating that count as bytes silently
        // truncated every authored Bezier curve after its header.
        const serializedLength = chunk.u32();
        const byteLength = rec.valueVersion === 0 ? serializedLength * 4 : serializedLength;
        const availableBytes = Math.max(0, (end - chunk.cursor) * 4);
        rec.valueBytes = chunk.bytes(Math.min(byteLength, availableBytes));
      }
    }
  }

  if (chunk.seekIdentifier(Ident.PARAMETER_OUT_DESTINATIONS) >= 0) {
    rec.destinationIndices = chunk.objectRefArray();
  }
  if (chunk.seekIdentifier(Ident.PARAMETER_OUT_OWNER) >= 0) rec.ownerIndex = chunk.objectRef();
  const sharedSize = chunk.seekIdentifier(Ident.PARAMETER_IN_SHARED);
  if (sharedSize >= 12) {
    rec.typeGuid = [chunk.u32(), chunk.u32()];
    rec.sharedIndex = chunk.objectRef();
  }
  const sourceSize = chunk.seekIdentifier(Ident.PARAMETER_IN_SOURCE);
  if (sourceSize >= 12) {
    rec.typeGuid = [chunk.u32(), chunk.u32()];
    rec.sourceIndex = chunk.objectRef();
  }
  return rec;
}

function loadBehaviorLink(base: ObjectBase, chunk: StateChunk): BehaviorLinkRec {
  const rec: BehaviorLinkRec = {
    ...base,
    kind: 'behaviorLink',
    activationDelay: 0,
    currentDelay: 0,
    outputIndex: -1,
    inputIndex: -1,
  };
  const size = chunk.seekIdentifier(Ident.BEHAVIOR_LINK_NEWDATA);
  if (size >= 12) {
    const delays = chunk.u32();
    rec.activationDelay = delays & 0xffff;
    rec.currentDelay = delays >>> 16;
    rec.outputIndex = chunk.objectRef();
    rec.inputIndex = chunk.objectRef();
  }
  return rec;
}

function loadBehaviorIo(base: ObjectBase, chunk: StateChunk): BehaviorIoRec {
  const rec: BehaviorIoRec = { ...base, kind: 'behaviorIo', flags: 0 };
  if (chunk.seekIdentifier(Ident.BEHAVIOR_IO_FLAGS) >= 0) rec.flags = chunk.u32();
  return rec;
}

function loadBehavior(base: ObjectBase, chunk: StateChunk): BehaviorRec {
  const rec: BehaviorRec = {
    ...base,
    kind: 'behavior',
    behaviorFlags: 0,
    saveFlags: 0,
    headerData: [],
    referenceLists: [],
    trailingData: [],
  };
  const size = chunk.seekIdentifier(Ident.BEHAVIOR_NEWDATA);
  if (size < 4) return rec;

  const payload: number[] = [];
  for (let i = 0; i < size / 4; i++) payload.push(chunk.u32());
  rec.behaviorFlags = payload[0] ?? 0;

  // Script behaviors have a 2-dword header. Plugin building blocks add a
  // prototype GUID plus optional owner/target references before the same
  // sequence of counted object-reference arrays. Find the first boundary
  // whose arrays consume the payload exactly; this is stable across both.
  let parsed: { start: number; lists: number[][] } | null = null;
  for (let start = 1; start < payload.length; start++) {
    const lists: number[][] = [];
    let pos = start;
    let valid = true;
    while (pos < payload.length) {
      const count = payload[pos++] >>> 0;
      if (count > payload.length - pos) {
        valid = false;
        break;
      }
      const refs = payload.slice(pos, pos + count).map((value) => ((value | 0) >= 0 ? value | 0 : -1));
      pos += count;
      lists.push(refs);
    }
    if (valid && pos === payload.length && lists.length > 0) {
      parsed = { start, lists };
      break;
    }
  }

  if (parsed) {
    rec.headerData = payload.slice(0, parsed.start);
    rec.saveFlags = rec.headerData.at(-1) ?? 0;
    rec.referenceLists = parsed.lists;
  } else {
    rec.headerData = payload;
    rec.saveFlags = payload.at(-1) ?? 0;
    rec.trailingData = payload.slice(1);
  }
  return rec;
}

function dwordAsFloat(value: number): number {
  const buffer = new ArrayBuffer(4);
  new Uint32Array(buffer)[0] = value;
  return new Float32Array(buffer)[0];
}

function loadObjectAnimation(base: ObjectBase, chunk: StateChunk): ObjectAnimationRec {
  const rec: ObjectAnimationRec = { ...base, kind: 'objectAnimation', entityIndex: -1, length: 0, rotationKeys: [] };
  const size = chunk.seekIdentifier(Ident.OBJECT_ANIMATION_CONTROLLERS);
  if (size < 52) return rec;
  const payload = Array.from({ length: size / 4 }, () => chunk.u32());
  // Ballance's Virtools 2.1 controller serialization: eight controller
  // slots, target entity, duration, controller tag/flags, then TCB rotation
  // keys (time + quaternion + tension/continuity/bias/eases).
  rec.entityIndex = (payload[8] | 0) >= 0 ? payload[8] | 0 : -1;
  rec.length = dwordAsFloat(payload[9]);
  const count = payload[12] >>> 0;
  let pos = 13;
  if (count > 1024 || pos + count * 10 > payload.length) return rec;
  for (let i = 0; i < count; i++) {
    rec.rotationKeys.push({
      time: dwordAsFloat(payload[pos]),
      quaternion: [
        dwordAsFloat(payload[pos + 1]),
        dwordAsFloat(payload[pos + 2]),
        dwordAsFloat(payload[pos + 3]),
        dwordAsFloat(payload[pos + 4]),
      ],
      tension: dwordAsFloat(payload[pos + 5]),
      continuity: dwordAsFloat(payload[pos + 6]),
      bias: dwordAsFloat(payload[pos + 7]),
      easeTo: dwordAsFloat(payload[pos + 8]),
      easeFrom: dwordAsFloat(payload[pos + 9]),
    });
    pos += 10;
  }
  return rec;
}

function loadKeyedAnimation(base: ObjectBase, chunk: StateChunk): KeyedAnimationRec {
  const rec: KeyedAnimationRec = { ...base, kind: 'keyedAnimation', animationIndices: [] };
  if (chunk.seekIdentifier(Ident.KEYED_ANIMATION_LIST) >= 0) rec.animationIndices = chunk.objectRefArray();
  return rec;
}

export function loadObjectRecord(
  index: number,
  id: number,
  classId: number,
  name: string,
  chunk: StateChunk | null,
): CKRecord {
  const base = loadBase(index, id, classId, name, chunk);
  if (!chunk) return { ...base, kind: 'other' };
  switch (classId) {
    case CKClassId.Entity2d:
      return loadEntity2d(base, chunk);
    case CKClassId.Entity3d:
    case CKClassId.Object3d:
    case CKClassId.Camera:
    case CKClassId.TargetCamera:
      return loadEntityInto(base, chunk);
    case CKClassId.Sprite3d:
      return loadSprite3d(base, chunk);
    case CKClassId.Mesh:
      return loadMesh(base, chunk);
    case CKClassId.Material:
      return loadMaterial(base, chunk);
    case CKClassId.Texture:
      return loadTexture(base, chunk);
    case CKClassId.Group:
      return loadGroup(base, chunk);
    case CKClassId.DataArray:
      return loadDataArray(base, chunk);
    case CKClassId.ParameterIn:
    case CKClassId.ParameterOut:
    case CKClassId.ParameterLocal:
    case CKClassId.Parameter:
      return loadParameter(base, chunk);
    case CKClassId.BehaviorLink:
      return loadBehaviorLink(base, chunk);
    case CKClassId.BehaviorIO:
      return loadBehaviorIo(base, chunk);
    case CKClassId.Behavior:
      return loadBehavior(base, chunk);
    case CKClassId.ObjectAnimation:
      return loadObjectAnimation(base, chunk);
    case CKClassId.KeyedAnimation:
      return loadKeyedAnimation(base, chunk);
    case CKClassId.Light:
    case CKClassId.TargetLight:
      return loadLight(base, chunk);
    default:
      return { ...base, kind: 'other' };
  }
}
