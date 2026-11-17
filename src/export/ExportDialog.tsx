import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import type { AnimationFrame } from '../types/project';
import { canvasToPngBlob, framePixels, renderAllFrames, selectFrameEntries, type ExportFrameMode, type ExportLayerSource, type RenderableProject } from './animationRenderer';
import { encodeApng } from './apngEncoder';
import { encodeGif } from './gifEncoder';
import { animationDataFile, projectFile, type SerializableProject } from './projectSerializer';
import { saveExportFile, saveExportFrames, type ExportWriteResult } from './nativeSave';

interface ExportDialogProps {
  onClose: () => void;
}

function snapshotProject(selectedFrames?: AnimationFrame[]): SerializableProject {
  const state = useProjectStore.getState();
  return {
    assets: state.assets,
    nodes: state.nodes,
    rootNodeIds: state.rootNodeIds,
    settings: state.settings,
    frames: selectedFrames ?? state.frames,
    fps: state.fps,
    isLooping: state.isLooping,
  };
}

function jsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
}

/** Turns the project name into a file-name stem, falling back to the previous default. */
function fileStem(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled-character';
}

function frameNumber(index: number) {
  return String(index + 1).padStart(3, '0');
}

function clampFrameNumber(value: number, frameCount: number) {
  return Math.min(Math.max(1, Math.round(Number.isFinite(value) ? value : 1)), Math.max(1, frameCount));
}

interface SpriteSheetLayout {
  columns: number;
  rows: number;
  gap: number;
  padding: number;
  frameWidth: number;
  frameHeight: number;
}

function safeLayoutValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(Number.isFinite(value) ? value : minimum)));
}

interface CellSize {
  width: number;
  height: number;
}

function minimumCellSize(frames: HTMLCanvasElement[]): CellSize {
  let width = 1;
  let height = 1;
  frames.forEach((frame) => {
    const context = frame.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const pixels = context.getImageData(0, 0, frame.width, frame.height).data;
    let minX = frame.width;
    let minY = frame.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        if (pixels[(y * frame.width + x) * 4 + 3] === 0) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0 || maxY < 0) return;
    const centerX = frame.width / 2;
    const centerY = frame.height / 2;
    width = Math.max(width, Math.ceil(2 * Math.max(centerX - minX, maxX + 1 - centerX)));
    height = Math.max(height, Math.ceil(2 * Math.max(centerY - minY, maxY + 1 - centerY)));
  });
  return { width, height };
}

