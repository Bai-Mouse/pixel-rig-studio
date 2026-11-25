import { useId, useMemo, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { ikHierarchy } from '../state/twoBoneIk';
import type { RigNode } from '../types/project';

function BindingEditor({ node, chain, onSave, onRemove }: {
  node: RigNode;
  chain: ReturnType<typeof ikHierarchy>;
  onSave: (name: string) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(node.ikBinding?.name ?? node.name);
  const nameId = useId();
  const stale = node.ikBinding && (!chain || node.ikBinding.upperId !== chain.upper.id || node.ikBinding.lowerId !== chain.lower.id);
  return <form className="ik-binding-editor" onSubmit={(event) => { event.preventDefault(); if (chain && name.trim()) onSave(name); }}>
    <div className={stale ? 'ik-panel-error' : 'ik-panel-hint'}>
      {stale ? 'Hierarchy changed. Rebind to the current joints or remove the binding.' : node.ikBinding ? 'Saved binding' : 'Auto-detected chain'}
    </div>
    {chain && <div className="ik-panel-hint">{chain.upper.name} → {chain.lower.name} → {chain.end.name}</div>}
    <label htmlFor={nameId}>Binding name</label>
    <input id={nameId} value={name} maxLength={48} onChange={(event) => setName(event.target.value)} />
    <div className="ik-panel-actions">
      <button type="submit" className="tool-button" disabled={!chain || !name.trim()}>{stale ? 'Rebind' : 'Save binding'}</button>
      {node.ikBinding && <button type="button" className="tool-button" onClick={onRemove}>Remove binding</button>}
    </div>
  </form>;
}

export function IkBindings({ onMessage }: { onMessage: (message: string | null) => void }) {
  const nodes = useProjectStore((state) => state.nodes);
  const selectedId = useProjectStore((state) => state.selectedNodeId);
  const selectNode = useProjectStore((state) => state.selectNode);
  const setBinding = useProjectStore((state) => state.setIkBinding);
  const selectId = useId();
  const { saved, candidates } = useMemo(() => {
    const entries = Object.values(nodes);
    return {
      saved: entries.filter((node) => node.ikBinding),
      candidates: entries.filter((node) => !node.ikBinding && ikHierarchy(nodes, node.id)),
    };
  }, [nodes]);
  const node = selectedId ? nodes[selectedId] : undefined;
  const chain = node && ikHierarchy(nodes, node.id);
  return <details className="ik-bindings">
    <summary>IK bindings {saved.length > 0 ? `(${saved.length})` : ''}</summary>
    <label htmlFor={selectId}>Endpoint / saved binding</label>
    <select id={selectId} value={node && (chain || node.ikBinding) ? node.id : ''} onChange={(event) => selectNode(event.target.value || null)}>
      <option value="">Choose an endpoint…</option>
      {saved.length > 0 && <optgroup label="Saved bindings">{saved.map((item) =>
        <option key={item.id} value={item.id}>{item.ikBinding?.name} — {item.name}</option>)}</optgroup>}
      {candidates.length > 0 && <optgroup label="Auto-detected chains">{candidates.map((item) => {
        const hierarchy = ikHierarchy(nodes, item.id);
        return <option key={item.id} value={item.id}>{hierarchy?.upper.name} → {hierarchy?.lower.name} → {item.name}</option>;
      })}</optgroup>}
    </select>
    {node && (chain || node.ikBinding) && <BindingEditor
      key={`${node.id}:${node.ikBinding?.name ?? ''}`} node={node} chain={chain || null}
      onSave={(name) => onMessage(setBinding(node.id, name))}
      onRemove={() => onMessage(setBinding(node.id, null))}
    />}
  </details>;
}
