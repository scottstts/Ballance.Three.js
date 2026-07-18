/**
 * Virtools 2.1 (CK2) file format types and constants.
 *
 * Format knowledge derived from the MIT-licensed libcmo21 project
 * (https://github.com/yyc12345/libcmo21), a clean-room reverse engineering
 * of the Virtools 2.1 runtime. This is an original TypeScript implementation.
 */

import type { StateChunk } from './stateChunk.ts';

export const NEMO_MAGIC = 'Nemo Fi\0';

export const CKClassId = {
  Object: 1,
  ParameterIn: 2,
  ParameterOut: 3,
  ParameterOperation: 4,
  State: 5,
  BehaviorLink: 6,
  Behavior: 8,
  BehaviorIO: 9,
  SceneObject: 11,
  ObjectAnimation: 15,
  Animation: 16,
  KeyedAnimation: 18,
  BeObject: 19,
  Level: 21,
  Place: 22,
  Group: 23,
  Sound: 24,
  WaveSound: 25,
  Entity2d: 27,
  Material: 30,
  Texture: 31,
  Mesh: 32,
  Entity3d: 33,
  Camera: 34,
  TargetCamera: 35,
  CurvePoint: 36,
  Sprite3d: 37,
  Light: 38,
  TargetLight: 39,
  Object3d: 41,
  Curve: 43,
  ParameterLocal: 45,
  Parameter: 46,
  RenderObject: 47,
  DataArray: 52,
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
  // CKSound / CKWaveSound
  SOUND_FILENAME: 0x00001000,
  WAVESOUND_SETTINGS: 0x00400000,
  WAVESOUND_LENGTH: 0x00800000,
  // CKLight
  LIGHT_DATA: 0x00400000,
  LIGHT_DATA2: 0x00800000,
  // CKSprite3D (class-specific; shares the numeric identifier with CKLight)
  SPRITE3D_DATA: 0x00400000,
  // CK2dEntity
  ENTITY2D_ONLY: 0x0010f000,
  ENTITY2D_MATERIAL: 0x00200000,
  ENTITY2D_HIERARCHY: 0x00400000,
  // CKCamera
  CAMERA_ALL: 0x0fc00000,
  TARGET_CAMERA_TARGET: 0x10000000,
  // CKCurve / CKCurvePoint
  CURVE_ONLY: 0xffc00000,
  CURVE_POINT_DEFAULT_DATA: 0x10000000,
  // CKDataArray
  DATAARRAY_FORMAT: 0x00001000,
  DATAARRAY_DATA: 0x00002000,
  DATAARRAY_MEMBERS: 0x00004000,
  // CKObjectAnimation / CKKeyedAnimation
  OBJECT_ANIMATION_CONTROLLERS: 0x04000000,
  KEYED_ANIMATION_LIST: 0x00001000,
  // CKBehaviorLink
  BEHAVIOR_LINK_NEWDATA: 0x00000020,
  // CKBehaviorIO
  BEHAVIOR_IO_FLAGS: 0x00000008,
  // CKBehavior
  BEHAVIOR_NEWDATA: 0x00000020,
  // CKParameterLocal / CKParameterOut
  PARAMETER_OUT_DESTINATIONS: 0x00000020,
  PARAMETER_OUT_VALUE: 0x00000040,
  PARAMETER_OUT_OWNER: 0x00000080,
  // CKParameterIn
  PARAMETER_IN_SHARED: 0x00000800,
  PARAMETER_IN_SOURCE: 0x00001000,
  PARAMETER_IN_DISABLED: 0x00002000,
} as const;

export const CKArrayType = {
  Int: 1,
  Float: 2,
  String: 3,
  Object: 4,
  Parameter: 5,
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
  placeIndex: number;
  parentIndex: number;
}

export interface Sprite3dRec extends ObjectBase {
  kind: 'sprite3d';
  worldMatrix: Float32Array;
  entityFlags: number;
  moveableFlags: number;
  zOrder: number;
  placeIndex: number;
  parentIndex: number;
  spriteFlags: number;
  size: [number, number];
  offset: [number, number];
  uvRect: [number, number, number, number];
  materialIndex: number;
}

/** CKCamera fields layered over the shared CK3dEntity record. */
export interface CameraRec extends Entity3dRec {
  projectionType: number;
  fieldOfView: number;
  orthographicZoom: number;
  aspectRatio: number;
  nearPlane: number;
  farPlane: number;
  targetIndex: number;
}

export interface CurvePointRec extends ObjectBase {
  kind: 'curvePoint';
  entity: Entity3dRec;
  curveIndex: number;
  flags: number;
  tension: number;
  continuity: number;
  bias: number;
  curvePosition: number;
  incomingTangent: [number, number, number];
  outgoingTangent: [number, number, number];
}

export interface CurveRec extends ObjectBase {
  kind: 'curve';
  entity: Entity3dRec;
  pointIndices: number[];
  open: boolean;
  stepCount: number;
  fittingCoefficient: number;
}

