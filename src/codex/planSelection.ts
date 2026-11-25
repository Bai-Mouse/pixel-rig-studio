import type { AnimationFrame, RigNode } from '../types/project';
import type { EditOperation, EditPlan } from './editPlan';

const changesFrameNumbers = (op: EditOperation) => ['add_frames', 'remove_frames', 'move_frame'].includes(op.type);
const usesFrameNumbers = (op: EditOperation) => 'frameNumbers' in op || op.type === 'animate_node';

export interface PlanUnit {
  label: string;
  operations: { index: number; operation: EditOperation }[];
}

/** Frame numbers in a structural plan depend on its earlier inserts/deletes/moves. */
export function planUnits(plan: EditPlan, frames: AnimationFrame[], nodes: Record<string, RigNode>): PlanUnit[] {
  const units = new Map<string, PlanUnit>();
  const structural = plan.operations.some(changesFrameNumbers);
  const add = (key: string, label: string, index: number, operation: EditOperation) => {
    if (!units.has(key)) units.set(key, { label, operations: [] });
    units.get(key)!.operations.push({ index, operation });
  };
  plan.operations.forEach((op, index) => {
    const nodeId = 'nodeId' in op ? op.nodeId : undefined;
    if (changesFrameNumbers(op) || (structural && op.type === 'group_frames')) {
      add('timeline', '时间轴结构（插入、删除、移动和分组）', index, op);
      return;
    }
    if (op.type === 'group_frames') {
      add(`group-operation:${index}`, `分组 · ${op.name}`, index, op);
      return;
    }
    if (!structural && op.type === 'set_node_frame') {
      const byGroup = new Map<string, { label: string; numbers: number[] }>();
      op.frameNumbers.forEach((number) => {
        const group = frames[number - 1]?.group;
        const key = group ? `group:${group.id}` : `frame:${number}`;
        if (!byGroup.has(key)) byGroup.set(key, { label: group?.name ?? `第 ${number} 帧`, numbers: [] });
        byGroup.get(key)!.numbers.push(number);
      });
      byGroup.forEach(({ label, numbers }, key) => {
        const nodeLabel = nodeId ? nodes[nodeId]?.name ?? nodeId : '';
        add(JSON.stringify([nodeId, key]), nodeLabel ? `${nodeLabel} · ${label}` : label, index, { ...op, frameNumbers: numbers });
      });
      return;
    }
    const label = nodeId ? nodes[nodeId]?.name ?? (op.type === 'add_node' ? op.name : nodeId) : '动画设置';
    add(JSON.stringify([nodeId]), label, index, op);
  });
  return [...units.values()];
}

export function selectedPlan(plan: EditPlan, units: PlanUnit[], excluded: number[]): EditPlan {
  // Preserve the exact original plan, including interleaved groups, when all are selected.
  if (!excluded.length) return plan;
  const omitted = new Set(excluded);
  const operations = units.flatMap((unit, index) => omitted.has(index) ? [] : unit.operations)
    .sort((a, b) => a.index - b.index)
    .map(({ operation }) => operation);
  if (plan.operations.some(changesFrameNumbers) && !operations.some(changesFrameNumbers) && operations.some(usesFrameNumbers)) {
    throw new Error('所选帧修改依赖时间轴结构，请同时勾选时间轴结构。');
  }
  return { ...plan, operations };
}
