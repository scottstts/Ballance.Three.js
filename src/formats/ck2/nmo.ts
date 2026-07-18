/**
 * Virtools 2.1 NMO/CMO file parser (file version 7-9).
 * Produces plain data records for the subset of classes Ballance uses.
 */
import { unzlibSync } from 'fflate';
import { StateChunk } from './stateChunk.ts';
import {
  CKClassId,
  FileWriteMode,
  type CKRecord,
  type FileInfo,
  type GroupRec,
  type Entity3dLikeRec,
  type ManagerDataRec,
  type NmoFile,
} from './types.ts';
import { loadObjectRecord } from './objects.ts';

const cp1252 = new TextDecoder('windows-1252');
const HEADER_SIZE = 64;

class ByteReader {
  view: DataView;
  bytes: Uint8Array;
  pos = 0;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  raw(n: number): Uint8Array {
    const v = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  skip(n: number): void {
    this.pos += n;
  }
}

interface TableEntry {
  objectId: number;
  classId: number;
  fileIndex: number;
  name: string;
}

function inflate(src: Uint8Array, unpackedSize: number): Uint8Array {
  return unzlibSync(src, { out: new Uint8Array(unpackedSize) });
}

function decodeMessageTypes(managers: ManagerDataRec[]): string[] {
  const manager = managers.find(({ guid }) => guid[0] === 0x466a0fac && guid[1] === 0);
  const chunk = manager?.chunk;
  if (!chunk || chunk.seekIdentifier(83) < 4) return [];
  const count = chunk.u32();
  return Array.from({ length: count }, () => chunk.string());
}

export function parseNmo(buffer: ArrayBuffer | Uint8Array): NmoFile {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < HEADER_SIZE) throw new Error('file too small');
  const magic = cp1252.decode(bytes.subarray(0, 7));
  if (magic !== 'Nemo Fi') throw new Error('not a Virtools file (bad magic)');

  const hdr = new ByteReader(bytes);
  hdr.skip(8);
  const info: FileInfo = {
    crc: hdr.u32(),
    ckVersion: hdr.u32(),
    fileVersion: hdr.u32(),
    fileWriteMode: (hdr.skip(4), hdr.u32()), // skip Zero dword
    hdr1PackSize: hdr.u32(),
    dataPackSize: hdr.u32(),
    dataUnPackSize: hdr.u32(),
    managerCount: hdr.u32(),
    objectCount: hdr.u32(),
    maxIdSaved: hdr.u32(),
    productVersion: hdr.u32(),
    productBuild: hdr.u32(),
    hdr1UnPackSize: hdr.u32(),
  };
  if (info.fileVersion < 7 || info.fileVersion > 9) {
    throw new Error(`unsupported file version ${info.fileVersion}`);
  }
  const v8 = info.fileVersion >= 8;
  if (!v8) throw new Error('file version 7 not supported (not used by Ballance)');

  // ---- header part 1: object table (+deps, +included files) ----
  let hdr1 = bytes.subarray(HEADER_SIZE, HEADER_SIZE + info.hdr1PackSize);
  if (info.hdr1PackSize !== info.hdr1UnPackSize) {
    hdr1 = inflate(hdr1, info.hdr1UnPackSize);
  }
  const h = new ByteReader(hdr1);
  const table: TableEntry[] = new Array(info.objectCount);
  for (let i = 0; i < info.objectCount; i++) {
    const objectId = h.u32();
    const classId = h.u32();
    const fileIndex = h.u32();
    const nameLen = h.u32();
    const name = nameLen ? cp1252.decode(h.raw(nameLen)) : '';
    table[i] = { objectId, classId, fileIndex, name };
  }
  // plugin dep list
  const depCount = h.u32();
  for (let i = 0; i < depCount; i++) {
    h.skip(4); // category
    const guids = h.u32();
    h.skip(8 * guids);
  }
  // included files section: an int byte-length, containing a count dword
  const inclByteLen = h.i32();
  if (inclByteLen > 0) h.skip(inclByteLen);

  // ---- data part ----
  let data = bytes.subarray(HEADER_SIZE + info.hdr1PackSize);
  const compressed =
    (info.fileWriteMode & FileWriteMode.WholeCompressed) !== 0 ||
    (info.fileWriteMode & FileWriteMode.ChunkCompressedOld) !== 0;
  if (compressed) {
    data = inflate(data.subarray(0, info.dataPackSize), info.dataUnPackSize);
  }
  const d = new ByteReader(data);

  // Manager state precedes the object chunks. Retaining it is necessary for
  // manager-backed parameters such as CKMessageType: those values are saved as
  // (manager GUID, integer), while the message-name registry itself lives in
  // base.cmo's message-manager chunk.
  const managers: ManagerDataRec[] = [];
  for (let i = 0; i < info.managerCount; i++) {
    const guid: [number, number] = [d.u32(), d.u32()];
    const len = d.u32();
    managers.push({ guid, chunk: len > 0 ? StateChunk.fromBuffer(d.raw(len)) : null });
  }
  const messageTypes = decodeMessageTypes(managers);

  // object chunks
  const chunks: (StateChunk | null)[] = new Array(info.objectCount).fill(null);
  for (let i = 0; i < info.objectCount; i++) {
    const packSize = d.u32();
    if (packSize === 0) continue;
    chunks[i] = StateChunk.fromBuffer(d.raw(packSize));
  }

  // ---- build records ----
  const objects: CKRecord[] = new Array(info.objectCount);
  for (let i = 0; i < info.objectCount; i++) {
    const t = table[i];
    objects[i] = loadObjectRecord(i, t.objectId, t.classId, t.name, chunks[i]);
  }

  const groups = objects.filter((o): o is GroupRec => o.kind === 'group');
  const entities = objects.filter(
    (o): o is Entity3dLikeRec => o.kind === 'entity' || o.kind === 'sprite3d',
  );
  const byName = new Map<string, CKRecord[]>();
  for (const o of objects) {
    if (!o.name) continue;
    let arr = byName.get(o.name);
    if (!arr) byName.set(o.name, (arr = []));
    arr.push(o);
  }

  return { info, managers, messageTypes, objects, chunks, groups, entities, byName };
}

export { CKClassId };
