import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { SpriteSlice, SpriteSource, Vec2 } from '../types/project';
import { anchoredSlice, clampSlice, resizeSlice, sliceHandles, type SliceHandle } from '../utils/sliceGeometry';
import '../source-preview.css';

export function SourceCropEditor({ source, slice, anchorSource, onChange }: { source: SpriteSource; slice: SpriteSlice; anchorSource?: Vec2 | null; onChange: (slice: SpriteSlice) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: Vec2; slice: SpriteSlice; handle: SliceHandle | 'move' } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [availableWidth, setAvailableWidth] = useState(220);
  const [zoom, setZoom] = useState(1);
  const [anchor, setAnchor] = useState<Vec2>({ x: 0, y: 0 });
  const fit = Math.min(availableWidth / source.width, 220 / source.height);
  const scale = Math.max(.01, fit * zoom);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.max(20, entry.contentRect.width - 16)));
    observer.observe(element);
    const wheel = (event: WheelEvent) => { event.preventDefault(); setZoom((value) => Math.max(.25, Math.min(32, value * (event.deltaY < 0 ? 1.2 : 1 / 1.2)))); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, []);
  useEffect(() => { setZoom(1); drag.current = null; pan.current = null; }, [source.id]);
  const point = (event: PointerEvent<HTMLElement>): Vec2 => {
    const rect = stage.current!.getBoundingClientRect();
    return { x: Math.round((event.clientX - rect.left) / rect.width * source.width), y: Math.round((event.clientY - rect.top) / rect.height * source.height) };
  };
  const startDrag = (event: PointerEvent<HTMLElement>, handle: SliceHandle | 'move') => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    stage.current?.setPointerCapture(event.pointerId);
    drag.current = { start: point(event), slice: { ...slice }, handle };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const start = drag.current, current = point(event);
    const delta = { x: current.x - start.start.x, y: current.y - start.start.y };
    onChange(start.handle === 'move' ? clampSlice({ ...start.slice, x: start.slice.x + delta.x, y: start.slice.y + delta.y }, source.width, source.height) : resizeSlice(start.slice, start.handle, delta, source.width, source.height));
  };
  const patch = (value: Partial<SpriteSlice>) => onChange(anchoredSlice(slice, value, anchor, source.width, source.height));
  return <>
    <div className="source-zoom-controls"><button type="button" aria-label="Zoom source out" onClick={() => setZoom((z) => Math.max(.25, z / 1.5))}>−</button><span>{Math.round(scale * 100)}%</span><button type="button" aria-label="Zoom source in" onClick={() => setZoom((z) => Math.min(32, z * 1.5))}>+</button><button type="button" onClick={() => setZoom(1)}>Fit</button><button type="button" onClick={() => setZoom(1 / fit)}>1:1</button></div>
    <div className="source-image-viewport" ref={viewport} onPointerDown={(event) => {
      if (event.button !== 1) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
    }} onPointerMove={(event) => {
      if (!pan.current) return;
      event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX;
      event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY;
    }} onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }}>
      <div ref={stage} className="source-image-stage" style={{ width: source.width * scale, height: source.height * scale }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <img src={source.src} alt={`${source.name} source preview`} draggable={false} />
        {anchorSource && <span className="source-anchor-point" title="Sprite anchor pixel" style={{ left: `${anchorSource.x / source.width * 100}%`, top: `${anchorSource.y / source.height * 100}%` }} />}
        <span className="source-slice-outline editable" onPointerDown={(event) => startDrag(event, 'move')} style={{ left: `${slice.x / source.width * 100}%`, top: `${slice.y / source.height * 100}%`, width: `${slice.width / source.width * 100}%`, height: `${slice.height / source.height * 100}%` }}>
          {sliceHandles.map((handle) => <span key={handle} className={`source-slice-handle handle-${handle}`} role="button" aria-label={`Resize crop ${handle}`} onPointerDown={(event) => startDrag(event, handle)} />)}
          <i className="source-crop-anchor" style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} />
        </span>
      </div>
    </div>
    <div className="crop-anchor-row"><span>Coordinate anchor</span><div className="crop-anchor-grid">{[0, .5, 1].flatMap((y) => [0, .5, 1].map((x) => <button key={`${x}-${y}`} type="button" aria-label={`Crop anchor ${x}, ${y}`} aria-pressed={anchor.x === x && anchor.y === y} onClick={() => setAnchor({ x, y })}>•</button>))}</div></div>
    <div className="source-slice-inputs">
      <label>X<input type="number" step={anchor.x === .5 ? .5 : 1} value={slice.x + slice.width * anchor.x} onChange={(e) => patch({ x: Number(e.target.value) })} /></label>
      <label>Y<input type="number" step={anchor.y === .5 ? .5 : 1} value={slice.y + slice.height * anchor.y} onChange={(e) => patch({ y: Number(e.target.value) })} /></label>
      <label>W<input type="number" min={1} value={slice.width} onChange={(e) => patch({ width: Number(e.target.value) })} /></label>
      <label>H<input type="number" min={1} value={slice.height} onChange={(e) => patch({ height: Number(e.target.value) })} /></label>
    </div>
    <p className="source-image-caption">Wheel: zoom · Middle drag: pan. Drag any corner or edge to resize. X/Y refer to the selected anchor; changing it does not move the sprite. The amber ring marks the sprite anchor pixel.</p>
  </>;
}
