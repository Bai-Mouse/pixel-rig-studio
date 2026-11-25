import { useMemo, useState } from 'react';
import { applyEditPlan, describeOperation, type EditPlan, type EditScope } from './editPlan';
import type { captureCodexProject } from './context';
import { planUnits, selectedPlan } from './planSelection';
import { PlanPreview } from './PlanPreview';

type Baseline = ReturnType<typeof captureCodexProject>;

export function PlanReview({ baseline, plan, scope, disabled, stale, onApply, onDiscard }: {
  baseline: Baseline;
  plan: EditPlan;
  scope: EditScope | undefined;
  disabled: boolean;
  stale: boolean;
  onApply: (plan: EditPlan) => void;
  onDiscard: () => void;
}) {
  const [excluded, setExcluded] = useState<number[]>([]);
  const [preview, setPreview] = useState(false);
  const units = useMemo(() => planUnits(plan, baseline.frames, baseline.nodes), [plan, baseline]);
  const result = useMemo(() => {
    try {
      const selection = selectedPlan(plan, units, excluded);
      if (!selection.operations.length) return { error: '请选择要应用的修改。' };
      const scene = applyEditPlan(baseline, selection, Object.keys(baseline.assets), scope);
      return { selection, after: { ...baseline, ...scene } };
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [plan, units, excluded, baseline, scope]);

  return <>
    <details open>
      <summary>{units.length - excluded.length}/{units.length} 组修改已选</summary>
      <ul className="codex-plan-units">{units.map((unit, index) => (
        <li key={index}>
          <label><input type="checkbox" checked={!excluded.includes(index)} onChange={(event) => {
            setExcluded(event.target.checked ? excluded.filter((item) => item !== index) : [...excluded, index]);
          }} /> {unit.label}</label>
          <details><summary>查看 {unit.operations.length} 项操作</summary>
            <ol>{unit.operations.map(({ operation }, operationIndex) => <li key={operationIndex}>{describeOperation(operation)}</li>)}</ol>
          </details>
        </li>
      ))}</ul>
    </details>
    {preview && result.after && <PlanPreview before={baseline} after={result.after} frameIds={scope?.frameIds ?? []} />}
    <div className="codex-plan-actions">
      <button type="button" disabled={disabled || stale || !result.selection} onClick={() => { if (result.selection) onApply(result.selection); }}>应用所选修改</button>
      <button type="button" disabled={!result.after} onClick={() => setPreview(!preview)}>{preview ? '收起预览' : '前后对照预览'}</button>
      <button type="button" onClick={onDiscard}>放弃方案</button>
    </div>
    {stale && <small>项目已改变，请重新生成方案。</small>}
    {result.error && <small className="codex-error">{result.error}</small>}
  </>;
}
