import { useState } from 'react';
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

export function ExportDialog({ onClose }: ExportDialogProps) {
  const frameCount = useProjectStore((state) => state.frames.length);
  const fps = useProjectStore((state) => state.fps);
  const settings = useProjectStore((state) => state.settings);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState('Choose an output format.');

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

  const exportSheet = () => run('PNG sprite sheet', async (project: RenderableProject) => {
    const frames = await renderAllFrames(project);
    const columns = Math.ceil(Math.sqrt(frames.length));
    const rows = Math.ceil(frames.length / columns);
    const sheet = document.createElement('canvas');
    sheet.width = project.settings.canvasSize.x * columns;
    sheet.height = project.settings.canvasSize.y * rows;
    const context = sheet.getContext('2d');
    if (!context) throw new Error('The sprite sheet could not be created.');
    context.imageSmoothingEnabled = false;
    frames.forEach((frame, index) => context.drawImage(frame, (index % columns) * frame.width, Math.floor(index / columns) * frame.height));
    return saveExportFile({ blob: await canvasToPngBlob(sheet), name: 'untitled-character-sheet.png' }, { name: 'PNG image', extensions: ['png'] });
  });

  return (
    <div className="export-overlay" role="dialog" aria-modal="true" aria-label="Export animation">
      <section className="export-dialog">
        <header><div><span className="export-mark"><Icon name="keyframe" /></span><div><strong>Export animation</strong><small>{frameCount} frame{frameCount === 1 ? '' : 's'} - {settings.canvasSize.x} x {settings.canvasSize.y} - {fps} FPS</small></div></div><button type="button" onClick={onClose}>Close</button></header>
        <div className="export-content">
          <p className="export-intro">All raster exports use the crisp pixel renderer without smoothing. PNG exports preserve transparency.</p>
          <div className="export-grid">
            <button type="button" disabled={isExporting} onClick={() => void exportSheet()}><Icon name="grid" /><strong>PNG sprite sheet</strong><span>Pack all frames into one PNG.</span></button>
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
