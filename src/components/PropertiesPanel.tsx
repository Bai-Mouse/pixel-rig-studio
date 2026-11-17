import { useEffect, useMemo, useRef, useState } from 'react';
import '../source-preview.css';
import { Icon } from './Icon';
import { inspectorFrameIds, useProjectStore } from '../state/projectStore';
import { assetSource, filesToImportCandidates, importedSources, rebindAssetSource, replaceAssetsFromSource, sourceFor } from '../utils/importPng';
import { nodeSpriteIds, type SpriteAsset, type SpriteSlice, type SpriteSource, type Vec2 } from '../types/project';
import { SourceCropEditor } from './SourceCropEditor';
import { clampSlice } from '../utils/sliceGeometry';
import { centerAnchor, effectiveSpriteAnchor, remapAnchorForCrop } from '../utils/spriteAnchor';

const Pair = ({ label, value }: { label: string; value: string }) => <div className="property-pair"><span>{label}</span><strong>{value}</strong></div>;

/** Edits the sprite-space anchor that aligns one sprite with its node's origin. */
function SpriteAnchorEditor({ asset, fallback, onChange }: { asset: SpriteAsset; fallback: Vec2; onChange: (anchor: Vec2 | null) => void }) {
  const anchor = effectiveSpriteAnchor(asset, fallback);
  const set = (patch: Partial<Vec2>) => onChange({ x: anchor.x, y: anchor.y, ...patch });
  return <>
    <div className="transform-input-grid">
      <label>Anchor X<input type="number" step="1" value={anchor.x} onChange={(event) => set({ x: Number(event.target.value) })} /></label>
      <label>Anchor Y<input type="number" step="1" value={anchor.y} onChange={(event) => set({ y: Number(event.target.value) })} /></label>
    </div>
    <div className="transform-actions-panel">
      <button type="button" onClick={() => onChange(centerAnchor(asset.width, asset.height))}>Center</button>
      <button type="button" disabled={!asset.anchor} onClick={() => onChange(null)}>Use node pivot</button>
    </div>
    <p className="node-edit-hint">The anchor pixel is drawn on the node origin. {asset.anchor ? 'Changing the crop keeps it on the same source pixel.' : 'This sprite follows its node pivot until you set an anchor.'}</p>
  </>;
}

interface PropertiesPanelProps {
  onEditAsset: (assetId: string) => void;
}

