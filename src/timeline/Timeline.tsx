import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import { animationDataFile, parseAnimationData, type SerializableProject } from '../export/projectSerializer';
import { saveExportFile } from '../export/nativeSave';
import type { AnimationTemplate, TweenProperties } from '../types/project';

interface FrameDrag {
  sourceIndex: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const defaultTweenProperties: TweenProperties = {
  position: true,
  rotation: true,
  scale: true,
  visible: false,
  sprite: false,
};

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
  const draggedFrameIndexRef = useRef<number | null>(null);
  const frameDragRef = useRef<FrameDrag | null>(null);
  const [ioStatus, setIoStatus] = useState('Playback starts from the selected frame');
  const [isSavingAnimation, setIsSavingAnimation] = useState(false);
  const [draggedFrameIndex, setDraggedFrameIndex] = useState<number | null>(null);
  const [dropFrameIndex, setDropFrameIndex] = useState<number | null>(null);
  const [isPickingTweenFrames, setIsPickingTweenFrames] = useState(false);
  const [tweenFrameIndexes, setTweenFrameIndexes] = useState<number[]>([]);
  const [isTweenDialogOpen, setIsTweenDialogOpen] = useState(false);
  const [tweenCount, setTweenCount] = useState(1);
  const [tweenProperties, setTweenProperties] = useState<TweenProperties>(defaultTweenProperties);
  const [isPickingGroupFrames, setIsPickingGroupFrames] = useState(false);
  const [groupFrameIndexes, setGroupFrameIndexes] = useState<number[]>([]);
  const [groupDialogMode, setGroupDialogMode] = useState<'create' | 'edit' | null>(null);
  const [groupName, setGroupName] = useState('Animation Group');
  const [groupColor, setGroupColor] = useState('#7887f2');
  const frames = useProjectStore((state) => state.frames);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const isPlaying = useProjectStore((state) => state.isPlaying);
  const playbackGroupId = useProjectStore((state) => state.playbackGroupId);
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
  const moveFrame = useProjectStore((state) => state.moveFrame);
  const insertTweenFrames = useProjectStore((state) => state.insertTweenFrames);
  const groupFrames = useProjectStore((state) => state.groupFrames);
  const renameFrameGroup = useProjectStore((state) => state.renameFrameGroup);
  const ungroupFrames = useProjectStore((state) => state.ungroupFrames);
  const applyAnimationTemplate = useProjectStore((state) => state.applyAnimationTemplate);
  const loadAnimation = useProjectStore((state) => state.loadAnimation);
  const projectName = useProjectStore((state) => state.projectName);
  const playbackGroup = playbackGroupId
    ? frames.find((frame) => frame.group?.id === playbackGroupId)?.group
    : undefined;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(advanceFrame, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [advanceFrame, fps, isPlaying]);

  const chooseTemplate = (template: AnimationTemplate) => {
    applyAnimationTemplate(template);
    setIoStatus(`Added 6-frame ${template === 'walk' ? 'walk' : 'idle'} template after the selected frame.`);
  };

  const chooseTweenEndpoint = (index: number) => {
    selectFrame(index);
    setTweenFrameIndexes((current) => {
      if (current.includes(index)) return current.filter((frameIndex) => frameIndex !== index);
      if (!current.length) return [index];
      const next = [current[0], index].sort((left, right) => left - right);
      setIsPickingTweenFrames(false);
      setIsTweenDialogOpen(true);
      return next;
    });
  };

  const createTweenFrames = () => {
    if (tweenFrameIndexes.length !== 2) return;
    insertTweenFrames(tweenFrameIndexes[0], tweenFrameIndexes[1], tweenCount, tweenProperties);
    setIoStatus(`Inserted ${tweenCount} in-between frame${tweenCount === 1 ? '' : 's'}.`);
    setTweenFrameIndexes([]);
    setIsTweenDialogOpen(false);
  };

  const currentFrameGroup = frames[currentFrameIndex]?.group;

