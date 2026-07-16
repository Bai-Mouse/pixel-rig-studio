import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import {
  clonePixelDocument,
  colorAt,
  compositeDocument,
  createPixelDocument,
  drawLine,
  drawRectangle,
  floodFill,
  hexToRgba,
  rgbaToHex,
  toPngDataUrl,
  type PixelDocument,
  type PixelTool,
  type Rgba,
} from './pixelDocument';

interface PixelEditorProps {
  assetId: string;
  onClose: () => void;
}

interface PixelDrag {
  start: { x: number; y: number };
  last: { x: number; y: number };
  layerId: string;
  tool: PixelTool;
  source: PixelDocument;
}

const tools: Array<{ id: PixelTool; label: string; shortcut: string }> = [
  { id: 'pencil', label: 'Pencil', shortcut: 'P' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'fill', label: 'Fill', shortcut: 'F' },
  { id: 'eyedropper', label: 'Eyedropper', shortcut: 'I' },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'U' },
  { id: 'line', label: 'Line', shortcut: 'L' },
];

const palette = ['#ffffff', '#d6d9e8', '#7e86a6', '#3f465f', '#151821', '#ed6a70', '#f3a45f', '#f4dc78', '#72d9aa', '#67bfe2', '#778cf5', '#af82e7'];

