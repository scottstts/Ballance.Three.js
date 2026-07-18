export type CurveKey = [time: number, value: number, slope: number];

/** Cubic Hermite through [time, value, slope] keys. */
export function evalCurve(keys: CurveKey[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0, s0] = keys[i];
  const [t1, v1, s1] = keys[i + 1];
  const dt = t1 - t0;
  const u = (t - t0) / dt;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * v0 +
    (u3 - 2 * u2 + u) * dt * s0 +
    (-2 * u3 + 3 * u2) * v1 +
    (u3 - u2) * dt * s1
  );
}

/**
 * Decode Virtools 2.1's packed CK2dCurve parameter value.
 *
 * Ballance stores these complex version-0 parameter values as a packed
 * CKStateChunk. Its curve payload has a small header followed by 12-dword
 * control-point records: flags, position, T/C/B, cached data, then a tangent
 * vector. CK2 evaluates the points as cubic Hermite segments; dy/dx of the
 * final tangent pair is the authored slope used by GetY().
 */
export function decodeCk2dCurve(bytes: Uint8Array): CurveKey[] {
  if (bytes.byteLength < 20 * 4 || bytes.byteLength % 4 !== 0) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dwordCount = bytes.byteLength / 4;
  const pointCount = view.getUint32(19 * 4, true);
  if (pointCount === 0 || pointCount > 1024) return [];

  let firstPoint = -1;
  for (let index = 20; index < dwordCount; index++) {
    if ((view.getUint32(index * 4, true) & 0xf0000000) === 0x10000000) {
      firstPoint = index;
      break;
    }
  }
  if (firstPoint < 0 || firstPoint + pointCount * 12 > dwordCount) return [];

  const keys: CurveKey[] = [];
  for (let point = 0; point < pointCount; point++) {
    const base = firstPoint + point * 12;
    const time = view.getFloat32((base + 1) * 4, true);
    const value = view.getFloat32((base + 2) * 4, true);
    const tangentX = view.getFloat32((base + 10) * 4, true);
    const tangentY = view.getFloat32((base + 11) * 4, true);
    const slope = Math.abs(tangentX) > 1e-8 ? tangentY / tangentX : 0;
    if (![time, value, slope].every(Number.isFinite)) return [];
    keys.push([time, value, slope]);
  }
  return keys;
}
