import type { AnimationFrame, FootLock, IkBinding, NodeFrameState, RigNode, Vec2 } from '../types/project';

type Nodes = Record<string, RigNode>;
type Matrix = { a: number; b: number; c: number; d: number; x: number; y: number };
const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };
const tau = Math.PI * 2;
const radians = Math.PI / 180;
const epsilon = 1e-7;
const length = ({ x, y }: Vec2) => Math.hypot(x, y);
const angle = ({ x, y }: Vec2) => Math.atan2(y, x);
const wrap = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
const rotate = ({ x, y }: Vec2, theta: number): Vec2 => ({
  x: x * Math.cos(theta) - y * Math.sin(theta), y: x * Math.sin(theta) + y * Math.cos(theta),
});
const multiply = (point: Vec2, scale: Vec2): Vec2 => ({ x: point.x * scale.x, y: point.y * scale.y });

function pose(frame: AnimationFrame, node: RigNode): NodeFrameState {
  return frame.nodeStates[node.id] ?? {
    ...node.transform, visible: node.visible, imageIndex: node.defaultImageIndex ?? 0, sortingOrder: node.sortingOrder ?? 0,
  };
}

function worldMatrix(nodes: Nodes, frame: AnimationFrame, id: string | null): Matrix {
  const node = id ? nodes[id] : undefined;
  if (!node) return identity;
  const parent = worldMatrix(nodes, frame, node.parentId);
  const local = pose(frame, node);
  const { x: c, y: s } = rotate({ x: 1, y: 0 }, local.rotation * radians);
  return {
    a: (parent.a * c + parent.c * s) * local.scale.x,
    b: (parent.b * c + parent.d * s) * local.scale.x,
    c: (parent.c * c - parent.a * s) * local.scale.y,
    d: (parent.d * c - parent.b * s) * local.scale.y,
    x: parent.a * local.position.x + parent.c * local.position.y + parent.x,
    y: parent.b * local.position.x + parent.d * local.position.y + parent.y,
  };
}

function inverseVector(parent: Matrix, vector: Vec2): Vec2 | null {
  const det = parent.a * parent.d - parent.b * parent.c;
  if (Math.abs(det) < epsilon) return null;
  return { x: (parent.d * vector.x - parent.c * vector.y) / det, y: (parent.a * vector.y - parent.b * vector.x) / det };
}

export function ikHierarchy(nodes: Nodes, endId: string) {
  const end = nodes[endId];
  const lower = end?.parentId ? nodes[end.parentId] : undefined;
  const upper = lower?.parentId ? nodes[lower.parentId] : undefined;
  return upper && lower ? { end, lower, upper } : null;
}

export function normalizedIkBinding(value: unknown): IkBinding | undefined {
  const binding = value as Partial<IkBinding> | null;
  if (binding && typeof binding.name === 'string' && binding.name.trim()
    && typeof binding.upperId === 'string' && typeof binding.lowerId === 'string') {
    return { name: binding.name.trim().slice(0, 48), upperId: binding.upperId, lowerId: binding.lowerId };
  }
}

export function ikChain(nodes: Nodes, endId: string) {
  const chain = ikHierarchy(nodes, endId);
  if (!chain || chain.upper.locked || chain.lower.locked || chain.end.locked) return null;
  const binding = chain.end.ikBinding;
  return !binding || (binding.upperId === chain.upper.id && binding.lowerId === chain.lower.id) ? chain : null;
}

export function captureFootLock(nodes: Nodes, frame: AnimationFrame, endId: string): FootLock | null {
  const chain = ikChain(nodes, endId);
  if (!chain || length(pose(frame, chain.lower).position) < epsilon || length(pose(frame, chain.end).position) < epsilon) return null;
  const matrix = worldMatrix(nodes, frame, endId);
  return { upperId: chain.upper.id, lowerId: chain.lower.id, point: { x: matrix.x, y: matrix.y }, axis: { x: matrix.a, y: matrix.b } };
}

export function nodePivotWorld(nodes: Nodes, frame: AnimationFrame, id: string): Vec2 {
  const { x, y } = worldMatrix(nodes, frame, id);
  return { x, y };
}

/** Signed distance from the root-to-tip line, in world units (handles mirrored rigs). */
export function bendDistance(root: Vec2, tip: Vec2, point: Vec2) {
  const dx = tip.x - root.x, dy = tip.y - root.y;
  const span = Math.hypot(dx, dy);
  if (span < epsilon) return 0;
  return (dx * (point.y - root.y) - dy * (point.x - root.x)) / span;
}

