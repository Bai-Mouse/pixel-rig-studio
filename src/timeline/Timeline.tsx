import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import { animationDataFile, parseAnimationData, type SerializableProject } from '../export/projectSerializer';
import { saveExportFile } from '../export/nativeSave';
import type { AnimationTemplate } from '../types/project';

function animationSnapshot(): SerializableProject {
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

export function Timeline() {
  const animationInputRef = useRef<HTMLInputElement>(null);
  const [ioStatus, setIoStatus] = useState('Playback starts from the selected frame');
  const [isSavingAnimation, setIsSavingAnimation] = useState(false);
  const frames = useProjectStore((state) => state.frames);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const isPlaying = useProjectStore((state) => state.isPlaying);
  const isLooping = useProjectStore((state) => state.isLooping);
  const onionSkinEnabled = useProjectStore((state) => state.onionSkinEnabled);
  const fps = useProjectStore((state) => state.fps);
  const selectFrame = useProjectStore((state) => state.selectFrame);
  const togglePlayback = useProjectStore((state) => state.togglePlayback);
  const advanceFrame = useProjectStore((state) => state.advanceFrame);
  const toggleLooping = useProjectStore((state) => state.toggleLooping);
  const toggleOnionSkin = useProjectStore((state) => state.toggleOnionSkin);
  const setFps = useProjectStore((state) => state.setFps);
  const insertFrame = useProjectStore((state) => state.insertFrame);
  const duplicateFrame = useProjectStore((state) => state.duplicateFrame);
  const deleteFrame = useProjectStore((state) => state.deleteFrame);
  const applyAnimationTemplate = useProjectStore((state) => state.applyAnimationTemplate);
  const loadAnimation = useProjectStore((state) => state.loadAnimation);
  const projectName = useProjectStore((state) => state.projectName);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(advanceFrame, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [advanceFrame, fps, isPlaying]);

  const chooseTemplate = (template: AnimationTemplate) => {
    applyAnimationTemplate(template);
    setIoStatus(`Added 6-frame ${template === 'walk' ? 'walk' : 'idle'} template after the selected frame.`);
  };

  const importAnimation = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const animation = parseAnimationData(await file.text());
      if (!loadAnimation(animation)) throw new Error('This animation does not match any nodes in the current character.');
      setIoStatus(`Imported ${animation.frames.length} animation frame${animation.frames.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setIoStatus(error instanceof Error ? error.message : 'Could not import the animation.');
    }
  };

  const saveAnimation = async () => {
    setIsSavingAnimation(true);
    try {
      const result = await saveExportFile({
        blob: new Blob([JSON.stringify(animationDataFile(animationSnapshot()), null, 2)], { type: 'application/json' }),
        name: `${projectName || 'untitled-character'}.animation.json`,
      }, { name: 'Pixel Rig animation', extensions: ['json'] });
      setIoStatus(result === 'cancelled' ? 'Animation save cancelled.' : result === 'saved' ? 'Animation saved to the chosen location.' : 'Animation download started.');
    } catch (error) {
      setIoStatus(error instanceof Error ? error.message : 'Could not save the animation.');
    } finally {
      setIsSavingAnimation(false);
    }
  };

  return (
    <section className="timeline-panel" aria-label="Animation timeline">
      <input ref={animationInputRef} type="file" accept="application/json,.json,.animation.json" hidden onChange={(event) => { void importAnimation(event.target.files); event.currentTarget.value = ''; }} />
      <div className="timeline-toolbar">
        <div className="timeline-label"><Icon name="keyframe" /> Timeline <span>{frames.length} frame{frames.length === 1 ? '' : 's'}</span></div>
        <div className="playback-controls">
          <button className={`timeline-icon ${isPlaying ? 'active' : ''}`} type="button" onClick={togglePlayback} title={isPlaying ? 'Pause' : 'Play'}>
            <Icon name={isPlaying ? 'pause' : 'play'} />
          </button>
          <button className={`timeline-icon ${isLooping ? 'active' : ''}`} type="button" onClick={toggleLooping} title="Loop playback" aria-pressed={isLooping}>
            <Icon name="loop" />
          </button>
          <span className="timeline-divider" />
          <label className="fps-control">FPS <input type="number" min="1" max="60" value={fps} onChange={(event) => setFps(Number(event.target.value))} /></label>
          <button className={`onion-button ${onionSkinEnabled ? 'active' : ''}`} type="button" onClick={toggleOnionSkin} aria-pressed={onionSkinEnabled}>
            <Icon name="onion" /> Onion skin
          </button>
        </div>
        <div className="timeline-template-controls">
          <select aria-label="Add animation template" defaultValue="" onChange={(event) => { const template = event.target.value as AnimationTemplate; if (template) chooseTemplate(template); event.currentTarget.value = ''; }}>
            <option value="" disabled>Action template</option>
            <option value="walk">Walk · 6 frames</option>
            <option value="idle">Idle · 6 frames</option>
          </select>
          <button type="button" onClick={() => animationInputRef.current?.click()}><Icon name="import" /> Import animation</button>
          <button type="button" disabled={isSavingAnimation} onClick={() => void saveAnimation()}><Icon name="download" /> {isSavingAnimation ? 'Saving...' : 'Save animation'}</button>
        </div>
        <div className="timeline-actions">
          <button type="button" onClick={insertFrame}><Icon name="plus" /> Insert</button>
          <button type="button" onClick={duplicateFrame}><Icon name="copy" /> Duplicate</button>
          <button type="button" onClick={deleteFrame} disabled={frames.length === 1} title={frames.length === 1 ? 'An animation needs at least one frame' : 'Delete frame'}><Icon name="trash" /> Delete</button>
        </div>
      </div>
      <div className="timeline-ruler">
        <div className="track-name">FRAME</div>
        <div className="frame-scroll">
          <div className="frame-track">
            {frames.map((frame, index) => (
              <button
                key={frame.id}
                type="button"
                className={`frame-cell ${index === currentFrameIndex ? 'selected' : ''}`}
                onClick={() => selectFrame(index)}
                aria-label={`Frame ${index + 1}`}
                aria-current={index === currentFrameIndex ? 'step' : undefined}
              >
                <span className="frame-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="frame-thumbnail"><Icon name="keyframe" size={12} /></span>
                <span className="frame-tick" />
              </button>
            ))}
            <button className="append-frame" type="button" onClick={insertFrame} title="Insert frame"><Icon name="plus" /></button>
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span>Frame <strong>{currentFrameIndex + 1}</strong> of <strong>{frames.length}</strong></span>
        <span>{ioStatus}</span>
      </div>
    </section>
  );
}