  const chooseGroupFrame = (index: number) => {
    selectFrame(index);
    setGroupFrameIndexes((current) => current.includes(index)
      ? current.filter((frameIndex) => frameIndex !== index)
      : [...current, index].sort((left, right) => left - right));
  };

  const beginGroupSelection = () => {
    setTweenFrameIndexes([]);
    setIsPickingTweenFrames(false);
    setGroupFrameIndexes([]);
    setIsPickingGroupFrames(true);
    setIoStatus('Select the frames to group, then click Create group.');
  };

  const openCreateGroupDialog = () => {
    if (!groupFrameIndexes.length) return;
    setGroupName('Animation Group');
    setGroupColor('#7887f2');
    setGroupDialogMode('create');
  };

  const openEditGroupDialog = () => {
    if (!currentFrameGroup) return;
    setGroupName(currentFrameGroup.name);
    setGroupColor(currentFrameGroup.color);
    setGroupDialogMode('edit');
  };

  const saveFrameGroup = () => {
    if (groupDialogMode === 'create') {
      groupFrames(groupFrameIndexes, groupName, groupColor);
      setIoStatus(`Grouped ${groupFrameIndexes.length} frame${groupFrameIndexes.length === 1 ? '' : 's'} as “${groupName.trim() || 'Animation Group'}”.`);
      setGroupFrameIndexes([]);
      setIsPickingGroupFrames(false);
    } else if (groupDialogMode === 'edit' && currentFrameGroup) {
      renameFrameGroup(currentFrameGroup.id, groupName, groupColor);
      setIoStatus(`Updated frame group “${groupName.trim() || 'Animation Group'}”.`);
    }
    setGroupDialogMode(null);
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

  const clearFrameDrag = () => {
    frameDragRef.current = null;
    draggedFrameIndexRef.current = null;
    setDraggedFrameIndex(null);
    setDropFrameIndex(null);
  };

  const startFrameDrag = (index: number, clientX: number, clientY: number) => {
    frameDragRef.current = { sourceIndex: index, startX: clientX, startY: clientY, moved: false };
    draggedFrameIndexRef.current = index;
    setDraggedFrameIndex(index);
    setDropFrameIndex(null);
  };

  const frameIndexFromTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    const value = target.closest<HTMLElement>('[data-frame-index]')?.dataset.frameIndex;
    const index = Number(value);
    return Number.isInteger(index) ? index : null;
  };

