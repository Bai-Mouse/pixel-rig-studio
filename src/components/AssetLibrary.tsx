import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { Icon } from './Icon';
import { SpriteSheetImportDialog } from './SpriteSheetImportDialog';
import { useProjectStore } from '../state/projectStore';
import { createAssetsFromCandidate, createAssetsFromDetectedParts, filesToImportCandidates, type SpriteImportCandidate } from '../utils/importPng';

export function AssetLibrary() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importQueue, setImportQueue] = useState<SpriteImportCandidate[]>([]);
  // Subscribe to the stable store object. Returning Object.values() directly
  // from a Zustand selector creates a fresh snapshot on every read, which
  // causes React 18 to continually re-render the component.
  const assetsById = useProjectStore((state) => state.assets);
  const assets = useMemo(() => Object.values(assetsById), [assetsById]);
  const folders = useProjectStore((state) => state.folders);
  const selectedAssetIds = useProjectStore((state) => state.selectedAssetIds);
  const selectAssets = useProjectStore((state) => state.selectAssets);
  const addAssets = useProjectStore((state) => state.addAssets);
  const selectionAnchorRef = useRef<string | null>(null);

  const openDialog = () => inputRef.current?.click();
  const selectFromLibrary = (event: MouseEvent<HTMLButtonElement>, assetId: string) => {
    const isToggle = event.ctrlKey || event.metaKey;
    if (event.shiftKey && selectionAnchorRef.current) {
      const start = assets.findIndex((asset) => asset.id === selectionAnchorRef.current);
      const end = assets.findIndex((asset) => asset.id === assetId);
      if (start >= 0 && end >= 0) {
        const range = assets.slice(Math.min(start, end), Math.max(start, end) + 1).map((asset) => asset.id);
        selectAssets(isToggle ? [...selectedAssetIds, ...range] : range, assetId);
        return;
      }
    }
    if (isToggle) {
      const next = selectedAssetIds.includes(assetId)
        ? selectedAssetIds.filter((id) => id !== assetId)
        : [...selectedAssetIds, assetId];
      selectAssets(next, assetId);
    } else {
      selectAssets([assetId], assetId);
    }
    selectionAnchorRef.current = assetId;
  };
  const importFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setError(null);
    setIsImporting(true);
    try {
      const candidates = await filesToImportCandidates(files);
      if (!candidates.length) throw new Error('Choose one or more PNG files.');
      setImportQueue(candidates);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  const confirmSpriteImport = async (mode: 'single' | 'automatic' | 'grid', tileWidth: number, tileHeight: number) => {
    const candidate = importQueue[0];
    if (!candidate) return;
    setError(null);
    setIsImporting(true);
    try {
      addAssets(mode === 'automatic'
        ? await createAssetsFromDetectedParts(candidate)
        : await createAssetsFromCandidate(candidate, tileWidth, tileHeight));
      setImportQueue((queue) => queue.slice(1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sprite slicing failed.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="panel asset-panel">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,.png"
        multiple
        hidden
        onChange={(event) => {
          void importFiles(event.target.files ?? []);
          event.currentTarget.value = '';
        }}
      />
      <div className="panel-heading">
        <span><Icon name="image" /> Image library</span>
        <button className="icon-button" type="button" onClick={openDialog} title="Import PNG"><Icon name="plus" /></button>
      </div>
      <div className="folder-list">
        {folders.map((folder) => <span key={folder} className={folder === 'All sprites' ? 'active-folder' : ''}>{folder}</span>)}
      </div>
      <div
        className={`asset-dropzone ${isDragging ? 'dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => { event.preventDefault(); setIsDragging(false); void importFiles(event.dataTransfer.files); }}
      >
        <button className="dropzone-button" type="button" onClick={openDialog}>
          <Icon name="import" size={18} />
          <span>{isImporting ? 'Preparing PNG...' : 'Drop PNGs or browse'}</span>
          <small>Sprite assets remain crisp at any zoom</small>
        </button>
      </div>
      {error && <p className="import-error">{error}</p>}
      <div className="asset-grid" aria-label="Imported sprites">
        {assets.map((asset) => (
          <button key={asset.id} type="button" className={`asset-card ${selectedAssetIds.includes(asset.id) ? 'selected' : ''}`} onClick={(event) => selectFromLibrary(event, asset.id)} title={`${asset.name} — Ctrl/Cmd to toggle, Shift for a range`} aria-pressed={selectedAssetIds.includes(asset.id)}>
            <span className="checkerboard"><img src={asset.src} alt="" /></span>
            <span>{asset.name.replace(/\.png$/i, '')}</span>
          </button>
        ))}
      </div>
      {importQueue[0] && <SpriteSheetImportDialog candidate={importQueue[0]} queueLength={importQueue.length} isImporting={isImporting} onImport={(mode, tileWidth, tileHeight) => void confirmSpriteImport(mode, tileWidth, tileHeight)} onCancel={() => setImportQueue([])} />}
    </section>
  );
}
