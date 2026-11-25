import { nodeSpriteIds, type AnimationFrame, type NodeFrameState, type RigNode } from '../types/project';

export interface EditableScene {
  nodes: Record<string, RigNode>;
  rootNodeIds: string[];
  frames: AnimationFrame[];
  fps: number;
  isLooping: boolean;
}

export interface EditPlan { message: string; operations: EditOperation[] }
export interface EditScope {
  nodeId: string | null;
  frameIds: string[];
  referenceFrameId: string | undefined;
}
export type EditOperation =
  | { type: 'set_node_frame'; nodeId: string; frameNumbers: number[]; positionX: number | null; positionY: number | null; rotation: number | null; scaleX: number | null; scaleY: number | null; visible: boolean | null; spriteIndex: number | null; sortingOrder: number | null }
  | { type: 'set_node'; nodeId: string; name: string | null; pivotX: number | null; pivotY: number | null; visible: boolean | null; locked: boolean | null }
  | { type: 'add_node'; nodeId: string; name: string; parentId: string | null; spriteIds: string[] }
  | { type: 'remove_node'; nodeId: string }
  | { type: 'set_node_sprites'; nodeId: string; spriteIds: string[] }
  | { type: 'add_frames'; afterFrameNumber: number; copyFromFrameNumber: number; count: number }
  | { type: 'remove_frames'; frameNumbers: number[] }
  | { type: 'move_frame'; frameNumber: number; toFrameNumber: number }
  | { type: 'group_frames'; frameNumbers: number[]; name: string; color: string }
  | { type: 'set_animation'; fps: number | null; loop: boolean | null }
  | { type: 'animate_node'; nodeId: string; keys: AnimateKey[]; easing: 'linear' | 'easeInOut' };

/** 一个关键帧：只写需要变化的属性，其余保持上一关键帧的值。 */
export interface AnimateKey {
  frame: number;
  rotation?: number | null;
  positionX?: number | null;
  positionY?: number | null;
  scaleX?: number | null;
  scaleY?: number | null;
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex 返回的数据结构无效。');
  return value as Record<string, unknown>;
};
function number(value: unknown, label: string, min = -100000, max = 100000, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`无效的 ${label}。`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`无效的 ${label}。`);
  return value.trim();
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('无效的布尔属性。');
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('无效的贴图列表。');
  return [...new Set(value.map((id) => text(id, '贴图 ID')))];
}
export function parseEditPlan(value: unknown): EditPlan {
  const plan = object(value);
  if (typeof plan.message !== 'string' || plan.message.length > 16000 || !Array.isArray(plan.operations) || plan.operations.length > 200) throw new Error('Codex 返回的修改方案无效或过大。');
  // Every operation is independently validated against the actual scene before application.
  plan.operations.forEach(object);
  return plan as unknown as EditPlan;
}
function defaultState(node: RigNode): NodeFrameState {
  return { ...structuredClone(node.transform), visible: node.visible, imageIndex: 0, sortingOrder: node.sortingOrder ?? 0 };
}