  const dropIndexFromPoint = (clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY);
    if (target?.closest('.append-frame')) return frames.length - 1;
    return frameIndexFromTarget(target);
  };

  const trackFrameDrag = (target: EventTarget | null) => {
    const sourceIndex = draggedFrameIndexRef.current;
    if (sourceIndex === null) return;
    if (target instanceof Element && target.closest('.append-frame')) {
      setDropFrameIndex(frames.length);
      return;
    }
    const targetIndex = frameIndexFromTarget(target);
    setDropFrameIndex(targetIndex !== null && targetIndex !== sourceIndex ? targetIndex : null);
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = frameDragRef.current;
      if (!drag) return;
      if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) >= 4) drag.moved = true;
      trackFrameDrag(document.elementFromPoint(event.clientX, event.clientY));
    };
    const end = (event: PointerEvent) => {
      const drag = frameDragRef.current;
      if (!drag) return;
      const targetIndex = dropIndexFromPoint(event.clientX, event.clientY);
      if (drag.moved && targetIndex !== null && targetIndex !== drag.sourceIndex) moveFrame(drag.sourceIndex, targetIndex);
      clearFrameDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', clearFrameDrag);
    window.addEventListener('blur', clearFrameDrag);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', clearFrameDrag);
      window.removeEventListener('blur', clearFrameDrag);
    };
  }, [frames.length, moveFrame]);

  return (
    <section className="timeline-panel" aria-label="Animation timeline">
      <input ref={animationInputRef} type="file" accept="application/json,.json,.animation.json" hidden onChange={(event) => { void importAnimation(event.target.files); event.currentTarget.value = ''; }} />
      <div className="timeline-toolbar">
        <div className="timeline-label"><Icon name="keyframe" /> Timeline <span>{frames.length} frame{frames.length === 1 ? '' : 's'}</span></div>
        <div className="playback-controls">
          <button className={`timeline-icon ${isPlaying ? 'active' : ''}`} type="button" onClick={togglePlayback} title={isPlaying ? playbackGroup ? `Pause “${playbackGroup.name}”` : 'Pause' : frames[currentFrameIndex]?.group ? `Play group “${frames[currentFrameIndex].group.name}”` : 'Play'}>
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
          <button className={isPickingTweenFrames ? 'active' : ''} type="button" onClick={() => { setGroupFrameIndexes([]); setIsPickingGroupFrames(false); setTweenFrameIndexes([]); setIsPickingTweenFrames((value) => !value); }}><Icon name="keyframe" /> {isPickingTweenFrames ? 'Pick 2 frames' : 'In-between'}</button>
          {isPickingGroupFrames
            ? <button className="active" type="button" disabled={!groupFrameIndexes.length} onClick={openCreateGroupDialog}><Icon name="layers" /> Create group ({groupFrameIndexes.length})</button>
            : <button type="button" onClick={beginGroupSelection}><Icon name="layers" /> Group frames</button>}
          {isPickingGroupFrames && <button type="button" onClick={() => { setIsPickingGroupFrames(false); setGroupFrameIndexes([]); setIoStatus('Frame grouping cancelled.'); }}>Cancel</button>}
          {!isPickingGroupFrames && currentFrameGroup && <button type="button" className="frame-group-manage" style={{ '--group-color': currentFrameGroup.color } as CSSProperties} onClick={openEditGroupDialog}>Edit “{currentFrameGroup.name}”</button>}
          <button type="button" onClick={insertFrame} disabled={isPickingGroupFrames || isPickingTweenFrames}><Icon name="plus" /> Insert</button>
          <button type="button" onClick={duplicateFrame} disabled={isPickingGroupFrames || isPickingTweenFrames}><Icon name="copy" /> Duplicate</button>
          <button type="button" onClick={deleteFrame} disabled={frames.length === 1 || isPickingGroupFrames || isPickingTweenFrames} title={frames.length === 1 ? 'An animation needs at least one frame' : 'Delete frame'}><Icon name="trash" /> Delete</button>
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
                data-frame-index={index}
                className={`frame-cell ${index === currentFrameIndex ? 'selected' : ''} ${tweenFrameIndexes.includes(index) ? 'tween-endpoint' : ''} ${groupFrameIndexes.includes(index) ? 'group-pick' : ''} ${frame.group ? 'grouped' : ''} ${index === draggedFrameIndex ? 'dragging' : ''} ${index === dropFrameIndex && index !== draggedFrameIndex ? 'drop-target' : ''}`}
                style={frame.group ? { '--frame-group-color': frame.group.color } as CSSProperties : undefined}
                onClick={() => { if (!frameDragRef.current?.moved) selectFrame(index); }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  if (isPickingTweenFrames) {
                    chooseTweenEndpoint(index);
                    return;
                  }
                  if (isPickingGroupFrames) {
                    chooseGroupFrame(index);
                    return;
                  }
                  selectFrame(index);
                  startFrameDrag(index, event.clientX, event.clientY);
                }}
                aria-label={`Frame ${index + 1}`}
                aria-current={index === currentFrameIndex ? 'step' : undefined}
              >
                <span className="frame-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="frame-thumbnail"><Icon name="keyframe" size={12} /></span>
                <span className="frame-tick" />
                {tweenFrameIndexes.includes(index) && <span className="tween-endpoint-marker">{tweenFrameIndexes.indexOf(index) + 1}</span>}
                {frame.group && <span className="frame-group-label" title={frame.group.name}>{frame.group.name}</span>}
              </button>
            ))}
            <button
              className={`append-frame ${dropFrameIndex === frames.length ? 'drop-target' : ''}`}
              type="button"
              onClick={insertFrame}
              title="Insert frame"
            ><Icon name="plus" /></button>
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span>Frame <strong>{currentFrameIndex + 1}</strong> of <strong>{frames.length}</strong></span>
        <span>{isPlaying && playbackGroup ? `Playing group “${playbackGroup.name}”${isLooping ? ' · looping' : ''}` : ioStatus}</span>
      </div>
      {isTweenDialogOpen && tweenFrameIndexes.length === 2 && <div className="tween-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setIsTweenDialogOpen(false); }}>
        <div className="tween-dialog" role="dialog" aria-modal="true" aria-label="Create in-between frames">
          <header><div><strong>Create in-between frames</strong><small>Frame {tweenFrameIndexes[0] + 1} to frame {tweenFrameIndexes[1] + 1}</small></div><button type="button" onClick={() => setIsTweenDialogOpen(false)}>Close</button></header>
          <label className="tween-count">Frames to insert<input type="number" min="1" max="120" value={tweenCount} onChange={(event) => setTweenCount(Math.max(1, Math.min(120, Number(event.target.value) || 1)))} /></label>
          <fieldset><legend>Properties to interpolate</legend>
            {(Object.keys(tweenProperties) as Array<keyof TweenProperties>).map((property) => <label key={property}><input type="checkbox" checked={tweenProperties[property]} onChange={(event) => setTweenProperties((current) => ({ ...current, [property]: event.target.checked }))} />{property === 'position' ? 'Position' : property === 'rotation' ? 'Rotation' : property === 'scale' ? 'Scale' : property === 'visible' ? 'Visibility' : 'Selected sprite'}</label>)}
          </fieldset>
          <p>Continuous values are evenly spaced. Visibility and sprite switch at the midpoint. For the cleanest sequence, choose adjacent frames.</p>
          <footer><button type="button" onClick={() => setIsTweenDialogOpen(false)}>Cancel</button><button type="button" disabled={!Object.values(tweenProperties).some(Boolean)} onClick={createTweenFrames}>Insert frames</button></footer>
        </div>
      </div>}
      {groupDialogMode && <div className="tween-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setGroupDialogMode(null); }}>
        <div className="tween-dialog frame-group-dialog" role="dialog" aria-modal="true" aria-label={groupDialogMode === 'create' ? 'Create frame group' : 'Edit frame group'}>
          <header><div><strong>{groupDialogMode === 'create' ? 'Create frame group' : 'Edit frame group'}</strong><small>{groupDialogMode === 'create' ? `${groupFrameIndexes.length} selected frame${groupFrameIndexes.length === 1 ? '' : 's'}` : `${frames.filter((frame) => frame.group?.id === currentFrameGroup?.id).length} grouped frames`}</small></div><button type="button" onClick={() => setGroupDialogMode(null)}>Close</button></header>
          <label className="frame-group-name">Group name<input autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveFrameGroup(); }} /></label>
          <label className="frame-group-color">Group color<input type="color" value={groupColor} onChange={(event) => setGroupColor(event.target.value)} /></label>
          <footer>
            {groupDialogMode === 'edit' && currentFrameGroup && <button className="ungroup-button" type="button" onClick={() => { ungroupFrames(currentFrameGroup.id); setGroupDialogMode(null); setIoStatus(`Removed group “${currentFrameGroup.name}”.`); }}>Ungroup frames</button>}
            <span />
            <button type="button" onClick={() => setGroupDialogMode(null)}>Cancel</button>
            <button type="button" onClick={saveFrameGroup}>{groupDialogMode === 'create' ? 'Create group' : 'Save group'}</button>
          </footer>
        </div>
      </div>}
    </section>
  );
}