export function bendHandle(root: Vec2, joint: Vec2, tip: Vec2, zoom: number): Vec2 | null {
  const dx = tip.x - root.x, dy = tip.y - root.y;
  const span = Math.hypot(dx, dy);
  if (span < epsilon) return null;
  const distance = bendDistance(root, tip, joint);
  const offset = Math.sign(distance || 1) * Math.max(38 / zoom, Math.abs(distance) + 14 / zoom);
  return { x: (root.x + tip.x) / 2 - dy * offset / span, y: (root.y + tip.y) / 2 + dx * offset / span };
}

export function poseIkBend(nodes: Nodes, frame: AnimationFrame, endId: string, side: -1 | 1) {
  const chain = ikChain(nodes, endId);
  if (!chain) return frame;
  const target = activeFootLocks(nodes, frame).find(([id]) => id === endId)?.[1] ?? captureFootLock(nodes, frame, endId);
  if (!target) return frame;
  const root = nodePivotWorld(nodes, frame, chain.upper.id);
  const joint = nodePivotWorld(nodes, frame, chain.lower.id);
  if (bendDistance(root, target.point, joint) * side > epsilon) return frame;
  for (const reverse of [true, false]) {
    const solved = solveTwoBone(nodes, frame, endId, target.point, frame, reverse, target.axis);
    if (solved && solved.error <= .005
      && bendDistance(root, target.point, nodePivotWorld(nodes, solved.frame, chain.lower.id)) * side > epsilon) return solved.frame;
  }
  return frame;
}

/** Solve in upper-parent space. The end offset uses the end node's pivot, even for empty nodes. */
export function solveTwoBone(nodes: Nodes, frame: AnimationFrame, endId: string, target: Vec2, reference = frame, reverseBend = false, endAxis?: Vec2) {
  const chain = ikChain(nodes, endId);
  if (!chain) return null;
  const { upper, lower, end } = chain;
  const base = pose(frame, upper);
  const joint = pose(frame, lower);
  const tip = pose(frame, end);
  const parent = worldMatrix(nodes, frame, upper.parentId);
  const local = inverseVector(parent, { x: target.x - parent.x, y: target.y - parent.y });
  if (!local || !Number.isFinite(local.x) || !Number.isFinite(local.y)) return null;
  const goal = { x: local.x - base.position.x, y: local.y - base.position.y };
  const desired = length(goal);
  const second = multiply(tip.position, joint.scale);
  if (length(joint.position) < epsilon || length(second) < epsilon || Math.min(Math.abs(base.scale.x), Math.abs(base.scale.y)) < epsilon) return null;
  const straight = angle(joint.position) - angle(second);
  const referenceBend = wrap(pose(reference, lower).rotation * radians - straight);
  const side = (referenceBend < -epsilon ? -1 : 1) * (reverseBend ? -1 : 1);
  const tipVector = (bend: number) => {
    const rotated = rotate(second, straight + side * bend);
    return multiply({ x: joint.position.x + rotated.x, y: joint.position.y + rotated.y }, base.scale);
  };

  let bend: number;
  const firstLength = length(joint.position);
  const secondLength = length(second);
  if (Math.abs(Math.abs(base.scale.x) - Math.abs(base.scale.y)) < epsilon) {
    const radius = desired / Math.abs(base.scale.x);
    const cosine = (radius * radius - firstLength ** 2 - secondLength ** 2) / (2 * firstLength * secondLength);
    bend = Math.acos(Math.max(-1, Math.min(1, cosine)));
  } else {
    // Unequal upper scale distorts the reach curve. Search only the chosen bend half-plane.
    bend = solveScaledBend((value) => length(tipVector(value)) - desired, Math.abs(referenceBend));
  }
  const vector = tipVector(bend);
  const baseAngle = base.rotation * radians;
  const jointAngle = joint.rotation * radians;
  const nextBase = desired > epsilon && length(vector) > epsilon
    ? baseAngle + wrap(angle(goal) - angle(vector) - baseAngle) : baseAngle;
  const nextJoint = jointAngle + wrap(straight + side * bend - jointAngle);
  const solved = { ...frame, nodeStates: { ...frame.nodeStates,
    [upper.id]: { ...base, rotation: nextBase / radians },
    [lower.id]: { ...joint, rotation: nextJoint / radians },
  } };
  if (endAxis) {
    const axis = inverseVector(worldMatrix(nodes, solved, lower.id), endAxis);
    if (axis && length(axis) > epsilon && Math.abs(tip.scale.x) > epsilon) {
      const rotation = angle(axis) - (tip.scale.x < 0 ? Math.PI : 0);
      solved.nodeStates[end.id] = { ...tip, rotation: tip.rotation + wrap(rotation - tip.rotation * radians) / radians };
    }
  }
  const actual = nodePivotWorld(nodes, solved, endId);
  return { frame: solved, actual, error: Math.hypot(actual.x - target.x, actual.y - target.y) };
}

