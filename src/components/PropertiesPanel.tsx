import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useProjectStore } from '../state/projectStore';
import { filesToImportCandidates, replaceAssetsFromSource } from '../utils/importPng';
import type { SpriteAsset } from '../types/project';

const Pair = ({ label, value }: { label: string; value: string }) => <div className="property-pair"><span>{label}</span><strong>{value}</strong></div>;

interface PropertiesPanelProps {
  onEditAsset: (assetId: string) => void;
}

export function PropertiesPanel({ onEditAsset }: PropertiesPanelProps) {
  const replacementInputRef = useRef<HTMLInputElement>(null);
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
  const setNodeAsset = useProjectStore((state) => state.setNodeAsset);
  const renameNode = useProjectStore((state) => state.renameNode);
  const createNodeForAsset = useProjectStore((state) => state.createNodeForAsset);
  const deleteAsset = useProjectStore((state) => state.deleteAsset);
  const replaceAssets = useProjectStore((state) => state.replaceAssets);
  const assetsById = useProjectStore((state) => state.assets);
  const allAssets = useMemo(() => Object.values(assetsById), [assetsById]);
  const selectedAsset = selectedAssetId ? assetsById[selectedAssetId] : null;
  const selectedAssets = selectedAssetIds.map((assetId) => assetsById[assetId]).filter((asset): asset is SpriteAsset => Boolean(asset));
  const nodeAsset = node?.assetId ? assetsById[node.assetId] : null;
  const [draftName, setDraftName] = useState('');
  const [assetMessage, setAssetMessage] = useState('');
  const [isReplacing, setIsReplacing] = useState(false);
  const frameState = node ? currentFrame?.nodeStates[node.id] : null;
  const transform = frameState ?? {
    position: node?.transform.position ?? { x: 0, y: 0 },
    rotation: node?.transform.rotation ?? 0,
    scale: node?.transform.scale ?? { x: 1, y: 1 },
    visible: node?.visible ?? true,
    imageIndex: 0,
  };

  useEffect(() => {
    setDraftName(node?.name ?? '');
  }, [node?.id, node?.name]);

  useEffect(() => {
    setAssetMessage('');
  }, [selectedAssetId, selectedAssetIds.length]);

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
            {selectedAsset.slice && <Pair label="Source region" value={`${selectedAsset.slice.x}, ${selectedAsset.slice.y} · ${selectedAsset.slice.width} x ${selectedAsset.slice.height}`} />}
          </div>
          <div className="property-group asset-management-actions">
            <h3>Actions</h3>
            <button className="add-sprite-button" type="button" onClick={() => createNodeForAsset(selectedAsset.id)}><Icon name="plus" /> Add to canvas</button>
            {node && <button className="apply-sprite-button" type="button" onClick={() => setNodeAsset(node.id, selectedAsset.id)}>Apply to “{node.name}”</button>}
            <button className="edit-sprite-button" type="button" onClick={() => onEditAsset(selectedAsset.id)}>Edit pixels</button>
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
            <h3>Sprite</h3>
            <Pair label="Image" value={nodeAsset?.name ?? 'No image'} />
            <Pair label="Size" value={nodeAsset ? `${nodeAsset.width} x ${nodeAsset.height} px` : '—'} />
            <p className="node-edit-hint">Choose an image in the left library, then use Apply to assign it to this node.</p>
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
    </aside>
  );
}
