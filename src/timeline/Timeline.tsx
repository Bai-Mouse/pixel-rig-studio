import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import { animationDataFile, parseAnimationData, type SerializableProject } from '../export/projectSerializer';
import { saveExportFile } from '../export/nativeSave';
import type { AnimationFrame, AnimationImportMode, AnimationTemplate, TweenProperties } from '../types/project';
import { FrameThumbnail } from './FrameThumbnail';

interface FrameDrag {
  pointerId: number;
  sourceId: string;
  frameIds: string[];
  framesAtStart: AnimationFrame[];
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

const timelineZoomLevels = [40, 60, 80, 100, 125, 150, 200];
const defaultTimelineZoom = 3;
const frameWidth = 75;
const trackPadding = 9;

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
  const frameScrollRef = useRef<HTMLDivElement>(null);
  const pendingZoomScroll = useRef<number | null>(null);
  const frameDragRef = useRef<FrameDrag | null>(null);
  const [zoomIndex, setZoomIndex] = useState(defaultTimelineZoom);
  const [fittedZoom, setFittedZoom] = useState<number | null>(null);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const zoom = fittedZoom ?? timelineZoomLevels[zoomIndex];
  const [ioStatus, setIoStatus] = useState('Playback starts from the selected frame');
  const [importMode, setImportMode] = useState<AnimationImportMode>('replace');
  const [isSavingAnimation, setIsSavingAnimation] = useState(false);
  const [draggedFrameIds, setDraggedFrameIds] = useState<string[]>([]);
  const [dropBoundary, setDropBoundary] = useState<number | null>(null);
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
  const [groupTargetId, setGroupTargetId] = useState('');
  const frames = useProjectStore((state) => state.frames);
  const assets = useProjectStore((state) => state.assets);
  const nodes = useProjectStore((state) => state.nodes);
  const rootNodeIds = useProjectStore((state) => state.rootNodeIds);
  const settings = useProjectStore((state) => state.settings);
  const thumbnailProject = useMemo(() => ({ assets, nodes, rootNodeIds, settings }), [assets, nodes, rootNodeIds, settings]);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const selectedFrameIds = useProjectStore((state) => state.selectedFrameIds);
  const effectiveSelectedFrameIds = selectedFrameIds.includes(frames[currentFrameIndex]?.id)
    ? selectedFrameIds.filter((id) => frames.some((frame) => frame.id === id))
    : frames[currentFrameIndex] ? [frames[currentFrameIndex].id] : [];
  const isPlaying = useProjectStore((state) => state.isPlaying);
  const playbackGroupId = useProjectStore((state) => state.playbackGroupId);
  const playbackFrameIds = useProjectStore((state) => state.playbackFrameIds);
  const isLooping = useProjectStore((state) => state.isLooping);
  const onionSkinEnabled = useProjectStore((state) => state.onionSkinEnabled);
  const fps = useProjectStore((state) => state.fps);
  const selectFrame = useProjectStore((state) => state.selectFrame);
  const togglePlayback = useProjectStore((state) => state.togglePlayback);
  const toggleSelectionPlayback = useProjectStore((state) => state.toggleSelectionPlayback);
  const advanceFrame = useProjectStore((state) => state.advanceFrame);
  const toggleLooping = useProjectStore((state) => state.toggleLooping);
  const toggleOnionSkin = useProjectStore((state) => state.toggleOnionSkin);
  const setFps = useProjectStore((state) => state.setFps);
  const insertFrame = useProjectStore((state) => state.insertFrame);
  const duplicateFrame = useProjectStore((state) => state.duplicateFrame);
  const deleteFrame = useProjectStore((state) => state.deleteFrame);
  const moveFrames = useProjectStore((state) => state.moveFrames);
  const insertTweenFrames = useProjectStore((state) => state.insertTweenFrames);
  const groupFrames = useProjectStore((state) => state.groupFrames);
  const addFramesToGroup = useProjectStore((state) => state.addFramesToGroup);
  const removeFramesFromGroup = useProjectStore((state) => state.removeFramesFromGroup);
  const renameFrameGroup = useProjectStore((state) => state.renameFrameGroup);
  const ungroupFrames = useProjectStore((state) => state.ungroupFrames);
  const applyAnimationTemplate = useProjectStore((state) => state.applyAnimationTemplate);
  const loadAnimation = useProjectStore((state) => state.loadAnimation);
  const projectName = useProjectStore((state) => state.projectName);
  const playbackGroup = playbackGroupId
    ? frames.find((frame) => frame.group?.id === playbackGroupId)?.group
    : undefined;
  const frameGroups = Array.from(new Map(frames.flatMap((frame) => frame.group ? [[frame.group.id, frame.group] as const] : [])).values());
  const groupFrameCount = (groupId: string) => frames.filter((frame) => frame.group?.id === groupId).length;
  const targetGroup = groupTargetId ? frameGroups.find((group) => group.id === groupTargetId) : undefined;
  const activeGroup = frames[currentFrameIndex]?.group;
  const canPreviewSelection = effectiveSelectedFrameIds.length > 1 || Boolean(activeGroup && groupFrameCount(activeGroup.id) > 1);
  const previewingSelection = Boolean(isPlaying && playbackFrameIds);
  const nextOrEqualZoom = timelineZoomLevels.findIndex((level) => level >= zoom);
  const lowerZoom = nextOrEqualZoom < 0 ? timelineZoomLevels.length - 1 : nextOrEqualZoom - 1;
  const higherZoom = timelineZoomLevels.findIndex((level) => level > zoom);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(advanceFrame, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [advanceFrame, fps, isPlaying]);

