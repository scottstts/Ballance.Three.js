/**
 * CKStateChunk reader: every CK object's serialized state is a dword array
 * containing a linked list of (identifier, nextPos) pairs with payload between.
 * All reads are dword-granular; byte payloads are padded to 4-byte boundaries.
 */

const cp1252 = new TextDecoder('windows-1252');

export class StateChunk {
  readonly dataVersion: number;
  readonly classId: number;
  readonly chunkVersion: number;
  readonly options: number;
  /** chunk payload as dword array */
  readonly data: Uint32Array;
  private pos = 0;

  constructor(dataVersion: number, classId: number, chunkVersion: number, options: number, data: Uint32Array) {
    this.dataVersion = dataVersion;
    this.classId = classId;
    this.chunkVersion = chunkVersion;
    this.options = options;
    this.data = data;
  }

  /**
   * Parse a packed chunk from bytes. Layout (chunk version >= 6):
   * byte0 dataVersion, byte1 classId, byte2 chunkVersion, byte3 options,
   * dword[1] dataDwSize, data at dword[2..], then optional id/chn/man lists.
   */
  static fromBuffer(bytes: Uint8Array): StateChunk | null {
    if (bytes.length < 8) return null;
    const dataVersion = bytes[0];
    const chunkVersion = bytes[2];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (chunkVersion < 4) return null; // pre-CK1.1, not present in Ballance data
    if (chunkVersion <= 5) {
      // medium format: dword[1]=classId, dword[2]=dataDwSize, lists at 4/5(/6)
      const classId = view.getUint32(4, true);
      const dataDwSize = view.getUint32(8, true);
      const base = chunkVersion === 5 ? 7 : 6;
      const data = new Uint32Array(dataDwSize);
      for (let i = 0; i < dataDwSize; i++) data[i] = view.getUint32((base + i) * 4, true);
      return new StateChunk(dataVersion, classId, chunkVersion, 0, data);
    }
    if (chunkVersion > 7) return null;

    const classId = bytes[1];
    const options = bytes[3];
    const dataDwSize = view.getUint32(4, true);
    if (8 + dataDwSize * 4 > bytes.length) return null;
    // copy so the chunk owns aligned data independent of the file buffer
    const data = new Uint32Array(dataDwSize);
    for (let i = 0; i < dataDwSize; i++) data[i] = view.getUint32(8 + i * 4, true);
    return new StateChunk(dataVersion, classId, chunkVersion, options, data);
  }

  /** Walk the identifier linked list from the head; position cursor after it. */
  seekIdentifier(identifier: number): number {
    const d = this.data;
    if (d.length < 2) return -1;
    let pos = 0;
    while (d[pos] !== identifier) {
      pos = d[pos + 1];
      if (pos === 0) return -1;
      if (pos + 1 >= d.length) return -1;
    }
    this.pos = pos + 2;
    let next = d[pos + 1];
    if (next === 0) next = d.length;
    return (next - pos - 2) * 4; // payload size in bytes
  }

  get cursor(): number {
    return this.pos;
  }

  skipDwords(n: number): void {
    this.pos += n;
  }

  u32(): number {
    return this.data[this.pos++] >>> 0;
  }

  i32(): number {
    return this.data[this.pos++] | 0;
  }

  f32(): number {
    f32buf_u[0] = this.data[this.pos++];
    return f32buf_f[0];
  }

  /** Read n bytes (advances by ceil(n/4) dwords). */
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    const dwords = Math.ceil(n / 4);
    const src = this.data.subarray(this.pos, this.pos + dwords);
    const srcBytes = new Uint8Array(src.buffer, src.byteOffset, dwords * 4);
    out.set(srcBytes.subarray(0, n));
    this.pos += dwords;
    return out;
  }

  /** Length-prefixed string (byte length includes NUL), cp1252. */
  string(): string {
    const byteLen = this.u32();
    if (byteLen === 0) return '';
    const raw = this.bytes(byteLen);
    return cp1252.decode(raw.subarray(0, byteLen - 1));
  }

  /** Length-prefixed byte buffer. */
  buffer(): Uint8Array {
    const byteLen = this.u32();
    if (byteLen === 0) return new Uint8Array(0);
    return this.bytes(byteLen);
  }

  /**
   * Object reference: for file-bound chunks (version >= 4) the stored value is
   * an index into the file object table; negative means null.
   */
  objectRef(): number {
    const v = this.i32();
    return v >= 0 ? v : -1;
  }

  /** XObjectArray: count then per-item file index (negative = null). */
  objectRefArray(): number[] {
    const count = this.u32();
    const out: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const v = this.i32();
      out[i] = v >= 0 ? v : -1;
    }
    return out;
  }
}

const f32buf = new ArrayBuffer(4);
const f32buf_u = new Uint32Array(f32buf);
const f32buf_f = new Float32Array(f32buf);
