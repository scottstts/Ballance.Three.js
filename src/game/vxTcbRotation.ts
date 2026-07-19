/**
 * Virtools 2.1 TCB quaternion controller.
 *
 * This follows the shipped CK2_3D.dll controller and VxMath.dll quaternion
 * routines, including non-uniform key-time adjustment, per-segment ease, the
 * 0.01 Slerp linearization threshold, and distinct incoming/outgoing controls.
 */
import * as THREE from 'three';
import type { RotationKey } from '../formats/ck2/types.ts';

export interface VxTcbControl {
  incoming: THREE.Quaternion;
  outgoing: THREE.Quaternion;
}

const VX_SLERP_LINEAR_THRESHOLD = 0.01;
const VX_EXP_EPSILON = 1.1920928955078125e-7;

function keyQuaternion(key: RotationKey): THREE.Quaternion {
  return new THREE.Quaternion(...key.quaternion);
}

function negate(quaternion: THREE.Quaternion): THREE.Quaternion {
  quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w);
  return quaternion;
}

function vxLn(quaternion: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z);
  const factor = length > 0 ? Math.atan2(length, quaternion.w) / length : 0;
  return out.set(quaternion.x * factor, quaternion.y * factor, quaternion.z * factor, 0);
}

function vxLnDif(a: THREE.Quaternion, b: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  // Vx3DQuaternionDivide(b, a) is conjugate(a) * b for the unit animation keys.
  const difference = a.clone().conjugate().multiply(b);
  return vxLn(difference, out);
}

function vxExp(quaternion: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z);
  const factor = length > VX_EXP_EPSILON ? Math.sin(length) / length : 1;
  return out.set(
    quaternion.x * factor,
    quaternion.y * factor,
    quaternion.z * factor,
    Math.cos(length),
  );
}

function weightedQuaternionSum(
  a: THREE.Quaternion,
  aWeight: number,
  b: THREE.Quaternion,
  bWeight: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  return out.set(
    (a.x * aWeight + b.x * bWeight) * 0.5,
    (a.y * aWeight + b.y * bWeight) * 0.5,
    (a.z * aWeight + b.z * bWeight) * 0.5,
    (a.w * aWeight + b.w * bWeight) * 0.5,
  );
}

/** Build the two Squad controls stored by CK2_3D for every TCB key. */
export function buildVxTcbControls(keys: readonly RotationKey[]): VxTcbControl[] {
  return keys.map((key, index) => {
    const current = keyQuaternion(key);
    const previous = index > 0 ? keyQuaternion(keys[index - 1]) : null;
    const next = index + 1 < keys.length ? keyQuaternion(keys[index + 1]) : null;
    if (previous && previous.dot(current) < 0) negate(previous);
    if (next && next.dot(current) < 0) negate(next);

    const previousLog = new THREE.Quaternion();
    const nextLog = new THREE.Quaternion();
    if (previous) vxLnDif(previous, current, previousLog);
    if (next) vxLnDif(current, next, nextLog);
    if (!previous) previousLog.copy(nextLog);
    if (!next) nextLog.copy(previousLog);

    let previousTimeScale = 1;
    let nextTimeScale = 1;
    if (previous && next) {
      const timeScale = 2 / (keys[index + 1].time - keys[index - 1].time);
      previousTimeScale = (key.time - keys[index - 1].time) * timeScale;
      nextTimeScale = (keys[index + 1].time - key.time) * timeScale;
      const absoluteContinuity = Math.abs(key.continuity);
      previousTimeScale =
        previousTimeScale + absoluteContinuity - absoluteContinuity * previousTimeScale;
      nextTimeScale = nextTimeScale + absoluteContinuity - absoluteContinuity * nextTimeScale;
    }

    const halfTension = (1 - key.tension) * 0.5;
    const oneMinusContinuity = 1 - key.continuity;
    const onePlusContinuity = 1 + key.continuity;
    const oneMinusBias = 1 - key.bias;
    const onePlusBias = 1 + key.bias;

    const incomingPrevious =
      1 - halfTension * oneMinusContinuity * onePlusBias * previousTimeScale;
    const incomingNext =
      -halfTension * onePlusContinuity * oneMinusBias * previousTimeScale;
    const outgoingPrevious =
      halfTension * onePlusContinuity * onePlusBias * nextTimeScale;
    const outgoingNext =
      halfTension * oneMinusContinuity * oneMinusBias * nextTimeScale - 1;

    const incomingLog = weightedQuaternionSum(
      previousLog,
      incomingPrevious,
      nextLog,
      incomingNext,
      new THREE.Quaternion(),
    );
    const outgoingLog = weightedQuaternionSum(
      previousLog,
      outgoingPrevious,
      nextLog,
      outgoingNext,
      new THREE.Quaternion(),
    );
    return {
      incoming: current.clone().multiply(vxExp(incomingLog, new THREE.Quaternion())),
      outgoing: current.clone().multiply(vxExp(outgoingLog, new THREE.Quaternion())),
    };
  });
}

