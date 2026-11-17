import type { Vec2 } from '../types/project';

export interface RotationParentMatrix { a: number; b: number; c: number; d: number; e: number; f: number }

/**
 * Node rotation turns the already-scaled shape (R * S), so its own H/V flips
 * do not reverse the gesture. Undo the full parent transform instead: this handles
 * reflected, non-uniformly scaled and sheared ancestors without sign guesses.
 */
export function rotationDragDelta(parent: RotationParentMatrix, position: Vec2, start: Vec2, current: Vec2): number | null {
  const determinant = parent.a * parent.d - parent.b * parent.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < .00001) return null;
  const local = (point: Vec2) => {
    const x = point.x - parent.e, y = point.y - parent.f;
    return { x: (parent.d * x - parent.c * y) / determinant - position.x,
      y: (-parent.b * x + parent.a * y) / determinant - position.y };
  };
  const from = local(start), to = local(current);
  if (!Number.isFinite(from.x + from.y + to.x + to.y) || Math.hypot(from.x, from.y) < .00001 || Math.hypot(to.x, to.y) < .00001) return null;
  const delta = Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x);
  // Use the short step across atan2's ±180° boundary. The caller accumulates
  // successive pointer steps, allowing continuous turns through any angle.
  return Math.atan2(Math.sin(delta), Math.cos(delta)) * 180 / Math.PI;
}