export function applyEditPlan(scene: EditableScene, plan: EditPlan, assetIds: string[], scope?: EditScope): EditableScene {
  const result = structuredClone(scene);
  const assets = new Set(assetIds);
  const targetFrames = scope ? new Set(scope.frameIds) : null;
  const targetNodes = scope?.nodeId ? new Set([scope.nodeId]) : null;
  const assertFrameScope = (frameIndex: number) => {
    if (targetFrames && !targetFrames.has(result.frames[frameIndex].id)) {
      throw new Error(`修改超出帧范围（第 ${frameIndex + 1} 帧）。请扩大帧范围或让 AI 重新生成。`);
    }
  };
  const getNode = (id: unknown, editable = true): RigNode => {
    const key = text(id, '节点 ID');
    if (!Object.prototype.hasOwnProperty.call(result.nodes, key)) throw new Error(`找不到节点：${key}`);
    const node = result.nodes[key];
    if (editable && node.locked) throw new Error(`节点“${node.name}”已锁定，请先解锁。`);
    return node;
  };
  const index = (value: unknown) => number(value, '帧编号', 1, result.frames.length, true) - 1;
  const indexes = (value: unknown): number[] => {
    if (!Array.isArray(value) || !value.length) throw new Error('需要指定至少一个帧。');
    const ids = [...new Set(value.map(index))];
    ids.forEach(assertFrameScope);
    return ids;
  };
  const validSprites = (value: unknown) => {
    const ids = strings(value);
    if (ids.some((id) => !assets.has(id))) throw new Error('修改引用了不存在的贴图。');
    return ids;
  };
  for (const raw of plan.operations) {
    const op = object(raw);
    const targetId = op.type === 'add_node' ? op.parentId : op.nodeId;
    if (targetNodes && (op.type === 'add_node' || 'nodeId' in op)
      && (typeof targetId !== 'string' || !targetNodes.has(targetId))) {
      throw new Error('修改超出节点范围。请扩大节点范围或让 AI 重新生成。');
    }
    switch (op.type) {
      case 'set_node_frame': {
        const node = getNode(op.nodeId);
        for (const i of indexes(op.frameNumbers)) {
          const frame = result.frames[i];
          const state = frame.nodeStates[node.id] ?? defaultState(node);
          frame.nodeStates[node.id] = state;
          for (const [field, axis] of [['positionX', 'x'], ['positionY', 'y']] as const) if (op[field] != null) state.position[axis] = number(op[field], field);
          for (const [field, axis] of [['scaleX', 'x'], ['scaleY', 'y']] as const) if (op[field] != null) {
            const scale = number(op[field], field, -100, 100);
            if (Math.abs(scale) < 0.001) throw new Error('缩放不能为零。');
            state.scale[axis] = scale;
          }
          if (op.rotation != null) state.rotation = number(op.rotation, '旋转');
          if (op.visible != null) state.visible = boolean(op.visible);
          if (op.spriteIndex != null) state.imageIndex = number(op.spriteIndex, '贴图索引', 0, Math.max(0, nodeSpriteIds(node).length - 1), true);
          if (op.sortingOrder != null) state.sortingOrder = number(op.sortingOrder, '排序', -100000, 100000, true);
        }
        break;
      }
      case 'set_node': {
        const node = getNode(op.nodeId, false);
        if (node.locked && op.locked !== false) throw new Error(`节点“${node.name}”已锁定。`);
        if (op.name != null) node.name = text(op.name, '节点名称');
        if (op.visible != null) node.visible = boolean(op.visible);
        if (op.locked != null) node.locked = boolean(op.locked);
        // Compensate pivot changes in all frames and immediate children, matching Inspector behavior.
        const pivot = { x: op.pivotX == null ? node.pivot.x : number(op.pivotX, 'Pivot X'), y: op.pivotY == null ? node.pivot.y : number(op.pivotY, 'Pivot Y') };
        const delta = { x: pivot.x - node.pivot.x, y: pivot.y - node.pivot.y };
        if (delta.x || delta.y) {
          const compensate = (transform: RigNode['transform']) => {
            const angle = transform.rotation * Math.PI / 180;
            const x = delta.x * transform.scale.x, y = delta.y * transform.scale.y;
            transform.position.x += Math.cos(angle) * x - Math.sin(angle) * y;
            transform.position.y += Math.sin(angle) * x + Math.cos(angle) * y;
          };
          for (const frame of result.frames) {
            const state = frame.nodeStates[node.id] ?? defaultState(node);
            frame.nodeStates[node.id] = state;
            compensate(state);
            for (const childId of node.children) {
              const child = result.nodes[childId];
              const childState = frame.nodeStates[childId] ?? defaultState(child);
              frame.nodeStates[childId] = childState;
              childState.position.x -= delta.x; childState.position.y -= delta.y;
            }
          }
          compensate(node.transform);
          for (const childId of node.children) {
            result.nodes[childId].transform.position.x -= delta.x;
            result.nodes[childId].transform.position.y -= delta.y;
          }
          node.pivot = pivot;
        }
        break;
      }
      case 'add_node': {
        const id = text(op.nodeId, '新节点 ID');
        if (Object.prototype.hasOwnProperty.call(result.nodes, id) || ['__proto__', 'constructor', 'prototype'].includes(id) || Object.keys(result.nodes).length >= 500) throw new Error('新节点 ID 重复或节点数量过多。');
        const parent = op.parentId == null ? null : getNode(op.parentId);
        const spriteIds = validSprites(op.spriteIds);
        const node: RigNode = { id, name: text(op.name, '节点名称'), parentId: parent?.id ?? null, children: [], assetIds: spriteIds, assetId: spriteIds[0] ?? null, pivot: { x: 0, y: 0 }, transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } }, visible: true, locked: false };
        result.nodes[id] = node;
        targetNodes?.add(id);
        if (parent) parent.children.push(id); else result.rootNodeIds.push(id);
        result.frames.forEach((frame) => { frame.nodeStates[id] = defaultState(node); });
        break;
      }
      case 'remove_node': {
        const node = getNode(op.nodeId);
        const removed = new Set<string>();
        const visit = (id: string) => { getNode(id); removed.add(id); result.nodes[id].children.forEach(visit); };
        visit(node.id);
        for (const id of removed) delete result.nodes[id];
        for (const item of Object.values(result.nodes)) item.children = item.children.filter((id) => !removed.has(id));
        result.rootNodeIds = result.rootNodeIds.filter((id) => !removed.has(id));
        for (const frame of result.frames) for (const id of removed) delete frame.nodeStates[id];
        break;
      }
      case 'set_node_sprites': {
        const node = getNode(op.nodeId);
        const previous = nodeSpriteIds(node);
        const ids = validSprites(op.spriteIds);
        for (const frame of result.frames) {
          const state = frame.nodeStates[node.id];
          if (state) state.imageIndex = Math.max(0, ids.indexOf(previous[state.imageIndex]));
        }
        node.assetIds = ids; node.assetId = ids[0] ?? null;
        break;
      }
      case 'add_frames': {
        const source = result.frames[index(op.copyFromFrameNumber)];
        const after = number(op.afterFrameNumber, '插入位置', 0, result.frames.length, true);
        const count = number(op.count, '新增帧数', 1, 120, true);
        if (result.frames.length + count > 1000) throw new Error('动画帧数不能超过 1000。');
        const copies = Array.from({ length: count }, () => ({ ...structuredClone(source), id: `frame-${crypto.randomUUID()}` }));
        copies.forEach(({ id }) => targetFrames?.add(id));
        result.frames.splice(after, 0, ...copies);
        break;
      }
      case 'remove_frames': {
        const removed = new Set(indexes(op.frameNumbers));
        if (removed.size === result.frames.length) throw new Error('动画至少需要保留一帧。');
        result.frames = result.frames.filter((_, i) => !removed.has(i));
        break;
      }
      case 'move_frame': {
        const from = index(op.frameNumber), to = index(op.toFrameNumber);
        assertFrameScope(from);
        const [frame] = result.frames.splice(from, 1); result.frames.splice(to, 0, frame);
        break;
      }
      case 'group_frames': {
        const selected = indexes(op.frameNumbers);
        const color = text(op.color, '分组颜色');
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('分组颜色需要六位十六进制值。');
        const group = { id: `group-${crypto.randomUUID()}`, name: text(op.name, '分组名称'), color };
        selected.forEach((i) => { result.frames[i].group = { ...group }; });
        break;
      }
      case 'set_animation':
        if (op.fps != null) result.fps = number(op.fps, 'FPS', 1, 60, true);
        if (op.loop != null) result.isLooping = boolean(op.loop);
        break;
      case 'animate_node': {
        // 关键帧式：只给关键姿态，中间帧由这里插值生成，避免逐帧写满导致回复超长被截断。
        const node = getNode(op.nodeId);
        if (!Array.isArray(op.keys) || op.keys.length < 2 || op.keys.length > 60) throw new Error('animate_node 需要 2 到 60 个关键帧。');
        const keys = op.keys.map((raw): { frame: number } & Record<string, unknown> => {
          const key = object(raw);
          return { ...key, frame: number(key.frame, '帧编号', 1, result.frames.length, true) - 1 };
        }).sort((a, b) => a.frame - b.frame);
        const easing = op.easing === 'linear'
          ? (t: number) => t
          : (t: number) => t * t * (3 - 2 * t);
        const write = (frameIndex: number, values: Record<string, unknown>) => {
          assertFrameScope(frameIndex);
          const frame = result.frames[frameIndex];
          const state = frame.nodeStates[node.id] ?? defaultState(node);
          frame.nodeStates[node.id] = state;
          if (values.positionX != null) state.position.x = number(values.positionX, 'positionX');
          if (values.positionY != null) state.position.y = number(values.positionY, 'positionY');
          if (values.scaleX != null) {
            const scale = number(values.scaleX, 'scaleX', -100, 100);
            if (Math.abs(scale) < 0.001) throw new Error('缩放不能为零。');
            state.scale.x = scale;
          }
          if (values.scaleY != null) {
            const scale = number(values.scaleY, 'scaleY', -100, 100);
            if (Math.abs(scale) < 0.001) throw new Error('缩放不能为零。');
            state.scale.y = scale;
          }
          if (values.rotation != null) state.rotation = number(values.rotation, '旋转');
        };
        const fields = ['rotation', 'positionX', 'positionY', 'scaleX', 'scaleY'] as const;
        keys.forEach((key) => write(key.frame, key));
        for (let i = 0; i < keys.length - 1; i += 1) {
          const from = keys[i];
          const to = keys[i + 1];
          const span = to.frame - from.frame;
          if (span <= 1) continue;
          for (let frameIndex = from.frame + 1; frameIndex < to.frame; frameIndex += 1) {
            const t = easing((frameIndex - from.frame) / span);
            const mixed: Record<string, number> = {};
            for (const field of fields) {
              const a = from[field];
              const b = to[field];
              if (typeof a === 'number' && typeof b === 'number') mixed[field] = a + (b - a) * t;
            }
            write(frameIndex, mixed);
          }
        }
        break;
      }
      default: throw new Error(`不支持的 Codex 操作：${String(op.type)}`);
    }
  }
  return result;
}