export function PropertiesPanel({ onEditAsset }: PropertiesPanelProps) {
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const singleReplacementRef = useRef<HTMLInputElement>(null);
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId);
  const selectedAssetId = useProjectStore((state) => state.selectedAssetId);
  const selectedAssetIds = useProjectStore((state) => state.selectedAssetIds);
  const node = useProjectStore((state) => selectedNodeId ? state.nodes[selectedNodeId] : null);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const currentFrame = useProjectStore((state) => state.frames[state.currentFrameIndex]);
  const frameCount = useProjectStore((state) => state.frames.length);
  const selectedFrameCount = useProjectStore((state) => inspectorFrameIds(state).length);
  const beginTransform = useProjectStore((state) => state.beginInspectorEdit);
  const updateNodeFrame = useProjectStore((state) => state.updateInspectorFrame);
  const syncNodeFrameToAllFrames = useProjectStore((state) => state.syncNodeFrameToAllFrames);
  const commitTransform = useProjectStore((state) => state.commitInspectorEdit);
  const setNodeAsset = useProjectStore((state) => state.setNodeAsset);
  const flipNode = useProjectStore((state) => state.flipNode);
  const resetNodeTransform = useProjectStore((state) => state.resetNodeTransform);
  const addNodeSprites = useProjectStore((state) => state.addNodeSprites);
  const removeNodeSprite = useProjectStore((state) => state.removeNodeSprite);
  const setNodeFrameSprite = (nodeId: string, imageIndex: number) => {
    beginTransform(nodeId);
    updateNodeFrame(nodeId, { imageIndex });
    commitTransform();
  };
  const renameNode = useProjectStore((state) => state.renameNode);
  const createNodeForAsset = useProjectStore((state) => state.createNodeForAsset);
  const deleteAsset = useProjectStore((state) => state.deleteAsset);
  const replaceAssets = useProjectStore((state) => state.replaceAssets);
  const setAssetAnchor = useProjectStore((state) => state.setAssetAnchor);
  const assetsById = useProjectStore((state) => state.assets);
  const allAssets = useMemo(() => Object.values(assetsById), [assetsById]);
  const sources = useMemo(() => importedSources(allAssets), [allAssets]);
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
  const [sourceDraft, setSourceDraft] = useState<SpriteSource | null>(null);
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
  const selectedAnchorSource = selectedAsset?.anchor && selectedAsset.slice
    ? { x: selectedAsset.slice.x + selectedAsset.anchor.x, y: selectedAsset.slice.y + selectedAsset.anchor.y }
    : null;

  useEffect(() => {
    setDraftName(node?.name ?? '');
    setIsSpritePickerOpen(false);
    setPendingSpriteIds([]);
  }, [node?.id, node?.name]);

  useEffect(() => {
    setAssetMessage('');
  }, [selectedAssetId, selectedAssetIds.length]);

  useEffect(() => {
    setSourceDraft(selectedAsset ? assetSource(selectedAsset) : null);
    setSliceDraft(selectedAsset ? { ...(selectedAsset.slice ?? { x: 0, y: 0, width: selectedAsset.width, height: selectedAsset.height }) } : null);
  }, [selectedAsset]);

  const replaceSource = async (files: FileList | null) => {
    if (!selectedAsset?.source || !files?.length) return;
    setIsReplacing(true);
    setAssetMessage('Preparing replacement image...');
    try {
      const snapshot = useProjectStore.getState().assets;
      const candidates = await filesToImportCandidates(Array.from(files));
      if (candidates.length !== 1) throw new Error('Choose exactly one PNG replacement image.');
      const refreshed = await replaceAssetsFromSource(allAssets, selectedAsset.source.id, candidates[0]);
      if (useProjectStore.getState().assets !== snapshot) throw new Error('Images changed. Please retry the replacement.');
      replaceAssets(refreshed);
      setAssetMessage(`Updated ${refreshed.length} linked slice${refreshed.length === 1 ? '' : 's'} without changing node bindings.`);
    } catch (error) {
      setAssetMessage(error instanceof Error ? error.message : 'Could not replace the source image.');
    } finally {
      setIsReplacing(false);
    }
  };

  const chooseSource = (source: SpriteSource) => {
    setSourceDraft(source);
    setSliceDraft((current) => clampSlice(current ?? { x: 0, y: 0, width: source.width, height: source.height }, source.width, source.height));
    setAssetMessage('Preview only — apply the crop to update this sprite. Other sprites are unchanged.');
  };
  const chooseNewSingleSource = async (files: FileList | null) => {
    if (!files?.length || !selectedAsset) return;
    const targetId = selectedAsset.id;
    setIsReplacing(true);
    try {
      const [candidate] = await filesToImportCandidates(Array.from(files));
      if (!candidate) throw new Error('Choose a PNG.');
      if (useProjectStore.getState().selectedAssetId !== targetId) return;
      chooseSource(sourceFor(candidate));
    } catch (reason) { setAssetMessage(reason instanceof Error ? reason.message : 'Could not read PNG.'); }
    finally { setIsReplacing(false); }
  };

  const applySlice = async () => {
    if (!selectedAsset || !sourceDraft || !sliceDraft) return;
    setIsUpdatingSlice(true);
    setAssetMessage('Updating linked sprite region...');
    try {
      const snapshot = useProjectStore.getState().assets;
      const previousSlice = selectedAsset.slice ?? { x: 0, y: 0, width: selectedAsset.width, height: selectedAsset.height };
      // A sprite that still follows its node pivot keeps that alignment after the first crop.
      const fallbackAnchor = node && !selectedAsset.anchor && nodeAsset?.id === selectedAsset.id ? node.pivot : null;
      const updated = await rebindAssetSource(selectedAsset, sourceDraft, sliceDraft);
      if (useProjectStore.getState().assets !== snapshot) throw new Error('Images changed. Please retry applying the crop.');
      const next = updated.anchor || !fallbackAnchor || !updated.slice
        ? updated
        : { ...updated, anchor: remapAnchorForCrop(fallbackAnchor, previousSlice, updated.slice) };
      replaceAssets([next]);
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
      <input ref={singleReplacementRef} type="file" accept="image/png,.png" hidden onChange={(event) => { void chooseNewSingleSource(event.target.files); event.currentTarget.value = ''; }} />
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
          {sourceDraft && sliceDraft && <div className="property-group">
            <h3>Source PNG crop</h3>
            <label className="node-asset-select">PNG for this sprite<select disabled={isReplacing || isUpdatingSlice} value={sourceDraft.id} onChange={(event) => { const source = sources.find((item) => item.id === event.target.value); if (source) chooseSource(source); }}>{!sources.some((source) => source.id === sourceDraft.id) && <option value={sourceDraft.id}>{sourceDraft.name} (new PNG)</option>}{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
            <button type="button" className="apply-slice-button" disabled={isReplacing || isUpdatingSlice} onClick={() => singleReplacementRef.current?.click()}>Choose new PNG for this sprite…</button>
            <SourceCropEditor source={sourceDraft} slice={sliceDraft} anchorSource={selectedAnchorSource} onChange={setSliceDraft} />
            <button className="apply-slice-button" type="button" disabled={isUpdatingSlice || isReplacing} onClick={() => void applySlice()}>{isUpdatingSlice ? 'Updating crop...' : 'Apply source & crop'}</button>
            <p className="source-image-caption">Only this sprite changes. Its node bindings and animation frames stay linked.</p>
          </div>}
          <div className="property-group">
            <h3>Sprite anchor</h3>
            {selectedAsset.anchor
              ? <SpriteAnchorEditor asset={selectedAsset} fallback={{ x: 0, y: 0 }} onChange={(anchor) => setAssetAnchor(selectedAsset.id, anchor)} />
              : <>
                  <Pair label="Anchor" value="Node pivot (default)" />
                  <div className="transform-actions-panel">
                    <button type="button" onClick={() => setAssetAnchor(selectedAsset.id, centerAnchor(selectedAsset.width, selectedAsset.height))}>Center</button>
                  </div>
                  <p className="node-edit-hint">Set an anchor to align this sprite by a fixed pixel instead of its node pivot.</p>
                </>}
          </div>
          <div className="property-group asset-management-actions">
            <h3>Actions</h3>
            <button className="add-sprite-button" type="button" onClick={() => createNodeForAsset(selectedAsset.id)}><Icon name="plus" /> Add to canvas</button>
            {node && <button className="apply-sprite-button" type="button" onClick={() => setNodeAsset(node.id, selectedAsset.id)}>Apply to “{node.name}”</button>}
            <button className="edit-sprite-button" type="button" onClick={() => onEditAsset(selectedAsset.id)}>{isWholeSourceSheet ? 'Edit sprite sheet' : 'Edit pixels'}</button>
            {selectedAsset.source && <button className="replace-source-button" type="button" disabled={isReplacing || isUpdatingSlice} onClick={() => replacementInputRef.current?.click()}><Icon name="import" size={13} /> {isReplacing ? 'Replacing source...' : 'Replace entire source sheet…'}</button>}
            <p className={assetMessage.startsWith('Updated') ? 'asset-message success' : 'asset-message'}>{assetMessage || 'Replacing the entire sheet refreshes all linked slices; choosing a PNG above changes only this sprite.'}</p>
            <button className="delete-sprite-button" type="button" onClick={() => { if (window.confirm(`Delete ${selectedAsset.name}? Nodes using it will keep an empty sprite slot.`)) deleteAsset(selectedAsset.id); }}><Icon name="trash" size={13} /> Delete sprite</button>
          </div>
        </div>
      ) : node ? (
        <div className="properties-content">
          <div className="selection-title"><span className="node-swatch" /> <div><strong>{node.name}</strong><small>Sprite node</small></div></div>
          {selectedFrameCount > 1 && <p className="batch-frame-notice">{selectedFrameCount} frames selected. Values shown are from frame {currentFrameIndex + 1}; edited fields apply to every selected frame.</p>}
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
            <p className="node-edit-hint">Click a sprite to use it on the {selectedFrameCount > 1 ? 'selected frames' : 'current frame'}.</p>
          </div>
          <div className="property-group">
            <h3>Sprite anchor <span>{nodeAsset ? nodeAsset.name : 'No sprite'}</span></h3>
            {nodeAsset
              ? <SpriteAnchorEditor asset={nodeAsset} fallback={node.pivot} onChange={(anchor) => setAssetAnchor(nodeAsset.id, anchor)} />
              : <p className="node-edit-hint">Assign a sprite to set its anchor.</p>}
          </div>
          <div className="property-group node-edit-group">
            <h3>Sorting order <span>Frame {currentFrameIndex + 1}</span></h3>
            <label className="node-name-input">Layer order<input type="number" step="1" value={transform.sortingOrder} onFocus={() => beginTransform(node.id)} onChange={(event) => updateNodeFrame(node.id, { sortingOrder: Math.round(Number(event.target.value) || 0) })} onBlur={commitTransform} /></label>
            <p className="node-edit-hint">Higher values draw in front. Changes apply to the selected frames.</p>
          </div>
          <div className="property-group">
            <h3>Node pivot</h3>
            <Pair label="X" value={`${node.pivot.x} px`} />
            <Pair label="Y" value={`${node.pivot.y} px`} />
            <p className="node-edit-hint">Fallback anchor and rotation origin for sprites without their own anchor. Use the pivot tool (P) to move it.</p>
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
            <label className="node-edit-hint"><input type="checkbox" checked={transform.visible} onChange={(event) => { beginTransform(node.id); updateNodeFrame(node.id, { visible: event.target.checked }); commitTransform(); }} /> Visible on selected frames</label>
            <button
              className="sync-frame-properties-button"
              type="button"
              disabled={frameCount < 2 || node.locked}
              onClick={() => {
                if (window.confirm(`Copy all properties for “${node.name}” from frame ${currentFrameIndex + 1} to all ${frameCount} frames? You can undo this once with Ctrl+Z.`)) {
                  syncNodeFrameToAllFrames(node.id);
                }
              }}
            ><Icon name="copy" size={13} /> Sync current frame to all frames</button>
            <p className="node-edit-hint">Copies position, rotation, scale, visibility, selected sprite, and sorting order for this node.</p>
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
