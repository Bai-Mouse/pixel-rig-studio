import type { SpriteSlice, Vec2 } from '../types/project';

export type SliceHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const sliceHandles: SliceHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export function clampSlice(slice: SpriteSlice, sourceWidth: number, sourceHeight: number): SpriteSlice {
  const pixel = (value: number, fallback: number) => Number.isFinite(value) ? Math.round(value) : fallback;
  const width = Math.max(1, Math.min(sourceWidth, pixel(slice.width, 1)));
  const height = Math.max(1, Math.min(sourceHeight, pixel(slice.height, 1)));
  const x = Math.max(0, Math.min(sourceWidth - width, pixel(slice.x, 0)));
  const y = Math.max(0, Math.min(sourceHeight - height, pixel(slice.y, 0)));
  const unchanged = x === slice.x && y === slice.y && width === slice.width && height === slice.height;
  return { x, y, width, height, ...(unchanged && slice.mask ? { mask: slice.mask } : {}) };
}
export function resizeSlice(slice: SpriteSlice, handle: SliceHandle, delta: Vec2, width: number, height: number): SpriteSlice {
  let left = slice.x, top = slice.y, right = slice.x + slice.width, bottom = slice.y + slice.height;
  if (handle.includes('w')) left = Math.max(0, Math.min(right - 1, left + delta.x));
  if (handle.includes('e')) right = Math.min(width, Math.max(left + 1, right + delta.x));
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - 1, top + delta.y));
  if (handle.includes('s')) bottom = Math.min(height, Math.max(top + 1, bottom + delta.y));
  return clampSlice({ x: left, y: top, width: right - left, height: bottom - top }, width, height);
}
export function anchoredSlice(slice: SpriteSlice, patch: Partial<SpriteSlice>, anchor: Vec2, width: number, height: number): SpriteSlice {
  const point = { x: slice.x + slice.width * anchor.x, y: slice.y + slice.height * anchor.y };
  const nextWidth = patch.width ?? slice.width, nextHeight = patch.height ?? slice.height;
  return clampSlice({ x: (patch.x ?? point.x) - nextWidth * anchor.x, y: (patch.y ?? point.y) - nextHeight * anchor.y, width: nextWidth, height: nextHeight }, width, height);
}