/** CK2_3D's shared ease helper, fed previous.EaseFrom and next.EaseTo. */
export function vxTcbEase(time: number, easeFrom: number, easeTo: number): number {
  if (time === 0 || time === 1) return time;
  let from = easeFrom;
  let to = easeTo;
  const sum = from + to;
  if (sum === 0) return time;
  if (sum > 1) {
    from /= sum;
    to /= sum;
  }
  const scale = 1 / (2 - from - to);
  if (time < from) return (scale / from) * time * time;
  if (time >= 1 - to) return 1 - (scale / to) * (1 - time) * (1 - time);
  return (2 * time - from) * scale;
}

/** VxMath.dll Slerp, including its short-arc and near-linear branches. */
export function vxSlerp(
  a: THREE.Quaternion,
  b: THREE.Quaternion,
  time: number,
  out = new THREE.Quaternion(),
): THREE.Quaternion {
  const dot = a.dot(b);
  const absoluteDot = Math.abs(dot);
  let aWeight: number;
  let bWeight: number;
  if (1 - absoluteDot <= VX_SLERP_LINEAR_THRESHOLD) {
    aWeight = 1 - time;
    bWeight = dot < 0 ? -time : time;
  } else {
    const angle = Math.acos(absoluteDot);
    const inverseSin = 1 / Math.sin(angle);
    aWeight = Math.sin((1 - time) * angle) * inverseSin;
    bWeight = Math.sin(time * angle) * inverseSin * (dot < 0 ? -1 : 1);
  }
  return out.set(
    a.x * aWeight + b.x * bWeight,
    a.y * aWeight + b.y * bWeight,
    a.z * aWeight + b.z * bWeight,
    a.w * aWeight + b.w * bWeight,
  );
}

function vxSquad(
  start: THREE.Quaternion,
  outgoing: THREE.Quaternion,
  incoming: THREE.Quaternion,
  end: THREE.Quaternion,
  time: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const controls = vxSlerp(outgoing, incoming, time);
  const endpoints = vxSlerp(start, end, time);
  return vxSlerp(endpoints, controls, 2 * time * (1 - time), out);
}

function interval(keys: readonly RotationKey[], time: number): number {
  let low = 0;
  let high = keys.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (time <= keys[middle].time) high = middle;
    else low = middle;
  }
  return high;
}

/** Evaluate a shipped TCB rotation and convert Virtools handedness to Three. */
export function evaluateVxTcbRotation(
  keys: readonly RotationKey[],
  controls: readonly VxTcbControl[],
  time: number,
  out = new THREE.Quaternion(),
): THREE.Quaternion {
  if (keys.length === 0) return out.identity();
  let source: THREE.Quaternion;
  if (time <= keys[0].time) {
    source = keyQuaternion(keys[0]);
  } else if (time >= keys.at(-1)!.time) {
    source = keyQuaternion(keys.at(-1)!);
  } else {
    const nextIndex = interval(keys, time);
    const previousIndex = nextIndex - 1;
    const previous = keys[previousIndex];
    const next = keys[nextIndex];
    const phase = (time - previous.time) / (next.time - previous.time);
    const eased = vxTcbEase(phase, previous.easeFrom, next.easeTo);
    source = vxSquad(
      keyQuaternion(previous),
      controls[previousIndex].outgoing,
      controls[nextIndex].incoming,
      keyQuaternion(next),
      eased,
      new THREE.Quaternion(),
    );
  }
  // S*R*S for the Z reflection maps the quaternion axial vector to (-x,-y,z).
  return out.set(-source.x, -source.y, source.z, source.w).normalize();
}
