export type SourceMenuInitialSelection = 'first' | 'last' | number;

export function sourceMenuInitialIndex(
  disabled: readonly boolean[],
  selection: SourceMenuInitialSelection,
): number {
  if (disabled.length === 0) return -1;
  if (typeof selection === 'number' && !disabled[selection]) return selection;
  const direction = selection === 'last' ? -1 : 1;
  const start = direction > 0 ? 0 : disabled.length - 1;
  for (let index = start; index >= 0 && index < disabled.length; index += direction) {
    if (!disabled[index]) return index;
  }
  return -1;
}

export function nextSourceMenuIndex(
  disabled: readonly boolean[],
  current: number,
  direction: -1 | 1,
): number {
  if (disabled.length === 0 || disabled.every(Boolean)) return -1;
  let index = current >= 0 && current < disabled.length ? current : direction > 0 ? -1 : 0;
  for (let attempt = 0; attempt < disabled.length; attempt++) {
    index = (index + direction + disabled.length) % disabled.length;
    if (!disabled[index]) return index;
  }
  return -1;
}
