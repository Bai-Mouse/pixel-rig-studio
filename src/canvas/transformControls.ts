import type { TransformTool, Vec2 } from '../types/project';

export const transformShortcuts: Record<TransformTool, string> = {
  select: 'V', move: 'W', rotate: 'R', scale: 'S', pivot: 'P', ik: 'I',
};

export function transformToolForKey({ key, code }: Pick<KeyboardEvent, 'key' | 'code'>) {
  const letter = /^[a-z]$/i.test(key) ? key.toUpperCase() : code.match(/^Key([A-Z])$/)?.[1];
  return (Object.keys(transformShortcuts) as TransformTool[]).find((tool) => transformShortcuts[tool] === letter);
}

export const transformHandleRadius = 9;

export function hitTransformHandle(point: Vec2, center: Vec2 | null, zoom: number) {
  return Boolean(center && Math.hypot(point.x - center.x, point.y - center.y) * zoom <= transformHandleRadius);
}

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type GizmoTool = 'move' | 'rotate' | 'ik';
export type GizmoPart = 'x' | 'y' | 'plane' | 'ring' | 'center';
const axisLength = 48;
const planeMin = 10;
const planeMax = 22;
const ringRadius = (tool: GizmoTool) => tool === 'ik' ? 24 : 32;

export function hitGizmo(tool: GizmoTool, point: Vec2, center: Vec2, zoom: number): GizmoPart | null {
  const x = (point.x - center.x) * zoom;
  const y = -(point.y - center.y) * zoom;
  const radius = Math.hypot(x, y);
  if (tool !== 'move') {
    if (tool === 'ik' && radius <= 9) return 'center';
    return Math.abs(radius - ringRadius(tool)) <= 5 ? 'ring' : null;
  }
  if (x >= planeMin - 1 && x <= planeMax + 2 && y >= planeMin - 1 && y <= planeMax + 2) return 'plane';
  if (radius <= 6) return 'plane';
  if (x >= 4 && x <= axisLength + 3 && Math.abs(y) <= 6) return 'x';
  if (y >= 4 && y <= axisLength + 3 && Math.abs(x) <= 6) return 'y';
  return null;
}

export function moveGizmoPosition(parent: Matrix, origin: Vec2, delta: Vec2, axis: GizmoPart, increment: number): Vec2 | null {
  const det = parent.a * parent.d - parent.b * parent.c;
  if (Math.abs(det) < 1e-5) return null;
  const snap = (value: number) => increment > 0 ? Math.round(value / increment) * increment : value;
  const x = axis === 'y' ? 0 : snap(delta.x);
  const y = axis === 'x' ? 0 : snap(delta.y);
  return { x: origin.x + (parent.d * x - parent.c * y) / det, y: origin.y + (parent.a * y - parent.b * x) / det };
}

export function drawGizmo(context: CanvasRenderingContext2D, tool: GizmoTool, center: Vec2, zoom: number, facing: Vec2, active: GizmoPart | null) {
  context.save();
  context.translate(center.x, center.y);
  context.scale(1 / zoom, 1 / zoom);
  context.lineWidth = 2;
  const accent = '#ffeb90';
  if (tool === 'move') {
    const arrow = (x: number, y: number, color: string) => {
      context.strokeStyle = context.fillStyle = color;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(x * (axisLength - 8), y * (axisLength - 8));
      context.stroke();
      context.beginPath();
      context.moveTo(x * axisLength, y * axisLength);
      context.lineTo(x * (axisLength - 9) + y * 5, y * (axisLength - 9) - x * 5);
      context.lineTo(x * (axisLength - 9) - y * 5, y * (axisLength - 9) + x * 5);
      context.closePath();
      context.fill();
      context.font = 'bold 10px system-ui';
      context.fillText(x ? 'X' : 'Y', x * (axisLength + 4) - (x ? 0 : 3), y * (axisLength + 6) + (x ? 3 : 0));
    };
    arrow(1, 0, active === 'x' ? accent : '#ff6969');
    arrow(0, -1, active === 'y' ? accent : '#86e27a');
    const span = planeMax - planeMin;
    context.fillStyle = active === 'plane' ? '#ffeb90' : '#ffcd7260';
    context.strokeStyle = '#ffe0a2';
    context.fillRect(planeMin, -planeMax, span, span);
    context.strokeRect(planeMin, -planeMax, span, span);
    context.beginPath();
    context.arc(0, 0, 3, 0, Math.PI * 2);
    context.fillStyle = '#fff0bd';
    context.fill();
  } else {
    const radius = ringRadius(tool);
    const color = tool === 'ik' ? '#7ae1bf' : '#8eb9ff';
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    if (tool === 'rotate') {
      const fill = context.createRadialGradient(-8, -8, 3, 0, 0, radius);
      fill.addColorStop(0, '#9dc4ff26');
      fill.addColorStop(1, '#5171ae0c');
      context.fillStyle = fill;
      context.fill();
    }
    context.strokeStyle = active === 'ring' ? accent : color;
    context.stroke();
    const angle = Math.atan2(facing.y, facing.x);
    context.beginPath();
    context.moveTo(Math.cos(angle) * (radius - 5), Math.sin(angle) * (radius - 5));
    context.lineTo(Math.cos(angle) * (radius + 5), Math.sin(angle) * (radius + 5));
    context.stroke();
    context.beginPath();
    context.arc(0, 0, tool === 'ik' ? 6 : 2, 0, Math.PI * 2);
    context.fillStyle = active === 'center' ? accent : tool === 'ik' ? '#17191f' : color;
    context.fill();
    if (tool === 'ik') {
      context.strokeStyle = color;
      context.stroke();
    }
  }
  context.restore();
}

export function transformControl(tool: TransformTool, matrix: Matrix, zoom: number, sprite?: { width: number; height: number; anchor: Vec2 }) {
  const origin = { x: matrix.e, y: matrix.f };
  if (tool === 'pivot') return { center: origin };
  if (tool !== 'scale') return null;

  const local = { x: Math.max(0, sprite ? sprite.width - sprite.anchor.x : 0),
    y: Math.max(0, sprite ? sprite.height - sprite.anchor.y : 0) };
  const edge = { x: origin.x + matrix.a * local.x + matrix.c * local.y, y: origin.y + matrix.b * local.x + matrix.d * local.y };
  const direction = { x: matrix.a + matrix.c, y: matrix.b + matrix.d };
  const length = Math.hypot(direction.x, direction.y) || 1;
  const gap = 12 / zoom;
  return { edge, center: { x: edge.x + gap * direction.x / length, y: edge.y + gap * direction.y / length } };
}