export function describeOperation(op: EditOperation): string {
  switch (op.type) {
    case 'set_node_frame': return `修改节点 ${op.nodeId}，帧 ${op.frameNumbers.join(', ')}：${Object.entries(op).filter(([key, value]) => !['type', 'nodeId', 'frameNumbers'].includes(key) && value != null).map(([key, value]) => `${key}=${value}`).join('，')}`;
    case 'set_node': return `修改节点 ${op.nodeId}：${Object.entries(op).filter(([key, value]) => !['type', 'nodeId'].includes(key) && value != null).map(([key, value]) => `${key}=${value}`).join('，')}`;
    case 'add_node': return `添加节点“${op.name}”`;
    case 'remove_node': return `删除节点 ${op.nodeId} 及其子节点`;
    case 'set_node_sprites': return `更新节点 ${op.nodeId} 的贴图列表`;
    case 'add_frames': return `在帧 ${op.afterFrameNumber} 后添加 ${op.count} 帧，复制帧 ${op.copyFromFrameNumber}`;
    case 'remove_frames': return `删除帧 ${op.frameNumbers.join(', ')}`;
    case 'move_frame': return `将帧 ${op.frameNumber} 移到 ${op.toFrameNumber}`;
    case 'group_frames': return `将帧 ${op.frameNumbers.join(', ')} 分组为“${op.name}”`;
    case 'set_animation': return `更新动画设置：FPS=${op.fps ?? '保留'}，循环=${op.loop ?? '保留'}`;
    case 'animate_node': return `节点 ${op.nodeId} 关键帧动画：${op.keys.map((key) => '第' + key.frame + '帧').join(' → ')}（${op.easing === 'linear' ? '线性' : '缓入缓出'}插值）`;
  }
}
