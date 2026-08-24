import { useEffect, useMemo, useRef, useState } from 'react';
import '../source-preview.css';
import { Icon } from './Icon';
import { useProjectStore } from '../state/projectStore';
import { cropAssetFromSource, filesToImportCandidates, replaceAssetsFromSource } from '../utils/importPng';
import { nodeSpriteIds, type SpriteAsset, type SpriteSlice } from '../types/project';

const Pair = ({ label, value }: { label: string; value: string }) => <div className="property-pair"><span>{label}</span><strong>{value}</strong></div>;

interface PropertiesPanelProps {
  onEditAsset: (assetId: string) => void;
}

interface SliceDrag {
  mode: 'move' | 'resize';
  start: { x: number; y: number };
  slice: SpriteSlice;
}

function clampSlice(slice: SpriteSlice, sourceWidth: number, sourceHeight: number): SpriteSlice {
  const width = Math.max(1, Math.min(sourceWidth, Math.round(slice.width)));
  const height = Math.max(1, Math.min(sourceHeight, Math.round(slice.height)));
  return {
    x: Math.max(0, Math.min(sourceWidth - width, Math.round(slice.x))),
    y: Math.max(0, Math.min(sourceHeight - height, Math.round(slice.y))),
    width,
    height,
  };
}

export function PropertiesPanel({ onEditAsset }: PropertiesPanelProps) {
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const sourceStageRef = useRef<HTMLDivElement>(null);
  const sliceDragRef = useRef<SliceDrag | null>(null);
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId);
  const selectedAssetId = useProjectStore((state) => state.selectedAssetId);
  const selectedAssetIds = useProjectStore((state) => state.selectedAssetIds);
  const node = useProjectStore((state) => selectedNodeId ? state.nodes[selectedNodeId] : null);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const currentFrame = useProjectStore((state) => state.frames[state.currentFrameIndex]);
  const beginTransform = useProjectStore((state) => state.beginTransform);
  const updateNodeFrame = useProjectStore((state) => state.updateNodeFrame);
  const commitTransform = useProjectStore((state) => state.commitTransform);
  const flipNode = useProjectStore((state) => state.flipNode);
  const resetNodeTransform = useProjectStore((state) => state.resetNodeTransform);
  const setNodeSortingOrder = useProjectStore((state) => state.setNodeSortingOrder);
  const setNodeAsset = useProjectStore((state) => state.setNodeAsset);
  const addNodeSprites = useProjectStore((state) => state.addNodeSprites);
  const removeNodeSprite = useProjectStore((state) => state.removeNodeSprite);
  const setNodeFrameSprite = useProjectStore((state) => state.setNodeFrameSprite);
  const renameNode = useProjectStore((state) => state.renameNode);
  const createNodeForAsset = useProjectStore((state) => state.createNodeForAsset);
  const deleteAsset = useProjectStore((state) => state.deleteAsset);
  const replaceAssets = useProjectStore((state) => state.replaceAssets);
  const assetsById = useProjectStore((state) => state.assets);
  const allAssets = useMemo(() => Object.values(assetsById), [assetsById]);
  const selectedAsset = selectedAssetId ? assetsById[selectedAssetId] : null;
  const selectedAssets = selectedAssetIds.map((assetId) => assetsById[assetId]).filter((asset): asset is SpriteAsset => Boolean(asset));
  const isWholeSourceSheet = Boolean(selectedAsset?.source && selectedAsset.slice
    && selectedAsset.slice.x === 0
    && selectedAsset.slice.y === 0
    && selectedAsset.slice.width === selectedAsset.source.width
    && selectedAsset.slice.height === selectedAsset.source.height);
  const [draftName, setDraftName] = useState('');
  const [assetMessage, setAssetMessage] = useState('');
  const [isReplacing, setIsReplacing] = useState(false);
  const [sliceDraft, setSliceDraft] = useState<SpriteSlice | null>(null);
  const [isUpdatingSlice, setIsUpdatingSlice] = useState(false);
  const [isSpritePickerOpen, setIsSpritePickerOpen] = useState(false);
  const [pendingSpriteIds, setPendingSpriteIds] = useState<string[]>([]);
  const frameState = node ? currentFrame?.nodeStates[node.id] : null;
  const transform = frameState ?? {
    position: node?.transform.position ?? { x: 0, y: 0 },
    rotation: node?.transform.rotation ?? 0,
    scale: node?.transform.scale ?? { x: 1, y: 1 },
    visible: node?.visible ?? true,
    imageIndex: 0,
    sortingOrder: node?.sortingOrder ?? 0,
  };
  const assignedSpriteIds = node ? nodeSpriteIds(node) : [];
  const activeSpriteIndex = Math.max(0, Math.min(assignedSpriteIds.length - 1, transform.imageIndex));
  const nodeAsset = assignedSpriteIds.length ? assetsById[assignedSpriteIds[activeSpriteIndex]] : null;

  useEffect(() => {
    setDraftName(node?.name ?? '');
    setIsSpritePickerOpen(false);
    setPendingSpriteIds([]);
  }, [node?.id, node?.name]);

  useEffect(() => {
    setAssetMessage('');
  }, [selectedAssetId, selectedAssetIds.length]);

  useEffect(() => {
    setSliceDraft(selectedAsset?.slice ? { ...selectedAsset.slice } : null);
  }, [selectedAsset?.id, selectedAsset?.slice?.x, selectedAsset?.slice?.y, selectedAsset?.slice?.width, selectedAsset?.slice?.height]);

  const replaceSource = async (files: FileList | null) => {
    if (!selectedAsset?.source || !files?.length) return;
    setIsReplacing(true);
    setAssetMessage('Preparing replacement image...');
    try {
      const candidates = await filesToImportCandidates(Array.from(files));
      if (candidates.length !== 1) throw new Error('Choose exactly one PNG replacement image.');
      const refreshed = await replaceAssetsFromSource(allAssets, selectedAsset.source.id, candidates[0]);
      replaceAssets(refreshed);
      setAssetMessage(`Updated ${refreshed.length} linked slice${refreshed.length === 1 ? '' : 's'} without changing node bindings.`);
    } catch (error) {
      setAssetMessage(error instanceof Error ? error.message : 'Could not replace the source image.');
    } finally {
      setIsReplacing(false);
    }
  };

  const updateSliceDraft = (patch: Partial<SpriteSlice>) => {
    if (!selectedAsset?.source) return;
    setSliceDraft((current) => current ? clampSlice({ ...current, ...patch }, selectedAsset.source!.width, selectedAsset.source!.height) : current);
  };

  const sourcePointFromEvent = (event: React.PointerEvent<HTMLElement>) => {
    if (!selectedAsset?.source || !sourceStageRef.current) return null;
    const rect = sourceStageRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(selectedAsset.source.width, Math.round((event.clientX - rect.left) / rect.width * selectedAsset.source.width))),
      y: Math.max(0, Math.min(selectedAsset.source.height, Math.round((event.clientY - rect.top) / rect.height * selectedAsset.source.height))),
    };
  };

  const beginSliceDrag = (event: React.PointerEvent<HTMLSpanElement>, mode: SliceDrag['mode']) => {
    const point = sourcePointFromEvent(event);
    if (!point || !sliceDraft) return;
    event.preventDefault();
    event.stopPropagation();
    sourceStageRef.current?.setPointerCapture(event.pointerId);
    sliceDragRef.current = { mode, start: point, slice: { ...sliceDraft } };
  };

  const moveSliceDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = sliceDragRef.current;
    const point = sourcePointFromEvent(event);
    if (!drag || !point || !selectedAsset?.source) return;
    const deltaX = point.x - drag.start.x;
    const deltaY = point.y - drag.start.y;
    const next = drag.mode === 'move'
      ? { ...drag.slice, x: drag.slice.x + deltaX, y: drag.slice.y + deltaY }
      : { ...drag.slice, width: Math.max(1, drag.slice.width + deltaX), height: Math.max(1, drag.slice.height + deltaY) };
    setSliceDraft(clampSlice(next, selectedAsset.source.width, selectedAsset.source.height));
  };

  const applySlice = async () => {
    if (!selectedAsset || !selectedAsset.source || !sliceDraft) return;
    setIsUpdatingSlice(true);
    setAssetMessage('Updating linked sprite region...');
    try {
      const updated = await cropAssetFromSource(selectedAsset, sliceDraft);
      replaceAssets([updated]);
      setAssetMessage('Source region updated without changing node bindings.');
    } catch (error) {
      setAssetMessage(error instanceof Error ? error.message : 'Could not update the source region.');
    } finally {
      setIsUpdatingSlice(false);
    }
  };

  return (
    <aside className="panel properties-panel">
      <input ref={replacementInputRef} type="file" accept="image/png,.png" hidden onChange={(event) => { void replaceSource(event.target.files); event.currentTarget.value = ''; }} />
      <div className="panel-heading"><span><Icon name={selectedAssets.length ? 'image' : 'target'} /> {selectedAssets.length > 1 ? 'Image manager' : selectedAsset ? 'Image manager' : 'Properties'}</span></div>
      {selectedAssets.length > 1 ? (
        <div className="properties-content">
          <div className="selection-title"><Icon name="image" /><div><strong>{selectedAssets.length} images selected</strong><small>Ctrl/Cmd toggles items · Shift selects a range</small></div></div>
          <div className="property-group">
            <h3>Batch selection</h3>
            <Pair label="Images" value={String(selectedAssets.length)} />
            <Pair label="Action" value="Add all or delete all" />
          </div>
          <div className="property-group asset-management-actions">
            <h3>Batch actions</h3>
            <button className="add-sprite-button" type="button" onClick={() => selectedAssets.forEach((asset) => createNodeForAsset(asset.id))}><Icon name="plus" /> Add all to canvas</button>
            <button className="delete-sprite-button" type="button" onClick={() => { if (window.confirm(`Delete ${selectedAssets.length} selected sprites? Nodes using them will keep empty sprite slots.`)) selectedAssets.forEach((asset) => deleteAsset(asset.id)); }}><Icon name="trash" size={13} /> Delete selected</button>
          </div>
        </div>
      ) : selectedAsset ? (
        <div className="properties-content">
          <div className="selection-title"><span className="texture-manager-preview checkerboard"><img src={selectedAsset.src} alt="" /></span><div><strong>{selectedAsset.name}</strong><small>{selectedAsset.folder}</small></div></div>
          <div className="property-group">
            <h3>Image information</h3>
            <Pair label="Dimensions" value={`${selectedAsset.width} x ${selectedAsset.height} px`} />
            <Pair label="Format" value="PNG" />
            {selectedAsset.source && <Pair label="Source image" value={selectedAsset.source.name} />}
            {isWholeSourceSheet && <p className="node-edit-hint">This is the master sprite sheet. Editing it refreshes every linked body part.</p>}
            {selectedAsset.slice && <Pair label="Source region" value={`${selectedAsset.slice.x}, ${selectedAsset.slice.y} · ${selectedAsset.slice.width} x ${selectedAsset.slice.height}`} />}
          </div>
          {selectedAsset.source && <div className="property-group">
            <h3>Source PNG crop</h3>
            <div
              ref={sourceStageRef}
              className="source-image-stage editable-source-stage"
              style={{ aspectRatio: `${selectedAsset.source.width} / ${selectedAsset.source.height}` }}
              onPointerMove={moveSliceDrag}
              onPointerUp={() => { sliceDragRef.current = null; }}
              onPointerCancel={() => { sliceDragRef.current = null; }}
            >
              <img src={selectedAsset.source.src} alt={`${selectedAsset.source.name} source preview`} />
              {sliceDraft && <span className="source-slice-outline editable" onPointerDown={(event) => beginSliceDrag(event, 'move')} style={{ left: `${sliceDraft.x / selectedAsset.source.width * 100}%`, top: `${sliceDraft.y / selectedAsset.source.height * 100}%`, width: `${sliceDraft.width / selectedAsset.source.width * 100}%`, height: `${sliceDraft.height / selectedAsset.source.height * 100}%` }}><span className="source-slice-resize-handle" onPointerDown={(event) => beginSliceDrag(event, 'resize')} /></span>}
            </div>
            {sliceDraft && <div className="source-slice-inputs">
              <label>X<input type="number" value={sliceDraft.x} onChange={(event) => updateSliceDraft({ x: Number(event.target.value) })} /></label>
              <label>Y<input type="number" value={sliceDraft.y} onChange={(event) => updateSliceDraft({ y: Number(event.target.value) })} /></label>
              <label>W<input type="number" min="1" value={sliceDraft.width} onChange={(event) => updateSliceDraft({ width: Number(event.target.value) })} /></label>
              <label>H<input type="number" min="1" value={sliceDraft.height} onChange={(event) => updateSliceDraft({ height: Number(event.target.value) })} /></label>
            </div>}
            {sliceDraft && <button className="apply-slice-button" type="button" disabled={isUpdatingSlice} onClick={() => void applySlice()}>{isUpdatingSlice ? 'Updating crop...' : 'Apply source crop'}</button>}
            <p className="source-image-caption">Drag the highlighted box to move it, drag its lower-right handle to resize it, then apply the crop.</p>
          </div>}
          <div className="property-group asset-management-actions">
            <h3>Actions</h3>
            <button className="add-sprite-button" type="button" onClick={() => createNodeForAsset(selectedAsset.id)}><Icon name="plus" /> Add to canvas</button>
            {node && <button className="apply-sprite-button" type="button" onClick={() => setNodeAsset(node.id, selectedAsset.id)}>Apply to “{node.name}”</button>}
            <button className="edit-sprite-button" type="button" onClick={() => onEditAsset(selectedAsset.id)}>{isWholeSourceSheet ? 'Edit sprite sheet' : 'Edit pixels'}</button>
            {selectedAsset.source && <button className="replace-source-button" type="button" disabled={isReplacing} onClick={() => replacementInputRef.current?.click()}><Icon name="import" size={13} /> {isReplacing ? 'Replacing source...' : 'Replace source PNG'}</button>}
            {selectedAsset.source && <p className={assetMessage.startsWith('Updated') ? 'asset-message success' : 'asset-message'}>{assetMessage || 'Keeps the same saved slices and node assignments.'}</p>}
            <button className="delete-sprite-button" type="button" onClick={() => { if (window.confirm(`Delete ${selectedAsset.name}? Nodes using it will keep an empty sprite slot.`)) deleteAsset(selectedAsset.id); }}><Icon name="trash" size={13} /> Delete sprite</button>
          </div>
        </div>
      ) : node ? (
        <div className="properties-content">
          <div className="selection-title"><span className="node-swatch" /> <div><strong>{node.name}</strong><small>Sprite node</small></div></div>
          <div className="property-group node-edit-group">
            <h3>Node edit</h3>
            <label className="node-name-input">Name<input value={draftName} onChange={(event) => setDraftName(event.target.value)} onBlur={() => renameNode(node.id, draftName)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
            <p className="node-edit-hint">Drag this node directly on the canvas to move it.</p>
          </div>
          <div className="property-group">
            <h3>Sprites <span>{assignedSpriteIds.length} assigned</span></h3>
            <div className="node-sprite-list">
              {assignedSpriteIds.map((assetId, index) => {
                const asset = assetsById[assetId];
                if (!asset) return null;
                return <div key={assetId} className={`node-sprite-item ${index === activeSpriteIndex ? 'active' : ''}`}>
                  <button type="button" className="node-sprite-choice" onClick={() => setNodeFrameSprite(node.id, index)} title={`Use on frame ${currentFrameIndex + 1}`}>
                    <span className="checkerboard"><img src={asset.src} alt="" /></span>
                    <span><strong>{asset.name}</strong><small>{index === activeSpriteIndex ? `Used on frame ${currentFrameIndex + 1}` : asset.folder || 'Unsorted'}</small></span>
                  </button>
                  <button type="button" className="node-sprite-remove" onClick={() => removeNodeSprite(node.id, assetId)} title="Remove sprite from node"><Icon name="trash" size={12} /></button>
                </div>;
              })}
              {!assignedSpriteIds.length && <p className="node-edit-hint">This node is empty. Add one or more sprites below.</p>}
            </div>
            <button className="node-add-sprites" type="button" onClick={() => { setPendingSpriteIds([]); setIsSpritePickerOpen(true); }}><Icon name="plus" size={13} /> Add sprites</button>
            {nodeAsset && <div className="node-texture-preview"><span className="checkerboard"><img src={nodeAsset.src} alt="" /></span><div><strong>{nodeAsset.name}</strong><small>{nodeAsset.folder || 'Unsorted'}</small></div></div>}
            <Pair label="Size" value={nodeAsset ? `${nodeAsset.width} x ${nodeAsset.height} px` : '—'} />
            <p className="node-edit-hint">Click a sprite to use it on only the current animation frame.</p>
          </div>
          <div className="property-group node-edit-group">
            <h3>Sorting order <span>Frame {currentFrameIndex + 1}</span></h3>
            <label className="node-name-input">Layer order<input type="number" step="1" value={transform.sortingOrder} onChange={(event) => setNodeSortingOrder(node.id, Number(event.target.value))} /></label>
            <p className="node-edit-hint">Higher values draw in front. This value belongs only to the current frame.</p>
          </div>
          <div className="property-group">
            <h3>Pivot</h3>
            <Pair label="X" value={`${node.pivot.x} px`} />
            <Pair label="Y" value={`${node.pivot.y} px`} />
          </div>
          <div className="property-group transform-group">
            <h3>Current frame transform <span>Frame {currentFrameIndex + 1}</span></h3>
            <div className="transform-input-grid">
              <label>Position X<input type="number" value={transform.position.x} onFocus={() => beginTransform(node.id)} onChange={(event) => updateNodeFrame(node.id, { position: { x: Number(event.target.value) } })} onBlur={commitTransform} /></label>
              <label>Position Y<input type="number" value={transform.position.y} onFocus={() => beginTransform(node.id)} onChange={(event) => updateNodeFrame(node.id, { position: { y: Number(event.target.value) } })} onBlur={commitTransform} /></label>
              <label>Rotation<input type="number" value={transform.rotation} onFocus={() => beginTransform(node.id)} onChange={(event) => updateNodeFrame(node.id, { rotation: Number(event.target.value) })} onBlur={commitTransform} /></label>
              <label>Scale<input type="number" min="0.1" step="0.1" value={Math.abs(transform.scale.x)} onFocus={() => beginTransform(node.id)} onChange={(event) => { const value = Number(event.target.value); updateNodeFrame(node.id, { scale: { x: Math.sign(transform.scale.x || 1) * value, y: Math.sign(transform.scale.y || 1) * value } }); }} onBlur={commitTransform} /></label>
            </div>
            <div className="transform-actions-panel">
              <button type="button" onClick={() => flipNode(node.id, 'horizontal')}>Flip H</button>
              <button type="button" onClick={() => flipNode(node.id, 'vertical')}>Flip V</button>
              <button type="button" onClick={() => resetNodeTransform(node.id)}>Reset</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-properties"><Icon name="cursor" size={25} /><strong>Select a node or sprite</strong><span>Its properties will appear here.</span></div>
      )}
      {node && isSpritePickerOpen && <div className="node-sprite-picker-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setIsSpritePickerOpen(false); }}>
        <div className="node-sprite-picker" role="dialog" aria-modal="true" aria-label="Add sprites to node">
          <header><div><strong>Add sprites</strong><small>{node.name}</small></div><button type="button" onClick={() => setIsSpritePickerOpen(false)}>Close</button></header>
          <div className="node-sprite-picker-grid">
            {allAssets.filter((asset) => !assignedSpriteIds.includes(asset.id)).map((asset) => {
              const selected = pendingSpriteIds.includes(asset.id);
              return <button key={asset.id} type="button" className={selected ? 'selected' : ''} onClick={() => setPendingSpriteIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id])}>
                <span className="checkerboard"><img src={asset.src} alt="" /></span><strong>{asset.name}</strong><small>{asset.folder || 'Unsorted'}</small>
              </button>;
            })}
            {!allAssets.some((asset) => !assignedSpriteIds.includes(asset.id)) && <p className="node-edit-hint">Every imported sprite is already assigned to this node.</p>}
          </div>
          <footer><span>{pendingSpriteIds.length} selected</span><button type="button" disabled={!pendingSpriteIds.length} onClick={() => { addNodeSprites(node.id, pendingSpriteIds); setPendingSpriteIds([]); setIsSpritePickerOpen(false); }}>Add selected</button></footer>
        </div>
      </div>}
    </aside>
  );
}
