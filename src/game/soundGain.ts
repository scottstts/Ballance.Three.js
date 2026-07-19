/**
 * TT_Toolbox_RT.dll's TT_LinearVolume conversion. The original feeds its
 * normalized 0..1 music option and collision-speed ratios through this curve
 * before writing CKWaveSound's linear gain.
 */
export function linearVolume(normalized: number): number {
  if (normalized > 1) return 1;
  if (normalized <= 0.01) return 0;
  return 0.02 * Math.pow(50, normalized);
}

