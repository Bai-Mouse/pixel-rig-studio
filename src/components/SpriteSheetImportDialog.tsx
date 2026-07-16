import { useEffect, useRef, useState, type PointerEvent } from 'react';
import '../slice-import.css';
import { Icon } from './Icon';
import { detectSpriteParts, type SpriteImportCandidate } from '../utils/importPng';
import type { SpriteSlice, Vec2 } from '../types/project';

interface SpriteSheetImportDialogProps {
  candidate: SpriteImportCandidate;
  queueLength: number;
  onImport: (slices: SpriteSlice[] | null) => void;
  onCancel: () => void;
  isImporting: boolean;
}

type SliceMode = 'single' | 'automatic' | 'manual';

interface SliceDrag {
  kind: 'create' | 'move' | 'resize';
  index: number;
  start: Vec2;
  source: SpriteSlice;
}

function bounded(value: number, maximum: number) {
  return Math.min(maximum, Math.max(0, value));
}

export function SpriteSheetImportDialog({ candidate, queueLength, onImport, onCancel, isImporting }: SpriteSheetImportDialogProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<SliceDrag | null>(null);
  const [mode, setMode] = useState<SliceMode>('single');
  const [slices, setSlices] = useState<SpriteSlice[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState('');

  useEffect(() => {
    setMode('single');
    setSlices([]);
    setSelectedIndex(null);
    setDetectionError('');
  }, [candidate]);

  useEffect(() => {
    if (mode !== 'automatic') return;
    let cancelled = false;
    setIsDetecting(true);
    setDetectionError('');
    void detectSpriteParts(candidate)
      .then((parts) => {
        if (cancelled) return;
        setSlices(parts);
        setSelectedIndex(parts.length ? 0 : null);
      })
      .catch((reason) => {
        if (!cancelled) setDetectionError(reason instanceof Error ? reason.message : 'Could not detect sprite parts.');
      })
      .finally(() => { if (!cancelled) setIsDetecting(false); });
    return () => { cancelled = true; };
  }, [candidate, mode]);

  const pointFromEvent = (event: PointerEvent<HTMLElement>): Vec2 | null => {
    const preview = previewRef.current;
    if (!preview) return null;
    const rect = preview.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: bounded(Math.floor((event.clientX - rect.left) / rect.width * candidate.width), candidate.width - 1),
      y: bounded(Math.floor((event.clientY - rect.top) / rect.height * candidate.height), candidate.height - 1),
    };
  };

  const beginSliceDrag = (event: PointerEvent<HTMLElement>, index: number, kind: SliceDrag['kind']) => {
    const point = pointFromEvent(event);
    const source = slices[index];
    if (!point || !source) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedIndex(index);
    dragRef.current = { kind, index, start: point, source };
  };

  const beginSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (mode === 'single') return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const slice: SpriteSlice = { x: point.x, y: point.y, width: 1, height: 1 };
    setSlices((current) => [...current, slice]);
    setSelectedIndex(slices.length);
    dragRef.current = { kind: 'create', index: slices.length, start: point, source: slice };
  };

  const updateSelection = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const point = pointFromEvent(event);
    if (!drag || !point) return;
    setSlices((current) => {
      const slice = current[drag.index];
      if (!slice) return current;
      if (drag.kind === 'create') {
        const x = Math.min(drag.start.x, point.x);
        const y = Math.min(drag.start.y, point.y);
        return current.map((item, index) => index === drag.index
          ? { x, y, width: Math.abs(point.x - drag.start.x) + 1, height: Math.abs(point.y - drag.start.y) + 1 }
          : item);
      }
      if (drag.kind === 'move') {
        const x = Math.min(candidate.width - drag.source.width, Math.max(0, drag.source.x + point.x - drag.start.x));
        const y = Math.min(candidate.height - drag.source.height, Math.max(0, drag.source.y + point.y - drag.start.y));
        return current.map((item, index) => index === drag.index ? { ...item, x, y, mask: undefined } : item);
      }
      const width = Math.min(candidate.width - drag.source.x, Math.max(1, point.x - drag.source.x + 1));
      const height = Math.min(candidate.height - drag.source.y, Math.max(1, point.y - drag.source.y + 1));
      return current.map((item, index) => index === drag.index ? { ...item, width, height, mask: undefined } : item);
    });
  };

  const endSelection = () => { dragRef.current = null; };
  const deleteSelection = () => {
    if (selectedIndex === null) return;
    setSlices((current) => current.filter((_, index) => index !== selectedIndex));
    setSelectedIndex(null);
  };

  const switchMode = (nextMode: SliceMode) => {
    if (nextMode === 'manual' && mode === 'single') {
      setSlices([]);
      setSelectedIndex(null);
    }
    setMode(nextMode);
  };

  const selected = selectedIndex === null ? null : slices[selectedIndex] ?? null;
  const canImport = mode === 'single' || slices.length > 0;

  return (
    <div className="sprite-import-overlay" role="dialog" aria-modal="true" aria-label="Import sprite sheet">
      <section className="sprite-import-dialog slice-import-dialog">
        <header><div><span className="sprite-import-mark"><Icon name="grid" /></span><div><strong>Import PNG</strong><small>{candidate.name} - {candidate.width} x {candidate.height} px{queueLength > 1 ? ` - ${queueLength} files queued` : ''}</small></div></div><button type="button" onClick={onCancel}>Cancel</button></header>
        <div className="sprite-import-content slice-import-content">
          <div className="slice-mode-buttons">
            <button type="button" className={mode === 'single' ? 'active' : ''} onClick={() => switchMode('single')}><Icon name="image" /> One sprite<span>Keep the PNG as one reusable sprite.</span></button>
            <button type="button" className={mode === 'automatic' ? 'active' : ''} onClick={() => switchMode('automatic')}><Icon name="target" /> Auto-detect parts<span>Find parts, then drag boxes to refine them.</span></button>
            <button type="button" className={mode === 'manual' ? 'active' : ''} onClick={() => switchMode('manual')}><Icon name="grid" /> Draw selections<span>Drag directly over every part you want to cut.</span></button>
          </div>
          <div className="slice-editor-column">
            <div
              ref={previewRef}
              className={`slice-selection-editor ${mode === 'single' ? 'disabled' : ''}`}
              style={{ aspectRatio: `${candidate.width} / ${candidate.height}` }}
              onPointerDown={beginSelection}
              onPointerMove={updateSelection}
              onPointerUp={endSelection}
              onPointerCancel={endSelection}
            >
              <img src={candidate.src} alt="Sprite sheet preview" draggable={false} />
              {mode !== 'single' && slices.map((slice, index) => (
                <div
                  key={`${slice.x}-${slice.y}-${slice.width}-${slice.height}-${index}`}
                  className={`slice-selection ${selectedIndex === index ? 'selected' : ''}`}
                  style={{ left: `${slice.x / candidate.width * 100}%`, top: `${slice.y / candidate.height * 100}%`, width: `${slice.width / candidate.width * 100}%`, height: `${slice.height / candidate.height * 100}%` }}
                  onPointerDown={(event) => beginSliceDrag(event, index, 'move')}
                >
                  <span>{index + 1}</span>
                  <i className="slice-resize-handle" onPointerDown={(event) => beginSliceDrag(event, index, 'resize')} />
                </div>
              ))}
            </div>
            {mode !== 'single' && <div className="slice-selection-controls"><span>{isDetecting ? 'Detecting parts...' : `${slices.length} selection${slices.length === 1 ? '' : 's'}`}</span><button type="button" onClick={deleteSelection} disabled={selectedIndex === null}>Delete selected</button></div>}
            {selected && <p className="slice-selection-details">Selected: x {selected.x}, y {selected.y} · {selected.width} x {selected.height} px</p>}
            {mode !== 'single' && <p className="slice-editor-hint">Drag on empty space to add a box. Drag a box to move it; drag its lower-right corner to resize it.</p>}
            {detectionError && <p className="import-error">{detectionError}</p>}
          </div>
        </div>
        <footer><span>{mode === 'single' ? 'The original PNG will be preserved.' : 'Every box becomes a linked sprite that can be replaced from its source PNG later.'}</span><button type="button" disabled={isImporting || isDetecting || !canImport} onClick={() => onImport(mode === 'single' ? null : slices)}>{isImporting ? 'Importing...' : mode === 'single' ? 'Import sprite' : `Import ${slices.length} sprite${slices.length === 1 ? '' : 's'}`}</button></footer>
      </section>
    </div>
  );
}
