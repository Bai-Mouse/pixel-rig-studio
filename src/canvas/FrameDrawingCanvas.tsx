import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import { renderAnimationFrame } from '../export/animationRenderer';
import '../drawing-canvas.css';

type DrawingTool = 'pencil' | 'eraser';

interface DrawPoint {
  x: number;
  y: number;
}

function paintSegment(context: CanvasRenderingContext2D, from: DrawPoint, to: DrawPoint, size: number, color: string, erase: boolean) {
  const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  context.save();
  context.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  context.fillStyle = color;
  const offset = Math.floor(size / 2);
  for (let step = 0; step <= distance; step += 1) {
    const amount = distance ? step / distance : 0;
    const x = Math.round(from.x + (to.x - from.x) * amount);
    const y = Math.round(from.y + (to.y - from.y) * amount);
    context.fillRect(x - offset, y - offset, size, size);
  }
  context.restore();
}

export function FrameDrawingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DrawPoint | null>(null);
  const loadTokenRef = useRef(0);
  const nodePreviewTokenRef = useRef(0);
  const undoRef = useRef(new Map<string, Array<string | undefined>>());
  const redoRef = useRef(new Map<string, Array<string | undefined>>());
  const [tool, setTool] = useState<DrawingTool>('pencil');
  const [color, setColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(1);
  const [zoom, setZoom] = useState(3);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [nodePreviewData, setNodePreviewData] = useState<string | null>(null);
  const assets = useProjectStore((state) => state.assets);
  const nodes = useProjectStore((state) => state.nodes);
  const rootNodeIds = useProjectStore((state) => state.rootNodeIds);
  const settings = useProjectStore((state) => state.settings);
  const frames = useProjectStore((state) => state.frames);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const onionSkinEnabled = useProjectStore((state) => state.onionSkinEnabled);
  const toggleOnionSkin = useProjectStore((state) => state.toggleOnionSkin);
  const updateCanvasFrame = useProjectStore((state) => state.updateCanvasFrame);
  const frame = frames[currentFrameIndex];

  const renderData = (data: string | undefined) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const token = ++loadTokenRef.current;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!data) return;
    const image = new Image();
    image.onload = () => {
      if (token !== loadTokenRef.current) return;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = data;
  };

  useEffect(() => {
    renderData(frame?.canvasData);
  }, [frame?.id, frame?.canvasData, settings.canvasSize.x, settings.canvasSize.y]);

  useEffect(() => {
    const token = ++nodePreviewTokenRef.current;
    void renderAnimationFrame({ assets, nodes, rootNodeIds, settings, frames }, currentFrameIndex)
      .then((canvas) => {
        if (token === nodePreviewTokenRef.current) setNodePreviewData(canvas.toDataURL('image/png'));
      })
      .catch(() => {
        if (token === nodePreviewTokenRef.current) setNodePreviewData(null);
      });
  }, [assets, currentFrameIndex, frame?.nodeStates, nodes, rootNodeIds, settings]);

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>): DrawPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) / rect.width * canvas.width))),
      y: Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) / rect.height * canvas.height))),
    };
  };

  const pushUndo = () => {
    if (!frame) return;
    const history = undoRef.current.get(frame.id) ?? [];
    undoRef.current.set(frame.id, [...history.slice(-29), frame.canvasData]);
    redoRef.current.set(frame.id, []);
    setHistoryVersion((value) => value + 1);
  };

  const commitCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    updateCanvasFrame(canvas.toDataURL('image/png'));
    setHistoryVersion((value) => value + 1);
  };

  const restoreHistory = (direction: 'undo' | 'redo') => {
    if (!frame) return;
    const source = direction === 'undo' ? undoRef.current : redoRef.current;
    const destination = direction === 'undo' ? redoRef.current : undoRef.current;
    const history = source.get(frame.id) ?? [];
    if (!history.length) return;
    const restored = history[history.length - 1];
    source.set(frame.id, history.slice(0, -1));
    destination.set(frame.id, [...(destination.get(frame.id) ?? []), frame.canvasData]);
    updateCanvasFrame(restored);
    renderData(restored);
    setHistoryVersion((value) => value + 1);
  };

  const clearCanvas = () => {
    if (!frame?.canvasData) return;
    pushUndo();
    updateCanvasFrame(undefined);
    renderData(undefined);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z') {
          event.preventDefault();
          const state = useProjectStore.getState();
          const entry = event.shiftKey ? state.redoStack[state.redoStack.length - 1] : state.transformHistory[state.transformHistory.length - 1];
          // Timeline edits (import, insert, delete, grouping) are undone by the store, not by this drawing history.
          if (entry && 'timelineBefore' in entry) {
            if (event.shiftKey) state.redoTransform(); else state.undoTransform();
          } else {
            const snapshot = entry && 'codexEditId' in entry ? event.shiftKey ? entry.before : entry.after : null;
            if (snapshot && JSON.stringify(state.frames) === JSON.stringify(snapshot.frames)) {
              if (event.shiftKey) state.redoTransform(); else state.undoTransform();
            } else restoreHistory(event.shiftKey ? 'redo' : 'undo');
          }
        } else if (key === 'y') {
          event.preventDefault();
          const state = useProjectStore.getState();
          const entry = state.redoStack[state.redoStack.length - 1];
          if (entry && 'timelineBefore' in entry) state.redoTransform();
          else if (entry && 'codexEditId' in entry && JSON.stringify(state.frames) === JSON.stringify(entry.before.frames)) state.redoTransform();
          else restoreHistory('redo');
        }
        return;
      }
      if (key === 'b') {
        event.preventDefault();
        setTool('pencil');
      } else if (key === 'e') {
        event.preventDefault();
        setTool('eraser');
      } else if (event.key === '[') {
        event.preventDefault();
        setBrushSize((value) => Math.max(1, value - 1));
      } else if (event.key === ']') {
        event.preventDefault();
        setBrushSize((value) => Math.min(32, value + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [frame?.canvasData, frame?.id]);

  const undoCount = frame ? undoRef.current.get(frame.id)?.length ?? 0 : 0;
  const redoCount = frame ? redoRef.current.get(frame.id)?.length ?? 0 : 0;
  void historyVersion;

  return (
    <main className="drawing-workspace">
      <div className="drawing-toolbar">
        <span className="canvas-title"><span className="live-dot" /> Frame drawing</span>
        <span className="canvas-size">Frame {currentFrameIndex + 1} · {settings.canvasSize.x} × {settings.canvasSize.y}</span>
        <span className="drawing-divider" />
        <button className={tool === 'pencil' ? 'active' : ''} type="button" onClick={() => setTool('pencil')} title="Pencil (B)"><Icon name="pixel" /> Pencil</button>
        <button className={tool === 'eraser' ? 'active' : ''} type="button" onClick={() => setTool('eraser')} title="Eraser (E)"><Icon name="trash" /> Eraser</button>
        <label className="drawing-color">Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <label className="drawing-size">Size<input type="number" min="1" max="32" value={brushSize} onChange={(event) => setBrushSize(Math.max(1, Math.min(32, Number(event.target.value) || 1)))} /></label>
        <span className="drawing-divider" />
        <button type="button" disabled={!undoCount} onClick={() => restoreHistory('undo')} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" disabled={!redoCount} onClick={() => restoreHistory('redo')} title="Redo (Ctrl+Y / Ctrl+Shift+Z)">Redo</button>
        <button type="button" disabled={!frame?.canvasData} onClick={clearCanvas}>Clear frame</button>
        <button className={onionSkinEnabled ? 'active' : ''} type="button" onClick={toggleOnionSkin}><Icon name="onion" /> Onion</button>
        <div className="drawing-zoom"><button type="button" onClick={() => setZoom((value) => Math.max(1, value - 1))}><Icon name="zoomOut" /></button><span>{zoom}×</span><button type="button" onClick={() => setZoom((value) => Math.min(12, value + 1))}><Icon name="zoomIn" /></button></div>
      </div>
      <div className="drawing-stage">
        <div className="drawing-paper" style={{ width: settings.canvasSize.x * zoom, height: settings.canvasSize.y * zoom }}>
          {nodePreviewData && <img className="drawing-node-preview" src={nodePreviewData} alt="Current node layers" />}
          {onionSkinEnabled && frames[currentFrameIndex - 1]?.canvasData && <img className="drawing-onion previous" src={frames[currentFrameIndex - 1].canvasData} alt="Previous frame onion skin" />}
          {onionSkinEnabled && frames[currentFrameIndex + 1]?.canvasData && <img className="drawing-onion next" src={frames[currentFrameIndex + 1].canvasData} alt="Next frame onion skin" />}
          <canvas
            ref={canvasRef}
            width={settings.canvasSize.x}
            height={settings.canvasSize.y}
            style={{ width: settings.canvasSize.x * zoom, height: settings.canvasSize.y * zoom }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const point = pointFromEvent(event);
              const context = canvasRef.current?.getContext('2d');
              if (!point || !context) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              pushUndo();
              dragRef.current = point;
              paintSegment(context, point, point, brushSize, color, tool === 'eraser');
            }}
            onPointerMove={(event) => {
              const previous = dragRef.current;
              const point = pointFromEvent(event);
              const context = canvasRef.current?.getContext('2d');
              if (!previous || !point || !context) return;
              paintSegment(context, previous, point, brushSize, color, tool === 'eraser');
              dragRef.current = point;
            }}
            onPointerUp={() => { if (dragRef.current) commitCanvas(); dragRef.current = null; }}
            onPointerCancel={() => { if (dragRef.current) commitCanvas(); dragRef.current = null; }}
          />
        </div>
      </div>
    </main>
  );
}
