import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import type { SpriteImportCandidate } from '../utils/importPng';

interface SpriteSheetImportDialogProps {
  candidate: SpriteImportCandidate;
  queueLength: number;
  onImport: (mode: 'single' | 'automatic' | 'grid', tileWidth: number, tileHeight: number) => void;
  onCancel: () => void;
  isImporting: boolean;
}

function suggestedSize(candidate: SpriteImportCandidate) {
  return candidate.width % 32 === 0 && candidate.height % 32 === 0 ? 32 : candidate.width;
}

export function SpriteSheetImportDialog({ candidate, queueLength, onImport, onCancel, isImporting }: SpriteSheetImportDialogProps) {
  const [mode, setMode] = useState<'single' | 'automatic' | 'grid'>('single');
  const [tileWidth, setTileWidth] = useState(suggestedSize(candidate));
  const [tileHeight, setTileHeight] = useState(candidate.width % 32 === 0 && candidate.height % 32 === 0 ? 32 : candidate.height);

  useEffect(() => {
    setMode('single');
    setTileWidth(suggestedSize(candidate));
    setTileHeight(candidate.width % 32 === 0 && candidate.height % 32 === 0 ? 32 : candidate.height);
  }, [candidate]);

  const columns = Math.floor(candidate.width / Math.max(1, tileWidth));
  const rows = Math.floor(candidate.height / Math.max(1, tileHeight));
  const total = columns * rows;
  const hasRemainder = candidate.width % Math.max(1, tileWidth) !== 0 || candidate.height % Math.max(1, tileHeight) !== 0;

  return (
    <div className="sprite-import-overlay" role="dialog" aria-modal="true" aria-label="Import sprite sheet">
      <section className="sprite-import-dialog">
        <header><div><span className="sprite-import-mark"><Icon name="grid" /></span><div><strong>Import PNG</strong><small>{candidate.name} - {candidate.width} x {candidate.height} px{queueLength > 1 ? ` - ${queueLength} files queued` : ''}</small></div></div><button type="button" onClick={onCancel}>Cancel</button></header>
        <div className="sprite-import-content">
          <div className="sprite-import-preview"><img src={candidate.src} alt="Sprite sheet preview" /></div>
          <div className="slice-mode-buttons">
            <button type="button" className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}><Icon name="image" /> One sprite<span>Keep the PNG as one reusable sprite.</span></button>
            <button type="button" className={mode === 'automatic' ? 'active' : ''} onClick={() => setMode('automatic')}><Icon name="target" /> Auto-detect parts<span>Find isolated opaque areas separated by transparency.</span></button>
            <button type="button" className={mode === 'grid' ? 'active' : ''} onClick={() => setMode('grid')}><Icon name="grid" /> Manual grid<span>Choose the width and height of each tile.</span></button>
          </div>
          {mode === 'grid' && <div className="slice-controls">
            <label>Tile width<input type="number" min="1" max={candidate.width} value={tileWidth} onChange={(event) => setTileWidth(Math.max(1, Number(event.target.value)))} /></label>
            <label>Tile height<input type="number" min="1" max={candidate.height} value={tileHeight} onChange={(event) => setTileHeight(Math.max(1, Number(event.target.value)))} /></label>
            <p><strong>{columns} x {rows} = {total} sprites</strong>{hasRemainder && <span> Edge pixels outside the grid will be ignored.</span>}</p>
          </div>}
        </div>
        <footer><span>{mode === 'single' ? 'The original PNG will be preserved.' : mode === 'automatic' ? 'Each transparent-background component becomes a separate PNG.' : `Each ${tileWidth} x ${tileHeight} tile becomes a PNG asset.`}</span><button type="button" disabled={isImporting || (mode === 'grid' && !total)} onClick={() => onImport(mode, mode === 'single' ? candidate.width : tileWidth, mode === 'single' ? candidate.height : tileHeight)}>{isImporting ? 'Importing...' : mode === 'single' ? 'Import sprite' : mode === 'automatic' ? 'Detect and import parts' : `Import ${total} sprites`}</button></footer>
      </section>
    </div>
  );
}