  const changeZoom = useCallback((nextIndex: number, offset?: number) => {
    const scroll = frameScrollRef.current;
    if (!scroll || frameDragRef.current) return;
    const boundedIndex = Math.max(0, Math.min(timelineZoomLevels.length - 1, nextIndex));
    if (timelineZoomLevels[boundedIndex] === zoom) return;
    const anchor = offset ?? scroll.clientWidth / 2;
    const trackX = Math.max(0, scroll.scrollLeft + anchor - trackPadding);
    pendingZoomScroll.current = trackPadding + trackX * timelineZoomLevels[boundedIndex] / zoom - anchor;
    setZoomIndex(boundedIndex);
    setFittedZoom(null);
  }, [zoom]);

  useLayoutEffect(() => {
    const scroll = frameScrollRef.current;
    if (scroll && pendingZoomScroll.current !== null) {
      scroll.scrollLeft = pendingZoomScroll.current;
      pendingZoomScroll.current = null;
    }
  }, [zoom]);

  useEffect(() => {
    const scroll = frameScrollRef.current;
    if (!scroll) return;
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();
      const index = event.deltaY < 0 ? higherZoom : lowerZoom;
      if (index >= 0) changeZoom(index, event.clientX - scroll.getBoundingClientRect().left);
    };
    scroll.addEventListener('wheel', wheel, { passive: false });
    return () => scroll.removeEventListener('wheel', wheel);
  }, [changeZoom, higherZoom, lowerZoom]);

  const fitSelection = () => {
    const scroll = frameScrollRef.current;
    if (!scroll || frameDragRef.current) return;
    const ids = new Set(effectiveSelectedFrameIds);
    const indexes = frames.flatMap((frame, index) => ids.has(frame.id) ? [index] : []);
    if (!indexes.length) return;
    const first = indexes[0];
    const last = indexes[indexes.length - 1];
    const cellWidth = Math.min(frameWidth * 2, Math.max(1, (scroll.clientWidth - trackPadding * 2) / (last - first + 1)));
    const offset = trackPadding + (first + (last - first + 1) / 2) * cellWidth - scroll.clientWidth / 2;
    const percent = cellWidth / frameWidth * 100;
    if (percent === zoom) scroll.scrollLeft = offset;
    else {
      pendingZoomScroll.current = offset;
      setFittedZoom(percent);
    }
  };

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

  const deleteSelectedFrames = () => {
    const count = effectiveSelectedFrameIds.length;
    if (!count || count >= frames.length) return;
    deleteFrame();
    setIoStatus(count > 1 ? `Deleted ${count} selected frames. Ctrl+Z to undo.` : 'Deleted the selected frame. Ctrl+Z to undo.');
  };

  const currentFrameGroup = frames[currentFrameIndex]?.group;
  /** Selected frames that belong to the group being edited; only these can be removed from it. */
  const removableGroupFrameIndexes = currentFrameGroup
    ? frames.flatMap((frame, index) => frame.group?.id === currentFrameGroup.id && effectiveSelectedFrameIds.includes(frame.id) ? [index] : [])
    : [];

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
    setIoStatus('Select the frames to group, then choose Create group or add them to an existing group.');
  };

  const openCreateGroupDialog = () => {
    if (!groupFrameIndexes.length) return;
    setGroupName('Animation Group');
    setGroupColor('#7887f2');
    setGroupTargetId('');
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
      if (targetGroup) {
        addFramesToGroup(groupFrameIndexes, targetGroup.id);
        setIoStatus(`Added ${groupFrameIndexes.length} frame${groupFrameIndexes.length === 1 ? '' : 's'} to “${targetGroup.name}”. Ctrl+Z to undo.`);
      } else {
        groupFrames(groupFrameIndexes, groupName, groupColor);
        setIoStatus(`Grouped ${groupFrameIndexes.length} frame${groupFrameIndexes.length === 1 ? '' : 's'} as “${groupName.trim() || 'Animation Group'}”. Ctrl+Z to undo.`);
      }
      setGroupFrameIndexes([]);
      setIsPickingGroupFrames(false);
    } else if (groupDialogMode === 'edit' && currentFrameGroup) {
      renameFrameGroup(currentFrameGroup.id, groupName, groupColor);
      setIoStatus(`Updated frame group “${groupName.trim() || 'Animation Group'}”. Ctrl+Z to undo.`);
    }
    setGroupTargetId('');
    setGroupDialogMode(null);
  };

  const removeSelectedFramesFromGroup = () => {
    if (!currentFrameGroup || !removableGroupFrameIndexes.length) return;
    const count = removableGroupFrameIndexes.length;
    removeFramesFromGroup(removableGroupFrameIndexes);
    setIoStatus(`Removed ${count} frame${count === 1 ? '' : 's'} from “${currentFrameGroup.name}”. Ctrl+Z to undo.`);
    setGroupTargetId('');
    setGroupDialogMode(null);
  };

  const removeAllGroupFrames = () => {
    if (!currentFrameGroup) return;
    ungroupFrames(currentFrameGroup.id);
    setIoStatus(`Removed group “${currentFrameGroup.name}”. Ctrl+Z to undo.`);
    setGroupDialogMode(null);
  };

  const importAnimation = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const animation = parseAnimationData(await file.text());
      const startIndex = useProjectStore.getState().currentFrameIndex;
      const options = importMode === 'replace' ? undefined : { mode: importMode, startIndex };
      if (!loadAnimation(animation, options)) throw new Error('This animation does not match any nodes in the current character.');
      const count = animation.frames.length;
      const framesLabel = `frame${count === 1 ? '' : 's'}`;
      const verb = importMode === 'insert' ? 'Inserted' : importMode === 'delta' ? 'Applied deltas for' : 'Overwrote';
      setIoStatus(importMode === 'replace'
        ? `Imported ${count} animation ${framesLabel} and replaced the timeline. Ctrl+Z to undo.`
        : `${verb} ${count} ${framesLabel} from frame ${startIndex + 1}. Project FPS and loop were kept. Ctrl+Z to undo.`);
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

  useEffect(() => {
    let scrollRequest = 0;
    const clearFrameDrag = () => {
      frameDragRef.current = null;
      window.cancelAnimationFrame(scrollRequest);
      scrollRequest = 0;
      setDraggedFrameIds([]);
      setDropBoundary(null);
    };
    const boundaryAt = (x: number, y: number) => {
      const scroll = frameScrollRef.current;
      const target = document.elementFromPoint(x, y);
      if (!scroll || !target || !scroll.contains(target)) return null;
      if (target.closest('.append-frame')) return useProjectStore.getState().frames.length;
      const cell = target.closest<HTMLElement>('[data-frame-index]');
      if (!cell) return null;
      const bounds = cell.getBoundingClientRect();
      return Number(cell.dataset.frameIndex) + (x >= bounds.left + bounds.width / 2 ? 1 : 0);
    };
    const scrollWhileDragging = () => {
      scrollRequest = 0;
      const drag = frameDragRef.current;
      const scroll = frameScrollRef.current;
      if (!drag?.moved || !scroll) return;
      if (drag.framesAtStart !== useProjectStore.getState().frames) {
        clearFrameDrag();
        return;
      }
      const bounds = scroll.getBoundingClientRect();
      if (drag.y >= bounds.top && drag.y <= bounds.bottom && drag.x >= bounds.left && drag.x <= bounds.right) {
        const edge = 28;
        if (drag.x < bounds.left + edge) scroll.scrollLeft -= 10;
        if (drag.x > bounds.right - edge) scroll.scrollLeft += 10;
      }
      setDropBoundary(boundaryAt(drag.x, drag.y));
      scrollRequest = window.requestAnimationFrame(scrollWhileDragging);
    };
    const move = (event: PointerEvent) => {
      const drag = frameDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!drag.moved && Math.abs(drag.x - drag.startX) + Math.abs(drag.y - drag.startY) >= 4) {
        drag.moved = true;
        setDraggedFrameIds(drag.frameIds);
        scrollWhileDragging();
      }
    };
    const end = (event: PointerEvent) => {
      const drag = frameDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const boundary = boundaryAt(event.clientX, event.clientY);
      clearFrameDrag();
      if (!drag.moved) {
        const index = useProjectStore.getState().frames.findIndex((frame) => frame.id === drag.sourceId);
        if (index >= 0) selectFrame(index);
      } else if (drag.framesAtStart === useProjectStore.getState().frames
        && boundary !== null && moveFrames(drag.frameIds, boundary)) {
        setIoStatus(`Moved ${drag.frameIds.length} frame${drag.frameIds.length === 1 ? '' : 's'}. Ctrl+Z to undo.`);
      }
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
      window.cancelAnimationFrame(scrollRequest);
    };
  }, [moveFrames, selectFrame]);

  return (
    <section className="timeline-panel" aria-label="Animation timeline" tabIndex={0} onKeyDown={(event) => {
      if (event.code !== 'Space' || !event.shiftKey || event.repeat || event.ctrlKey || event.metaKey || event.altKey
        || (event.target as HTMLElement).closest('input, select, textarea, [role="dialog"]')) return;
      event.preventDefault();
      toggleSelectionPlayback();
    }}>
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
          <button className={`timeline-icon ${previewingSelection ? 'active' : ''}`} type="button" onClick={toggleSelectionPlayback}
            title="Loop selection or current group (Shift+Space in timeline)" aria-label="Loop selection or current group"
            aria-pressed={previewingSelection} disabled={!canPreviewSelection && !previewingSelection}>
            <Icon name={previewingSelection ? 'pause' : 'keyframe'} size={13} />
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
          <select
            className="animation-import-mode"
            aria-label="Animation import placement"
            title="Choose how an imported animation is placed: replace the timeline, add its pose deltas, insert it, or overwrite from the selected frame"
            value={importMode}
            onChange={(event) => {
              const mode = event.target.value as AnimationImportMode;
              setImportMode(mode);
              setIoStatus(mode === 'replace'
                ? 'Import animation will replace the whole timeline.'
                : mode === 'delta'
                  ? `Import animation will add each frame's pose change on top of frame ${currentFrameIndex + 1}.`
                  : `Import animation will ${mode === 'insert' ? 'insert frames at' : 'overwrite frames from'} frame ${currentFrameIndex + 1}.`);
            }}
          >
            <option value="replace">Replace timeline</option>
            <option value="delta">Apply deltas from frame {currentFrameIndex + 1}</option>
            <option value="insert">Insert at frame {currentFrameIndex + 1}</option>
            <option value="overwrite">Overwrite from frame {currentFrameIndex + 1}</option>
          </select>
          <button
            type="button"
            title={importMode === 'replace'
              ? 'Import a .animation.json file and replace the timeline'
              : importMode === 'delta'
                ? `Import a .animation.json file and add its frame-to-frame pose changes from frame ${currentFrameIndex + 1}`
                : `Import a .animation.json file starting at frame ${currentFrameIndex + 1}`}
            onClick={() => animationInputRef.current?.click()}
          ><Icon name="import" /> Import animation</button>
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
          <button type="button" onClick={() => {
            duplicateFrame();
            const count = effectiveSelectedFrameIds.length;
            setIoStatus(`Duplicated ${count} frame${count === 1 ? '' : 's'}. Ctrl+Z to undo.`);
            requestAnimationFrame(() => frameScrollRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
          }} disabled={isPickingGroupFrames || isPickingTweenFrames}><Icon name="copy" /> {effectiveSelectedFrameIds.length > 1 ? `Duplicate ${effectiveSelectedFrameIds.length}` : 'Duplicate'}</button>
          <button
            type="button"
            onClick={deleteSelectedFrames}
            disabled={effectiveSelectedFrameIds.length >= frames.length || isPickingGroupFrames || isPickingTweenFrames}
            title={effectiveSelectedFrameIds.length >= frames.length
              ? 'An animation needs at least one frame'
              : effectiveSelectedFrameIds.length > 1
                ? `Delete ${effectiveSelectedFrameIds.length} selected frames`
                : 'Delete frame'}
          ><Icon name="trash" /> {effectiveSelectedFrameIds.length > 1 ? `Delete ${effectiveSelectedFrameIds.length}` : 'Delete'}</button>
        </div>
      </div>
      <div className="timeline-ruler">
        <div className="track-name">FRAME</div>
        <div className="frame-scroll" ref={frameScrollRef}>
          <div className={`frame-track ${zoom < 24 ? 'frame-track-condensed' : ''}`} style={{ '--frame-width': `${frameWidth * zoom / 100}px` } as CSSProperties}>
            {frames.map((frame, index) => (
              <button
                key={frame.id}
                type="button"
                data-frame-index={index}
                className={`frame-cell ${index === currentFrameIndex ? 'selected' : ''} ${effectiveSelectedFrameIds.includes(frame.id) ? 'multi-selected' : ''} ${tweenFrameIndexes.includes(index) ? 'tween-endpoint' : ''} ${groupFrameIndexes.includes(index) ? 'group-pick' : ''} ${frame.group ? 'grouped' : ''} ${draggedFrameIds.includes(frame.id) ? 'dragging' : ''} ${index === dropBoundary ? 'drop-target' : ''}`}
                style={frame.group ? { '--frame-group-color': frame.group.color } as CSSProperties : undefined}
                onClick={(event) => { if (event.detail === 0) selectFrame(index, event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'single'); }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus({ preventScroll: true });
                  if (isPickingTweenFrames) {
                    chooseTweenEndpoint(index);
                    return;
                  }
                  if (isPickingGroupFrames) {
                    chooseGroupFrame(index);
                    return;
                  }
                  if (event.shiftKey || event.ctrlKey || event.metaKey) {
                    selectFrame(index, event.shiftKey ? 'range' : 'toggle');
                    return;
                  }
                  if (frameDragRef.current) return;
                  const frameIds = effectiveSelectedFrameIds.includes(frame.id) ? effectiveSelectedFrameIds : [frame.id];
                  if (frameIds.length === 1) selectFrame(index);
                  frameDragRef.current = {
                    pointerId: event.pointerId, sourceId: frame.id, frameIds,
                    framesAtStart: useProjectStore.getState().frames,
                    startX: event.clientX, startY: event.clientY,
                    x: event.clientX, y: event.clientY, moved: false,
                  };
                }}
                aria-label={`Frame ${index + 1}`}
                aria-pressed={effectiveSelectedFrameIds.includes(frame.id)}
                aria-current={index === currentFrameIndex ? 'step' : undefined}
              >
                <span className="frame-number">{String(index + 1).padStart(2, '0')}</span>
                {showThumbnails && zoom >= 24
                  ? <FrameThumbnail frame={frame} project={thumbnailProject} />
                  : <span className="frame-thumbnail"><Icon name="keyframe" size={12} /></span>}
                <span className="frame-tick" />
                {tweenFrameIndexes.includes(index) && <span className="tween-endpoint-marker">{tweenFrameIndexes.indexOf(index) + 1}</span>}
                {frame.group && <span className="frame-group-label" title={frame.group.name}>{frame.group.name}</span>}
              </button>
            ))}
            <button
              className={`append-frame ${dropBoundary === frames.length ? 'drop-target' : ''}`}
              type="button"
              onClick={insertFrame}
              title="Insert frame"
            ><Icon name="plus" /></button>
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span>{effectiveSelectedFrameIds.length} selected · Ctrl/Cmd: toggle · Shift: range · Ctrl+Z: undo</span>
        <span>Frame <strong>{currentFrameIndex + 1}</strong> of <strong>{frames.length}</strong></span>
        <div className="timeline-zoom" role="group" aria-label="Timeline zoom" title="Ctrl/Cmd + scroll over frames to zoom">
          <button type="button" className="timeline-icon" title="Center current frame" aria-label="Center current frame" onClick={() => frameScrollRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })}><Icon name="target" size={13} /></button>
          <button type="button" className="timeline-zoom-value" title="Fit selected frames" onClick={fitSelection}>Fit</button>
          <button type="button" className={`timeline-icon ${showThumbnails ? 'active' : ''}`} title="Toggle frame thumbnails" aria-label="Toggle frame thumbnails" aria-pressed={showThumbnails} onClick={() => setShowThumbnails((value) => !value)}><Icon name="image" size={13} /></button>
          <button type="button" className="timeline-icon" aria-label="Zoom timeline out" onClick={() => changeZoom(lowerZoom)} disabled={lowerZoom < 0}><Icon name="zoomOut" size={13} /></button>
          <button type="button" className="timeline-zoom-value" aria-label={`Reset timeline zoom, currently ${Math.round(zoom)}%`} onClick={() => changeZoom(defaultTimelineZoom)}>{Math.round(zoom)}%</button>
          <button type="button" className="timeline-icon" aria-label="Zoom timeline in" onClick={() => changeZoom(higherZoom)} disabled={higherZoom < 0}><Icon name="zoomIn" size={13} /></button>
        </div>
        <span>{previewingSelection ? `Looping ${playbackFrameIds?.length} frames` : isPlaying && playbackGroup ? `Playing group “${playbackGroup.name}”${isLooping ? ' · looping' : ''}` : ioStatus}</span>
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
          <header><div><strong>{groupDialogMode === 'create' ? 'Group frames' : `Edit “${currentFrameGroup?.name ?? 'frame group'}”`}</strong><small>{groupDialogMode === 'create'
            ? `${groupFrameIndexes.length} selected frame${groupFrameIndexes.length === 1 ? '' : 's'}${targetGroup ? ` → ${targetGroup.name}` : ''}`
            : `${frames.filter((frame) => frame.group?.id === currentFrameGroup?.id).length} grouped frames · ${removableGroupFrameIndexes.length} selected`}</small></div><button type="button" onClick={() => setGroupDialogMode(null)}>Close</button></header>
          {groupDialogMode === 'create' ? <>
            <label className="frame-group-target">Add to<select value={groupTargetId} onChange={(event) => setGroupTargetId(event.target.value)}>
              <option value="">New group</option>
              {frameGroups.map((group) => <option key={group.id} value={group.id}>{group.name} ({groupFrameCount(group.id)} frames)</option>)}
            </select></label>
            {targetGroup
              ? <p className="frame-group-hint">The selected frames join “{targetGroup.name}”. Its name and color stay unchanged; use “Edit” on one of its frames to rename it.</p>
              : <>
                {!frameGroups.length && <p className="frame-group-hint">No other groups exist yet, so only “New group” is available. Name the first group below — once it exists it shows up in this “Add to” list.</p>}
                <label className="frame-group-name">Group name<input autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveFrameGroup(); }} /></label>
                <label className="frame-group-color">Group color<input type="color" value={groupColor} onChange={(event) => setGroupColor(event.target.value)} /></label>
              </>}
          </> : <>
            <label className="frame-group-name">Group name<input autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveFrameGroup(); }} /></label>
            <label className="frame-group-color">Group color<input type="color" value={groupColor} onChange={(event) => setGroupColor(event.target.value)} /></label>
            {removableGroupFrameIndexes.length > 0 && <p className="frame-group-hint">“Remove selected” takes only the {removableGroupFrameIndexes.length} selected frame{removableGroupFrameIndexes.length === 1 ? '' : 's'} out of the group; the rest stay grouped.</p>}
          </>}
          <footer>
            {groupDialogMode === 'edit' && currentFrameGroup && <span className="frame-group-footer-actions">
              <button className="ungroup-button" type="button" disabled={!removableGroupFrameIndexes.length} onClick={removeSelectedFramesFromGroup} title="Take only the selected frames out of this group">Remove selected</button>
              <button className="ungroup-button" type="button" onClick={removeAllGroupFrames} title="Take every frame out of this group">Remove all</button>
            </span>}
            <button type="button" onClick={() => setGroupDialogMode(null)}>Cancel</button>
            <button type="button" onClick={saveFrameGroup}>{groupDialogMode === 'create' ? targetGroup ? 'Add to group' : 'Create group' : 'Save group'}</button>
          </footer>
        </div>
      </div>}
    </section>
  );
}
