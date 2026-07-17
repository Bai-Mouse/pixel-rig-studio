import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import { canvasToPngBlob, framePixels, renderAllFrames, type RenderableProject } from './animationRenderer';
import { encodeApng } from './apngEncoder';
import { encodeGif } from './gifEncoder';
import { animationDataFile, projectFile, type SerializableProject } from './projectSerializer';
import { saveExportFile, saveExportFrames, type ExportWriteResult } from './nativeSave';

interface ExportDialogProps {
  onClose: () => void;
}

function snapshotProject(): SerializableProject {
  const state = useProjectStore.getState();
  return {
    assets: state.assets,
    nodes: state.nodes,
    rootNodeIds: state.rootNodeIds,
    settings: state.settings,
    frames: state.frames,
    fps: state.fps,
    isLooping: state.isLooping,
  };
}

function jsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
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

async function createSpriteSheet(project: RenderableProject, layout: SpriteSheetLayout) {
  const frames = await renderAllFrames(project);
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
  const frameCount = frames.length;
  const fps = useProjectStore((state) => state.fps);
  const settings = useProjectStore((state) => state.settings);
  const assets = useProjectStore((state) => state.assets);
  const nodes = useProjectStore((state) => state.nodes);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState('Choose an output format.');
  const [columns, setColumns] = useState(() => Math.max(1, Math.ceil(Math.sqrt(frameCount))));
  const [rows, setRows] = useState(() => Math.max(1, Math.ceil(frameCount / Math.ceil(Math.sqrt(frameCount)))));
  const [gap, setGap] = useState(0);
  const [padding, setPadding] = useState(0);
  const [frameWidth, setFrameWidth] = useState(() => settings.canvasSize.x);
  const [frameHeight, setFrameHeight] = useState(() => settings.canvasSize.y);
  const [minimumFrameSize, setMinimumFrameSize] = useState<CellSize | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(true);

  const run = async (label: string, action: (project: SerializableProject) => Promise<ExportWriteResult>) => {
    setIsExporting(true);
    setStatus(`Preparing ${label}...`);
    try {
      const result = await action(snapshotProject());
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
    let cancelled = false;
    let urlToRelease: string | null = null;
    const project = snapshotProject();
    if (!layoutIsValid) {
      setPreviewUrl(null);
      setPreviewSize(null);
      setIsPreviewing(false);
      return undefined;
    }
    setIsPreviewing(true);
    void createSpriteSheet(project, layout).then(async ({ sheet, minimum }) => {
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
  }, [assets, columns, frameHeight, frameWidth, frames, gap, layoutIsValid, nodes, padding, rows, settings]);

  const exportSheet = () => run('PNG sprite sheet', async (project: RenderableProject) => {
    const { sheet } = await createSpriteSheet(project, layout);
    return saveExportFile({ blob: await canvasToPngBlob(sheet), name: 'untitled-character-sheet.png' }, { name: 'PNG image', extensions: ['png'] });
  });

  return (
    <div className="export-overlay" role="dialog" aria-modal="true" aria-label="Export animation">
      <section className="export-dialog">
        <header><div><span className="export-mark"><Icon name="keyframe" /></span><div><strong>Export animation</strong><small>{frameCount} frame{frameCount === 1 ? '' : 's'} - {settings.canvasSize.x} x {settings.canvasSize.y} - {fps} FPS</small></div></div><button type="button" onClick={onClose}>Close</button></header>
        <div className="export-content">
          <p className="export-intro">All raster exports use the crisp pixel renderer without smoothing. PNG exports preserve transparency.</p>
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
            <button type="button" disabled={isExporting} onClick={() => void run('individual PNG frames', async (project) => { const frames = await renderAllFrames(project); return saveExportFrames(await Promise.all(frames.map(async (frame, index) => ({ blob: await canvasToPngBlob(frame), name: `untitled-character-${String(index + 1).padStart(3, '0')}.png` })))); })}><Icon name="image" /><strong>Individual frames</strong><span>Choose a folder for all generated PNGs.</span></button>
            <button type="button" disabled={isExporting} onClick={() => void run('GIF animation', async (project) => { const frames = await renderAllFrames(project); return saveExportFile({ blob: encodeGif(frames.map((frame) => ({ width: frame.width, height: frame.height, pixels: framePixels(frame) })), project.fps), name: 'untitled-character.gif' }, { name: 'GIF animation', extensions: ['gif'] }); })}><Icon name="play" /><strong>Animated GIF</strong><span>Looping 256-color GIF animation.</span></button>
            <button type="button" disabled={isExporting} onClick={() => void run('animated PNG', async (project) => { const frames = await renderAllFrames(project); return saveExportFile({ blob: await encodeApng(frames.map((frame) => ({ width: frame.width, height: frame.height, pixels: framePixels(frame) })), project.fps), name: 'untitled-character.png' }, { name: 'Animated PNG', extensions: ['png'] }); })}><Icon name="layers" /><strong>Animated PNG</strong><span>RGBA animation with alpha support.</span></button>
          </div>
          <div className="export-data-row">
            <button type="button" disabled={isExporting} onClick={() => void run('animation JSON', async (project) => saveExportFile({ blob: jsonBlob(animationDataFile(project)), name: 'untitled-character.animation.json' }, { name: 'JSON data', extensions: ['json'] }))}><Icon name="keyframe" /> JSON animation data</button>
            <button type="button" disabled={isExporting} onClick={() => void run('project JSON', async (project) => saveExportFile({ blob: jsonBlob(projectFile(project)), name: 'untitled-character.pixelrig.json' }, { name: 'Pixel Rig project', extensions: ['json'] }))}><Icon name="download" /> Save project JSON</button>
          </div>
        </div>
        <footer><span className={status.includes('failed') || status.includes('could not') || status.includes('needs') ? 'export-error' : ''}>{status}</span><span>{isExporting ? 'Working...' : 'Ready'}</span></footer>
      </section>
    </div>
  );
}
