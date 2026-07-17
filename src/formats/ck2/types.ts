/**
 * Virtools 2.1 (CK2) file format types and constants.
 *
 * Format knowledge derived from the MIT-licensed libcmo21 project
 * (https://github.com/yyc12345/libcmo21), a clean-room reverse engineering
 * of the Virtools 2.1 runtime. This is an original TypeScript implementation.
 */

export const NEMO_MAGIC = 'Nemo Fi\0';

export const CKClassId = {
  Object: 1,
  SceneObject: 11,
  BeObject: 19,
  Level: 21,
  Place: 22,
  Group: 23,
  Sound: 24,
  WaveSound: 25,
  Material: 30,
  Texture: 31,
  Mesh: 32,
  Entity3d: 33,
  Camera: 34,
  TargetCamera: 35,
  Sprite3d: 37,
  Light: 38,
  TargetLight: 39,
  Object3d: 41,
  Curve: 43,
  RenderObject: 47,
} as const;

export const FileWriteMode = {
  Uncompressed: 0,
  ChunkCompressedOld: 1,
  ExternalTexturesOld: 2,
  ForViewer: 4,
  WholeCompressed: 8,
} as const;

/** CK_STATECHUNK identifier constants (per class). */
export const Ident = {
  // CKObject
  OBJECT_HIDDEN: 0x00000004,
  OBJECT_HIERAHIDDEN: 0x00000018,
  // CK3dEntity
  ENTITY_MESHS: 0x00004000,
  ENTITY_NDATA: 0x00100000,
  // CKGroup
  GROUP_ALL: 0x000fffff,
  // CKMesh
  MESH_FLAGS: 0x00002000,
  MESH_FACES: 0x00010000,
  MESH_VERTICES: 0x00020000,
  MESH_LINES: 0x00040000,
  MESH_MATERIALS: 0x00100000,
  // CKMaterial
  MAT_DATA: 0x00001000,
  MAT_DATA2: 0x00002000,
  MAT_DATA3: 0x00004000,
  MAT_DATA5: 0x00010000,
  // CKTexture
  TEX_AVIFILENAME: 0x00001000,
  TEX_BITMAPS: 0x00004000,
  TEX_FILENAMES: 0x00010000,
  TEX_COMPRESSED: 0x00020000,
  TEX_SAVEFORMAT: 0x00080000,
  TEX_READER: 0x00100000,
  TEX_PICKTHRESHOLD: 0x00200000,
  TEX_USERMIPMAP: 0x00400000,
  TEX_OLDTEXONLY: 0x002ff000,
  TEX_ONLY: 0x00fff000,
  // CKLight
  LIGHT_DATA: 0x00001000,
  // CKCamera
  CAMERA_ALL: 0x000fffff,
} as const;

export const ChunkOptions = {
  Ids: 0x01,
  Man: 0x02,
  Chn: 0x04,
  File: 0x08,
} as const;

/** Mesh vertex save flags */
export const VertexSaveFlags = {
  SingleColor: 0x1,
  SingleSpecularColor: 0x2,
  NoNormal: 0x4,
  SingleUV: 0x8,
  NoPos: 0x10,
} as const;

export const VxBlendMode = {
  Zero: 1,
  One: 2,
  SrcColor: 3,
  InvSrcColor: 4,
  SrcAlpha: 5,
  InvSrcAlpha: 6,
  DestAlpha: 7,
  InvDestAlpha: 8,
  DestColor: 9,
  InvDestColor: 10,
  SrcAlphaSat: 11,
} as const;

export const MESH_FLAG_VISIBLE = 0x2;
export const MESH_FLAG_PRELIT = 0x80;

export interface FileInfo {
  crc: number;
  ckVersion: number;
  fileVersion: number;
  fileWriteMode: number;
  hdr1PackSize: number;
  dataPackSize: number;
  dataUnPackSize: number;
  managerCount: number;
  objectCount: number;
  maxIdSaved: number;
  productVersion: number;
  productBuild: number;
  hdr1UnPackSize: number;
}

/** A color as normalized rgba tuple. */
export type RGBA = [number, number, number, number];

export interface ObjectBase {
  /** index in the file object table (used for all cross references) */
  index: number;
  id: number;
  classId: number;
  name: string;
  visible: boolean;
  hierHidden: boolean;
}

export interface Entity3dRec extends ObjectBase {
  kind: 'entity';
  /** file index of current mesh, -1 when none */
  meshIndex: number;
  /** 4x4 world matrix, row-major rows as stored (Virtools row vectors) */
  worldMatrix: Float32Array;
  entityFlags: number;
  moveableFlags: number;
  zOrder: number;
}

export interface MeshRec extends ObjectBase {
  kind: 'mesh';
  flags: number;
  /** file indices of material slots (-1 = none) */
  materialSlots: number[];
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** BGRA dword colors, one per vertex (may be null when untinted) */
  colors: Uint32Array | null;
  faceCount: number;
  faceIndices: Uint16Array;
  faceMaterials: Uint16Array;
}

export interface MaterialRec extends ObjectBase {
  kind: 'material';
  diffuse: RGBA;
  ambient: RGBA;
  specular: RGBA;
  emissive: RGBA;
  specularPower: number;
  textureIndex: number;
  textureBorderColor: number;
  textureBlendMode: number;
  textureMinMode: number;
  textureMagMode: number;
  sourceBlend: number;
  destBlend: number;
  shadeMode: number;
  fillMode: number;
  textureAddressMode: number;
  twoSided: boolean;
  zWrite: boolean;
  alphaBlend: boolean;
  alphaTest: boolean;
  zFunc: number;
  alphaFunc: number;
  alphaRef: number;
  effect: number;
}

export interface EmbeddedBitmap {
  ext: string;
  bytes: Uint8Array;
  /** per-pixel alpha override (length w*h) or single global alpha */
  alpha: Uint8Array | number | null;
  width: number;
  height: number;
}

export interface TextureRec extends ObjectBase {
  kind: 'texture';
  fileNames: string[];
  embedded: (EmbeddedBitmap | null)[];
  /** raw RGBA image decoded from TEX_COMPRESSED path */
  raw: { width: number; height: number; rgba: Uint8Array } | null;
  mipmap: boolean;
  transparent: boolean;
  transparentColor: number;
  saveOptions: number;
  videoFormat: number;
}

export interface GroupRec extends ObjectBase {
  kind: 'group';
  memberIndices: number[];
}

export interface LightRec extends ObjectBase {
  kind: 'light';
  entity: Entity3dRec;
  lightType: number;
  color: RGBA;
  constAttenuation: number;
  linearAttenuation: number;
  quadAttenuation: number;
  range: number;
  hotSpot: number;
  falloff: number;
  falloffShape: number;
  active: boolean;
  specularFlag: boolean;
  lightPower: number;
}

export interface OtherRec extends ObjectBase {
  kind: 'other';
}

export type CKRecord = Entity3dRec | MeshRec | MaterialRec | TextureRec | GroupRec | LightRec | OtherRec;

export interface NmoFile {
  info: FileInfo;
  objects: CKRecord[];
  /** helpers */
  groups: GroupRec[];
  entities: Entity3dRec[];
  byName: Map<string, CKRecord[]>;
}