export function PixelEditor({ assetId, onClose }: PixelEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<PixelDrag | null>(null);
  const historyRef = useRef<PixelDocument[]>([]);
  const redoRef = useRef<PixelDocument[]>([]);
  const asset = useProjectStore((state) => state.assets[assetId]);
  const updateAssetSource = useProjectStore((state) => state.updateAssetSource);
  const [pixelDocument, setPixelDocument] = useState<PixelDocument | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [tool, setTool] = useState<PixelTool>('pencil');
  const [color, setColor] = useState('#778cf5');
  const [zoom, setZoom] = useState(12);
  const [showGrid, setShowGrid] = useState(true);
  const [symmetry, setSymmetry] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    void createPixelDocument(asset).then((document) => {
      if (cancelled) return;
      setPixelDocument(document);
      setActiveLayerId(document.layers[0].id);
      historyRef.current = [];
      redoRef.current = [];
      setHistoryVersion((value) => value + 1);
      const fitZoom = Math.floor(430 / Math.max(document.width, document.height));
      setZoom(Math.max(4, Math.min(20, fitZoom)));
    }).catch(() => onClose());
    return () => { cancelled = true; };
    // The document is loaded only when choosing a different sprite; live save updates the asset source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixelDocument) return;
    canvas.width = pixelDocument.width * zoom;
    canvas.height = pixelDocument.height * zoom;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const source = document.createElement('canvas');
    source.width = pixelDocument.width;
    source.height = pixelDocument.height;
    source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(compositeDocument(pixelDocument)), pixelDocument.width, pixelDocument.height), 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (showGrid && zoom >= 5) {
      context.beginPath();
      context.strokeStyle = 'rgba(238, 241, 255, 0.25)';
      context.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += zoom) { context.moveTo(x + 0.5, 0); context.lineTo(x + 0.5, canvas.height); }
      for (let y = 0; y <= canvas.height; y += zoom) { context.moveTo(0, y + 0.5); context.lineTo(canvas.width, y + 0.5); }
      context.stroke();
    }
  }, [pixelDocument, showGrid, zoom]);

  useEffect(() => {
    if (!pixelDocument) return;
    updateAssetSource(assetId, toPngDataUrl(pixelDocument), pixelDocument.width, pixelDocument.height);
  }, [assetId, pixelDocument, updateAssetSource]);

  const pushHistory = (document: PixelDocument) => {
    historyRef.current = [...historyRef.current.slice(-29), clonePixelDocument(document)];
    redoRef.current = [];
    setHistoryVersion((value) => value + 1);
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous || !pixelDocument) return;
    redoRef.current.push(clonePixelDocument(pixelDocument));
    setPixelDocument(previous);
    setHistoryVersion((value) => value + 1);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next || !pixelDocument) return;
    historyRef.current.push(clonePixelDocument(pixelDocument));
    setPixelDocument(next);
    setHistoryVersion((value) => value + 1);
  };

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !pixelDocument) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / zoom);
    const y = Math.floor((event.clientY - rect.top) / zoom);
    if (x < 0 || y < 0 || x >= pixelDocument.width || y >= pixelDocument.height) return null;
    return { x, y };
  };

  const paint = (source: PixelDocument, activeTool: PixelTool, layerId: string, start: { x: number; y: number }, end: { x: number; y: number }) => {
    const next = clonePixelDocument(source);
    const paintColor: Rgba = activeTool === 'eraser' ? [0, 0, 0, 0] : hexToRgba(color);
    if (activeTool === 'pencil' || activeTool === 'eraser') drawLine(next, layerId, start.x, start.y, end.x, end.y, paintColor, symmetry);
    if (activeTool === 'rectangle') drawRectangle(next, layerId, start.x, start.y, end.x, end.y, paintColor, symmetry);
    if (activeTool === 'line') drawLine(next, layerId, start.x, start.y, end.x, end.y, paintColor, symmetry);
    return next;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (!pixelDocument || !activeLayerId || !point) return;
    const activeLayer = pixelDocument.layers.find((layer) => layer.id === activeLayerId);
    if (!activeLayer) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'eyedropper') {
      setColor(rgbaToHex(colorAt(pixelDocument, point.x, point.y)));
      setTool('pencil');
      return;
    }
    pushHistory(pixelDocument);
    if (tool === 'fill') {
      const next = clonePixelDocument(pixelDocument);
      floodFill(next, activeLayerId, point.x, point.y, hexToRgba(color), symmetry);
      setPixelDocument(next);
      return;
    }
    dragRef.current = { start: point, last: point, layerId: activeLayerId, tool, source: clonePixelDocument(pixelDocument) };
    setPixelDocument(paint(pixelDocument, tool, activeLayerId, point, point));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const point = pointFromEvent(event);
    if (!drag || !point) return;
    if (drag.tool === 'pencil' || drag.tool === 'eraser') {
      setPixelDocument((current) => current ? paint(current, drag.tool, drag.layerId, drag.last, point) : current);
      drag.last = point;
      return;
    }
    setPixelDocument(paint(drag.source, drag.tool, drag.layerId, drag.start, point));
  };

  const addLayer = () => {
    if (!pixelDocument) return;
    pushHistory(pixelDocument);
    const layer = { id: crypto.randomUUID(), name: `Layer ${pixelDocument.layers.length + 1}`, visible: true, pixels: new Uint8ClampedArray(pixelDocument.width * pixelDocument.height * 4) };
    setPixelDocument({ ...pixelDocument, layers: [...pixelDocument.layers, layer] });
    setActiveLayerId(layer.id);
  };

  const toggleLayer = (layerId: string) => {
    if (!pixelDocument) return;
    pushHistory(pixelDocument);
    setPixelDocument({ ...pixelDocument, layers: pixelDocument.layers.map((layer) => layer.id === layerId ? { ...layer, visible: !layer.visible } : layer) });
  };

  const deleteLayer = () => {
    if (!pixelDocument || pixelDocument.layers.length === 1 || !activeLayerId) return;
    pushHistory(pixelDocument);
    const layers = pixelDocument.layers.filter((layer) => layer.id !== activeLayerId);
    setPixelDocument({ ...pixelDocument, layers });
    setActiveLayerId(layers.length ? layers[layers.length - 1].id : null);
  };

  if (!asset || !pixelDocument) return null;

  return (
    <div className="pixel-editor-overlay" role="dialog" aria-modal="true" aria-label="Pixel editor">
      <section className="pixel-editor">
        <header className="pixel-editor-header">
          <div><span className="pixel-editor-mark" /> <strong>Pixel editor</strong><small>{asset.name} - live canvas update</small></div>
          <button type="button" onClick={onClose}>Done</button>
        </header>
        <div className="pixel-editor-body">
          <aside className="pixel-tools-panel">
            <span className="editor-section-label">TOOLS</span>
            <div className="pixel-tool-list">
              {tools.map((item) => <button key={item.id} type="button" className={tool === item.id ? 'active' : ''} onClick={() => setTool(item.id)} title={`${item.label} (${item.shortcut})`}><span>{item.label}</span><kbd>{item.shortcut}</kbd></button>)}
            </div>
            <span className="editor-section-label">COLOR</span>
            <div className="color-control"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><span>{color.toUpperCase()}</span></div>
            <div className="palette-grid">{palette.map((shade) => <button key={shade} type="button" className={color === shade ? 'selected' : ''} style={{ background: shade }} aria-label={`Use ${shade}`} onClick={() => setColor(shade)} />)}</div>
            <div className="pixel-option-list">
              <label><input type="checkbox" checked={showGrid} onChange={() => setShowGrid((value) => !value)} /> Grid</label>
              <label><input type="checkbox" checked={symmetry} onChange={() => setSymmetry((value) => !value)} /> Symmetry</label>
            </div>
          </aside>
          <main className="pixel-canvas-area">
            <div className="pixel-canvas-controls">
              <button type="button" onClick={undo} disabled={!historyRef.current.length}>Undo</button>
              <button type="button" onClick={redo} disabled={!redoRef.current.length}>Redo</button>
              <span />
              <button type="button" onClick={() => setZoom((value) => Math.max(2, value - 1))}>-</button>
              <strong>{zoom}x</strong>
              <button type="button" onClick={() => setZoom((value) => Math.min(32, value + 1))}>+</button>
            </div>
            <div className="pixel-canvas-scroll">
              <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} />
            </div>
            <footer>{pixelDocument.width} x {pixelDocument.height} px <span /> {tool} <span /> {historyVersion ? 'Edited' : 'Ready'}</footer>
          </main>
          <aside className="pixel-layers-panel">
            <div className="layers-header"><span className="editor-section-label">LAYERS</span><button type="button" onClick={addLayer}><Icon name="plus" size={14} /></button></div>
            <div className="pixel-layer-list">
              {[...pixelDocument.layers].reverse().map((layer) => <button key={layer.id} type="button" className={layer.id === activeLayerId ? 'selected' : ''} onClick={() => setActiveLayerId(layer.id)}><span className="layer-visibility" onClick={(event) => { event.stopPropagation(); toggleLayer(layer.id); }}><Icon name={layer.visible ? 'eye' : 'eyeOff'} size={13} /></span><span>{layer.name}</span></button>)}
            </div>
            <button className="delete-layer-button" type="button" disabled={pixelDocument.layers.length === 1} onClick={deleteLayer}><Icon name="trash" size={13} /> Delete layer</button>
          </aside>
        </div>
      </section>
    </div>
  );
}