function solveScaledBend(error: (bend: number) => number, preferred: number) {
  const samples = 48;
  const interval = tau / (2 * samples);
  let closest = 0;
  let minError = Math.abs(error(0));
  const roots: number[] = [];
  let previous = error(0);
  for (let i = 1; i <= samples; i++) {
    const value = i * interval;
    const next = error(value);
    if (Math.abs(next) < minError) { closest = value; minError = Math.abs(next); }
    if (previous * next <= 0) {
      let low = value - interval, high = value;
      for (let j = 0; j < 25; j++) {
        const mid = (low + high) / 2;
        if (error(low) * error(mid) <= 0) high = mid; else low = mid;
      }
      roots.push((low + high) / 2);
    }
    previous = next;
  }
  if (roots.length) return roots.reduce((best, value) => Math.abs(value - preferred) < Math.abs(best - preferred) ? value : best);
  let low = Math.max(0, closest - interval), high = Math.min(Math.PI, closest + interval);
  for (let i = 0; i < 28; i++) {
    const a = (2 * low + high) / 3, b = (low + 2 * high) / 3;
    if (Math.abs(error(a)) < Math.abs(error(b))) high = b; else low = a;
  }
  return (low + high) / 2;
}

export function isAncestor(nodes: Nodes, ancestor: string, descendant: string) {
  let current: string | null = descendant;
  while (current) {
    if (current === ancestor) return true;
    current = nodes[current]?.parentId ?? null;
  }
  return false;
}

export function validFootLocks(locks: AnimationFrame['footLocks']) {
  return Object.entries(locks ?? {}).filter(([, lock]) => Boolean(lock
    && typeof lock.upperId === 'string' && typeof lock.lowerId === 'string'
    && Number.isFinite(lock.point?.x) && Number.isFinite(lock.point?.y)
    && Number.isFinite(lock.axis?.x) && Number.isFinite(lock.axis?.y)));
}

export function activeFootLocks(nodes: Nodes, frame: AnimationFrame) {
  return validFootLocks(frame.footLocks).filter(([endId, lock]) => {
    const chain = ikChain(nodes, endId);
    return chain && chain.upper.id === lock.upperId && chain.lower.id === lock.lowerId;
  });
}

/** Apply a parent move only as far as all of its planted feet can follow. */
export function moveWithFootLocks(nodes: Nodes, original: AnimationFrame, frame: AnimationFrame, nodeId: string, position: Vec2) {
  const locks = activeFootLocks(nodes, original).filter(([id]) => id !== nodeId && isAncestor(nodes, nodeId, id));
  const node = nodes[nodeId];
  const start = pose(original, node).position;
  const base = pose(frame, node);
  if (!locks.length) return { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: { ...base, position } } };
  const startStates = { ...frame.nodeStates };
  for (const [endId, lock] of locks) {
    for (const id of [endId, lock.upperId, lock.lowerId]) {
      const initial = pose(original, nodes[id]);
      const current = pose(frame, nodes[id]);
      startStates[id] = { ...current, rotation: initial.rotation };
    }
  }
  const attempt = (amount: number) => {
    let updated: AnimationFrame = { ...frame, nodeStates: { ...startStates,
      [nodeId]: { ...base, position: { x: start.x + (position.x - start.x) * amount, y: start.y + (position.y - start.y) * amount } },
    } };
    for (const [endId, lock] of locks) {
      const solved = solveTwoBone(nodes, updated, endId, lock.point, original, false, lock.axis);
      if (!solved || solved.error > .005) return null;
      updated = solved.frame;
    }
    return updated;
  };
  const proposed = attempt(1);
  if (proposed) return proposed;
  let best = attempt(0);
  if (!best) return frame;
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    const candidate = attempt(mid);
    if (candidate) { best = candidate; low = mid; } else high = mid;
  }
  return best;
}