async function createSpriteSheet(project: RenderableProject, layout: SpriteSheetLayout, source: ExportLayerSource) {
  const frames = await renderAllFrames(project, source);
  const columns = safeLayoutValue(layout.columns, 1, 99);
  const rows = safeLayoutValue(layout.rows, 1, 99);
  const gap = safeLayoutValue(layout.gap, 0, 256);
  const padding = safeLayoutValue(layout.padding, 0, 256);
  if (columns * rows < frames.length) throw new Error(`The ${columns} × ${rows} layout only has room for ${columns * rows} frames.`);
  const minimum = minimumCellSize(frames);
  const frameWidth = safeLayoutValue(layout.frameWidth, minimum.width, 8192);
  const frameHeight = safeLayoutValue(layout.frameHeight, minimum.height, 8192);
  const sheet = document.createElement('canvas');
  sheet.width = padding * 2 + columns * frameWidth + Math.max(0, columns - 1) * gap;
  sheet.height = padding * 2 + rows * frameHeight + Math.max(0, rows - 1) * gap;
  const context = sheet.getContext('2d');
  if (!context) throw new Error('The sprite sheet could not be created.');
  context.imageSmoothingEnabled = false;
  frames.forEach((frame, index) => {
    const x = padding + (index % columns) * (frameWidth + gap);
    const y = padding + Math.floor(index / columns) * (frameHeight + gap);
    context.drawImage(frame, x + Math.floor((frameWidth - frame.width) / 2), y + Math.floor((frameHeight - frame.height) / 2));
  });
  return { sheet, minimum, frameWidth, frameHeight };
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const frames = useProjectStore((state) => state.frames);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const fps = useProjectStore((state) => state.fps);
  const settings = useProjectStore((state) => state.settings);
  const assets = useProjectStore((state) => state.assets);
  const nodes = useProjectStore((state) => state.nodes);
  const projectName = useProjectStore((state) => state.projectName);
  const frameGroups = useMemo(
    () => Array.from(new Map(frames.flatMap((frame) => frame.group ? [[frame.group.id, frame.group] as const] : [])).values()),
    [frames],
  );
  const [selectionMode, setSelectionMode] = useState<ExportFrameMode>('all');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => frameGroups[0]?.id ?? null);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(() => Math.max(1, frames.length));
  const selectedEntries = useMemo(() => selectFrameEntries(frames, {
    mode: selectionMode,
    frameGroupId: selectedGroupId,
    currentIndex: currentFrameIndex,
    start: rangeStart,
    end: rangeEnd,
  }), [currentFrameIndex, frames, rangeEnd, rangeStart, selectedGroupId, selectionMode]);
  const selectedFrames = useMemo(() => selectedEntries.map((entry) => entry.frame), [selectedEntries]);
  const selectedGroup = selectionMode === 'group' ? frameGroups.find((group) => group.id === selectedGroupId) ?? null : null;
  const frameCount = selectedEntries.length;
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState('Choose an output format.');
  const [columns, setColumns] = useState(() => Math.max(1, Math.ceil(Math.sqrt(frames.length))));
  const [rows, setRows] = useState(() => Math.max(1, Math.ceil(frames.length / Math.max(1, Math.ceil(Math.sqrt(frames.length))))));
  const [gap, setGap] = useState(0);
  const [padding, setPadding] = useState(0);
  const [frameWidth, setFrameWidth] = useState(() => settings.canvasSize.x);
  const [frameHeight, setFrameHeight] = useState(() => settings.canvasSize.y);
  const [minimumFrameSize, setMinimumFrameSize] = useState<CellSize | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(true);
  const [layerSource, setLayerSource] = useState<ExportLayerSource>('nodes');

  const baseName = fileStem(projectName);
  const rangeLow = Math.min(rangeStart, rangeEnd);
  const rangeHigh = Math.max(rangeStart, rangeEnd);
  const selectionSuffix = selectionMode === 'range'
    ? `-${frameNumber(rangeLow - 1)}-${frameNumber(rangeHigh - 1)}`
    : selectionMode === 'current'
      ? `-frame-${frameNumber(currentFrameIndex)}`
      : '';

  const run = async (label: string, action: (project: SerializableProject) => Promise<ExportWriteResult>) => {
    setIsExporting(true);
    setStatus(`Preparing ${label}...`);
    try {
      const result = await action(snapshotProject(selectedFrames));
      setStatus(result === 'cancelled' ? `${label} cancelled.` : result === 'saved' ? `${label} saved to the chosen location.` : `${label} download started.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} export failed.`);
    } finally {
      setIsExporting(false);
    }
  };

  const layout: SpriteSheetLayout = { columns, rows, gap, padding, frameWidth, frameHeight };
  const layoutIsValid = columns * rows >= frameCount;

  useEffect(() => {
    const nextColumns = Math.max(1, Math.ceil(Math.sqrt(frameCount)));
    setColumns(nextColumns);
    setRows(Math.max(1, Math.ceil(frameCount / nextColumns)));
  }, [frameCount]);

  useEffect(() => {
    if (selectionMode === 'group' && !frameGroups.length) setSelectionMode('all');
  }, [frameGroups.length, selectionMode]);

  useEffect(() => {
    if (selectedGroupId && !frameGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(frameGroups[0]?.id ?? null);
    }
  }, [frameGroups, selectedGroupId]);

  const selectionSummary = selectionMode === 'current'
    ? `Only frame ${currentFrameIndex + 1} of ${frames.length} will be exported.`
    : selectionMode === 'range'
      ? `Frames ${rangeLow}–${rangeHigh} (${frameCount} of ${frames.length}) will be exported.`
      : selectionMode === 'group' && selectedGroup
        ? `Only “${selectedGroup.name}” (${frameCount} of ${frames.length} frames) will be exported.`
        : `Every timeline frame (${frameCount}) will be exported.`;

  useEffect(() => {
    let cancelled = false;
    let urlToRelease: string | null = null;
    const project = snapshotProject(selectedFrames);
    if (!layoutIsValid) {
      setPreviewUrl(null);
      setPreviewSize(null);
      setIsPreviewing(false);
      return undefined;
    }
    setIsPreviewing(true);
    void createSpriteSheet(project, layout, layerSource).then(async ({ sheet, minimum }) => {
      const blob = await canvasToPngBlob(sheet);
      if (cancelled) return;
      urlToRelease = URL.createObjectURL(blob);
      setPreviewUrl(urlToRelease);
      setPreviewSize({ width: sheet.width, height: sheet.height });
      setMinimumFrameSize(minimum);
      setFrameWidth((value) => Math.max(value, minimum.width));
      setFrameHeight((value) => Math.max(value, minimum.height));
    }).catch(() => {
      if (!cancelled) {
        setPreviewUrl(null);
        setPreviewSize(null);
      }
    }).finally(() => {
      if (!cancelled) setIsPreviewing(false);
    });
    return () => {
      cancelled = true;
      if (urlToRelease) URL.revokeObjectURL(urlToRelease);
    };
  }, [assets, columns, frameHeight, frameWidth, gap, layerSource, layoutIsValid, nodes, padding, rows, selectedFrames, settings]);

  const exportSheet = () => run('PNG sprite sheet', async (project: RenderableProject) => {
    const { sheet } = await createSpriteSheet(project, layout, layerSource);
    return saveExportFile({ blob: await canvasToPngBlob(sheet), name: `${baseName}${selectionSuffix}-sheet.png` }, { name: 'PNG image', extensions: ['png'] });
  });

  /** Exports exactly the frame shown on the canvas, whatever the frame-range selection says. */
  const exportCurrentFrame = () => {
    const state = useProjectStore.getState();
    const index = state.currentFrameIndex;
    const frame = state.frames[index];
    if (!frame) return;
    void run(`frame ${index + 1} PNG`, async () => {
      const [canvas] = await renderAllFrames(snapshotProject([frame]), layerSource);
      return saveExportFile(
        { blob: await canvasToPngBlob(canvas), name: `${baseName}-frame-${frameNumber(index)}.png` },
        { name: 'PNG image', extensions: ['png'] },
      );
    });
  };

  return (
    <div className="export-overlay" role="dialog" aria-modal="true" aria-label="Export animation">
      <section className="export-dialog">
        <header><div><span className="export-mark"><Icon name="keyframe" /></span><div><strong>Export animation</strong><small>{frameCount} frame{frameCount === 1 ? '' : 's'} - {settings.canvasSize.x} x {settings.canvasSize.y} - {fps} FPS</small></div></div><button type="button" onClick={onClose}>Close</button></header>
        <div className="export-content">
          <p className="export-intro">All raster exports use the crisp pixel renderer without smoothing. PNG exports preserve transparency. Sprite sheets, individual frames, GIF, APNG and animation JSON all follow the frame selection below.</p>
          <section className="export-frame-range" aria-label="Export frame range">
            <div><strong>Frames to export</strong><small>Export the complete timeline, the current frame, one group, or a range of frames.</small></div>
            <label>
              <span>Frame source</span>
              <select value={selectionMode} onChange={(event) => setSelectionMode(event.target.value as ExportFrameMode)}>
                <option value="all">All frames ({frames.length})</option>
                <option value="current">Current frame ({currentFrameIndex + 1})</option>
                <option value="group" disabled={!frameGroups.length}>Frame group</option>
                <option value="range">Frame range</option>
              </select>
            </label>
            {selectionMode === 'group' ? (
              <label>
                <span>Group</span>
                <select value={selectedGroupId ?? ''} onChange={(event) => setSelectedGroupId(event.target.value || null)}>
                  {frameGroups.map((group) => {
                    const count = frames.filter((frame) => frame.group?.id === group.id).length;
                    return <option key={group.id} value={group.id}>{group.name} ({count})</option>;
                  })}
                </select>
              </label>
            ) : selectionMode === 'range' ? (
              <div className="export-range-inputs">
                <label>From<input type="number" min={1} max={frames.length} value={rangeStart} onChange={(event) => setRangeStart(clampFrameNumber(Number(event.target.value), frames.length))} /></label>
                <label>To<input type="number" min={1} max={frames.length} value={rangeEnd} onChange={(event) => setRangeEnd(clampFrameNumber(Number(event.target.value), frames.length))} /></label>
              </div>
            ) : (
              <span className="export-frame-range-hint">{selectionMode === 'current' ? `Frame ${currentFrameIndex + 1} of ${frames.length}` : `${frames.length} frames`}</span>
            )}
            <span className="export-frame-range-summary" style={selectedGroup ? { '--export-group-color': selectedGroup.color } as CSSProperties : undefined}>
              {selectedGroup ? <i /> : null}{selectionSummary}
            </span>
          </section>
          <section className="export-layer-source" aria-label="Export layer source">
            <div><strong>Export content</strong><small>Choose which workspace contributes pixels to every image and animation export.</small></div>
            <button className={layerSource === 'nodes' ? 'active' : ''} type="button" onClick={() => setLayerSource('nodes')}><Icon name="layers" /><span><strong>Node layers</strong><small>Rigged sprites only</small></span></button>
            <button className={layerSource === 'canvas' ? 'active' : ''} type="button" onClick={() => setLayerSource('canvas')}><Icon name="pixel" /><span><strong>Drawing canvas</strong><small>Frame drawings only</small></span></button>
            <button className={layerSource === 'combined' ? 'active' : ''} type="button" onClick={() => setLayerSource('combined')}><Icon name="image" /><span><strong>Combined</strong><small>Drawing over node layers</small></span></button>
          </section>
          <section className="sprite-sheet-export-options" aria-label="Sprite sheet layout">
            <div className="sprite-sheet-layout-controls">
              <div><strong>Sprite sheet layout</strong><small>Frame order fills left to right, then top to bottom. Minimum safe frame: {minimumFrameSize ? `${minimumFrameSize.width} × ${minimumFrameSize.height} px` : 'calculating...'}</small></div>
              <label>Columns<input type="number" min="1" max="99" value={columns} onChange={(event) => setColumns(safeLayoutValue(Number(event.target.value), 1, 99))} /></label>
              <label>Rows<input type="number" min="1" max="99" value={rows} onChange={(event) => setRows(safeLayoutValue(Number(event.target.value), 1, 99))} /></label>
              <label>Gap<input type="number" min="0" max="256" value={gap} onChange={(event) => setGap(safeLayoutValue(Number(event.target.value), 0, 256))} /></label>
              <label>Outer padding<input type="number" min="0" max="256" value={padding} onChange={(event) => setPadding(safeLayoutValue(Number(event.target.value), 0, 256))} /></label>
              <label>Frame width<input type="number" min={minimumFrameSize?.width ?? 1} max="8192" value={frameWidth} onChange={(event) => setFrameWidth(safeLayoutValue(Math.max(minimumFrameSize?.width ?? 1, Number(event.target.value)), 1, 8192))} /></label>
              <label>Frame height<input type="number" min={minimumFrameSize?.height ?? 1} max="8192" value={frameHeight} onChange={(event) => setFrameHeight(safeLayoutValue(Math.max(minimumFrameSize?.height ?? 1, Number(event.target.value)), 1, 8192))} /></label>
            </div>
            <div className="sprite-sheet-preview">
              <div><strong>PNG preview</strong><span>{previewSize ? `${previewSize.width} × ${previewSize.height} px` : isPreviewing ? 'Rendering preview...' : 'Preview unavailable'}</span></div>
              {!layoutIsValid ? <p className="export-error">Increase rows or columns: {frameCount} frames need more than {columns * rows} slots.</p> : previewUrl ? <div className="sprite-sheet-preview-image"><img src={previewUrl} alt="Sprite sheet PNG preview" /></div> : <div className="sprite-sheet-preview-empty">{isPreviewing ? 'Rendering preview...' : 'Preview unavailable'}</div>}
            </div>
          </section>
          <div className="export-grid">
            <button type="button" disabled={isExporting || !layoutIsValid} onClick={() => void exportSheet()}><Icon name="grid" /><strong>PNG sprite sheet</strong><span>Export the configured layout.</span></button>
            <button type="button" disabled={isExporting} onClick={() => void run('individual PNG frames', async (project) => { const rendered = await renderAllFrames(project, layerSource); return saveExportFrames(await Promise.all(rendered.map(async (frame, offset) => ({ blob: await canvasToPngBlob(frame), name: `${baseName}-${frameNumber(selectedEntries[offset]?.index ?? offset)}.png` })))); })}><Icon name="image" /><strong>Individual frames</strong><span>Choose a folder for every selected PNG.</span></button>
            <button type="button" disabled={isExporting} onClick={() => void run('GIF animation', async (project) => { const rendered = await renderAllFrames(project, layerSource); return saveExportFile({ blob: encodeGif(rendered.map((frame) => ({ width: frame.width, height: frame.height, pixels: framePixels(frame) })), project.fps), name: `${baseName}${selectionSuffix}.gif` }, { name: 'GIF animation', extensions: ['gif'] }); })}><Icon name="play" /><strong>Animated GIF</strong><span>Looping 256-color GIF of the selected frames.</span></button>
            <button type="button" disabled={isExporting} onClick={() => void run('animated PNG', async (project) => { const rendered = await renderAllFrames(project, layerSource); return saveExportFile({ blob: await encodeApng(rendered.map((frame) => ({ width: frame.width, height: frame.height, pixels: framePixels(frame) })), project.fps), name: `${baseName}${selectionSuffix}.png` }, { name: 'Animated PNG', extensions: ['png'] }); })}><Icon name="layers" /><strong>Animated PNG</strong><span>RGBA animation with alpha support.</span></button>
            <button className="export-current-frame" type="button" disabled={isExporting} onClick={exportCurrentFrame}><Icon name="image" /><strong>Current frame PNG</strong><span>Export only frame {currentFrameIndex + 1} at {settings.canvasSize.x} × {settings.canvasSize.y} px, ignoring the frame selection.</span></button>
          </div>
          <div className="export-data-row">
            <button type="button" disabled={isExporting} onClick={() => void run('animation JSON', async (project) => saveExportFile({ blob: jsonBlob(animationDataFile(project)), name: `${baseName}${selectionSuffix}.animation.json` }, { name: 'JSON data', extensions: ['json'] }))}><Icon name="keyframe" /> JSON animation data</button>
            <button type="button" disabled={isExporting} onClick={() => void run('project JSON', async () => saveExportFile({ blob: jsonBlob(projectFile(snapshotProject())), name: `${baseName}.pixelrig.json` }, { name: 'Pixel Rig project', extensions: ['json'] }))}><Icon name="download" /> Save complete project JSON</button>
          </div>
        </div>
        <footer><span className={status.includes('failed') || status.includes('could not') || status.includes('needs') ? 'export-error' : ''}>{status}</span><span>{isExporting ? 'Working...' : 'Ready'}</span></footer>
      </section>
    </div>
  );
}
