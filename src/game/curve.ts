/** cubic Hermite through [t, value, slope] keys (Unity AnimationCurve semantics) */
export function evalCurve(keys: [number, number, number][], t: number): number {
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
