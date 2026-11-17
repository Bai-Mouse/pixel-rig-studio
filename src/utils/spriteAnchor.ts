import type { SpriteAsset, SpriteSlice, Vec2 } from '../types/project';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Snaps a requested anchor into the sprite's pixel bounds. */
export function clampAnchor(anchor: Vec2, width: number, height: number): Vec2 {
  return {
    x: clamp(anchor.x, 0, Math.max(0, width)),
    y: clamp(anchor.y, 0, Math.max(0, height)),
  };
}

/**
 * The sprite-space point drawn on the node origin.
 * Sprites without a custom anchor keep using the shared node pivot.
 */
export function effectiveSpriteAnchor(asset: Pick<SpriteAsset, 'anchor' | 'width' | 'height'> | null | undefined, nodePivot: Vec2): Vec2 {
  if (asset?.anchor && Number.isFinite(asset.anchor.x) && Number.isFinite(asset.anchor.y)) {
    return clampAnchor(asset.anchor, asset.width, asset.height);
  }
  return { x: nodePivot.x, y: nodePivot.y };
}

/**
 * Moves an anchor from the old crop rectangle to the new one so it keeps pointing at
 * the same source pixel. An anchor that falls outside the new crop is clamped to its edge.
 */
export function remapAnchorForCrop(anchor: Vec2, previous: SpriteSlice, next: SpriteSlice): Vec2 {
  return clampAnchor({
    x: Math.round(anchor.x + previous.x - next.x),
    y: Math.round(anchor.y + previous.y - next.y),
  }, next.width, next.height);
}

/** The geometric centre of a sprite, expressed in sprite pixels. */
export function centerAnchor(width: number, height: number): Vec2 {
  return { x: Math.round(width / 2), y: Math.round(height / 2) };
}