export type Entity3dLikeRec = Entity3dRec | Sprite3dRec;

export interface Entity2dRec extends ObjectBase {
  kind: 'entity2d';
  flags: number;
  /** Normalized screen rectangle: left, top, right, bottom. */
  rect: [number, number, number, number];
  /** Serialized UV/relative rectangle following the screen rectangle. */
  relativeRect: [number, number, number, number];
  materialIndex: number;
  parentIndex: number;
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

export interface DataArrayColumn {
  name: string;
  type: number;
  /** Present for parameter columns; the serialized parameter-type GUID. */
  parameterGuid: [number, number] | null;
}

export type DataArrayValue = number | string | null;

export interface DataArrayRec extends ObjectBase {
  kind: 'dataArray';
  columns: DataArrayColumn[];
  rows: DataArrayValue[][];
  /** Serialized sort/key/current-row metadata retained for inspection. */
  members: number[];
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

export interface WaveSoundRec extends ObjectBase {
  kind: 'waveSound';
  fileName: string;
  saveOptions: number;
  soundLengthMs: number;
  flags: number;
  /** CK_WAVESOUND_TYPE is stored in the low three flag bits; 1 is flat/background. */
  waveType: number;
  loop: boolean;
  streaming: boolean;
  priority: number;
  gain: number;
  pan: number;
  pitch: number;
  cone: [number, number, number];
  minDistance: number;
  maxDistance: number;
  distanceModel: number;
  attachedEntityIndex: number;
  position: [number, number, number];
  direction: [number, number, number];
}

export interface ParameterRec extends ObjectBase {
  kind: 'parameter';
  /** Virtools parameter type GUID, when the parameter owns serialized data. */
  typeGuid: [number, number] | null;
  /** Parameter-manager serialization version stored before the value buffer. */
  valueVersion: number;
  valueBytes: Uint8Array;
  /** Direct CK object reference used by version-2 object/sound parameters. */
  valueObjectIndex: number;
  /** Manager-backed values are serialized as a manager GUID and integer. */
  managerGuid: [number, number] | null;
  managerInt: number | null;
  destinationIndices: number[];
  ownerIndex: number;
  sharedIndex: number;
  sourceIndex: number;
  disabled: boolean;
}

export interface BehaviorLinkRec extends ObjectBase {
  kind: 'behaviorLink';
  activationDelay: number;
  currentDelay: number;
  outputIndex: number;
  inputIndex: number;
}

export interface BehaviorIoRec extends ObjectBase {
  kind: 'behaviorIo';
  flags: number;
}

export interface BehaviorRec extends ObjectBase {
  kind: 'behavior';
  behaviorFlags: number;
  saveFlags: number;
  /** Full plugin/script-specific header preceding the reference arrays. */
  headerData: number[];
  /**
   * Ordered XObjectArray payloads from CK_STATESAVE_BEHAVIORNEWDATA. Lists
   * are deliberately retained generically: their referenced class IDs make
   * sub-behaviors, links, parameter operations, parameters and input/output
   * IO unambiguous without hard-coding plugin-specific behavior layouts.
   */
  referenceLists: number[][];
  /** Unexpected trailing dwords, retained so archaeology never drops data. */
  trailingData: number[];
}

export interface RotationKey {
  time: number;
  quaternion: [number, number, number, number];
  tension: number;
  continuity: number;
  bias: number;
  easeTo: number;
  easeFrom: number;
}

export interface ObjectAnimationRec extends ObjectBase {
  kind: 'objectAnimation';
  entityIndex: number;
  length: number;
  rotationKeys: RotationKey[];
}

export interface KeyedAnimationRec extends ObjectBase {
  kind: 'keyedAnimation';
  animationIndices: number[];
}

export interface OtherRec extends ObjectBase {
  kind: 'other';
}

export type CKRecord =
  | Entity3dRec
  | CurvePointRec
  | CurveRec
  | Sprite3dRec
  | Entity2dRec
  | MeshRec
  | MaterialRec
  | TextureRec
  | GroupRec
  | LightRec
  | WaveSoundRec
  | DataArrayRec
  | ParameterRec
  | BehaviorLinkRec
  | BehaviorIoRec
  | BehaviorRec
  | ObjectAnimationRec
  | KeyedAnimationRec
  | OtherRec;

export interface ManagerDataRec {
  guid: [number, number];
  /** Raw manager state retained for source archaeology and manager-backed values. */
  chunk: StateChunk | null;
}

export interface NmoFile {
  info: FileInfo;
  managers: ManagerDataRec[];
  /** CKMessageManager registry; indices are the serialized CKMessageType values. */
  messageTypes: string[];
  objects: CKRecord[];
  /** Raw per-object chunks retained for read-only format archaeology tools. */
  chunks: (StateChunk | null)[];
  /** helpers */
  groups: GroupRec[];
  entities: Entity3dLikeRec[];
  byName: Map<string, CKRecord[]>;
}
