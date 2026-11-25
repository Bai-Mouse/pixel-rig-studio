import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { inspectorFrameIds, useProjectStore } from '../state/projectStore';
import { nodeSpriteIdForFrame, type AnimationFrame, type NodeFrameState, type RigNode, type SpriteAsset, type TransformTool, type Vec2 } from '../types/project';
import { DEFAULT_PIXEL_ALPHA_THRESHOLD, snapToGrid } from './pixelRotation';
import { spriteRasterCache } from './spriteRasterCache';
import { rotationDragDelta } from './rotationDrag';
import { effectiveSpriteAnchor } from '../utils/spriteAnchor';
import { activeFootLocks, bendDistance, bendHandle, captureFootLock, ikChain, isAncestor, nodePivotWorld } from '../state/twoBoneIk';
import { IkBindings } from './IkBindings';
import { drawGizmo, hitGizmo, hitTransformHandle, moveGizmoPosition, transformControl, transformToolForKey, type GizmoPart } from './transformControls';

const imageCache = new Map<string, HTMLImageElement>();
let drawingPreview: { source: string; image: HTMLImageElement } | null = null;

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface TransformDrag {
  pointerId: number;
  tool: Exclude<TransformTool, 'select' | 'ik'>;
  nodeId: string;
  startWorld: Vec2;
  parentMatrix: Matrix;
  nodeMatrix: Matrix;
  startState: NodeFrameState;
  rotationLastPoint: Vec2;
  rotationDegrees: number;
  rotationOffset?: Vec2;
  moveAxis?: GizmoPart;
  startScaleAxes: Vec2;
  pivotAsset?: SpriteAsset;
}

const identityMatrix: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function isEditingText(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

function frameStateFor(node: RigNode, frame: AnimationFrame): NodeFrameState {
  return frame.nodeStates[node.id] ?? {
    position: node.transform.position,
    rotation: node.transform.rotation,
    scale: node.transform.scale,
    visible: node.visible,
    imageIndex: 0,
    sortingOrder: node.sortingOrder ?? 0,
  };
}

function matrixFromState(state: NodeFrameState): Matrix {
  const radians = state.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine * state.scale.x,
    b: sine * state.scale.x,
    c: -sine * state.scale.y,
    d: cosine * state.scale.y,
    e: state.position.x,
    f: state.position.y,
  };
}

function multiplyMatrices(parent: Matrix, child: Matrix): Matrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

function inverseTransformPoint(matrix: Matrix, point: Vec2): Vec2 | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 0.00001) return null;
  const x = point.x - matrix.e;
  const y = point.y - matrix.f;
  return { x: (matrix.d * x - matrix.c * y) / determinant, y: (-matrix.b * x + matrix.a * y) / determinant };
}

/** Converts a world point into the node's rotated, but unscaled, local axes. */
function pointInNodeScaleAxes(parentMatrix: Matrix, state: NodeFrameState, worldPoint: Vec2): Vec2 | null {
  const pointInParent = inverseTransformPoint(parentMatrix, worldPoint);
  if (!pointInParent) return null;
  const x = pointInParent.x - state.position.x;
  const y = pointInParent.y - state.position.y;
  const radians = state.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: cosine * x + sine * y, y: -sine * x + cosine * y };
}

function scaledAxis(startScale: number, startAxis: number, currentAxis: number) {
  if (!Number.isFinite(startScale) || !Number.isFinite(startAxis) || !Number.isFinite(currentAxis) || Math.abs(startAxis) < 0.5) return startScale;
  const raw = startScale * currentAxis / startAxis;
  if (!Number.isFinite(raw)) return startScale;
  const sign = raw < 0 ? -1 : raw > 0 ? 1 : Math.sign(startScale) || 1;
  return sign * Math.min(16, Math.max(0.05, Math.abs(raw)));
}

function getWorldMatrix(nodes: Record<string, RigNode>, frame: AnimationFrame, nodeId: string, cache: Map<string, Matrix>): Matrix {
  const cached = cache.get(nodeId);
  if (cached) return cached;
  const node = nodes[nodeId];
  if (!node) return identityMatrix;
  const parent = node.parentId ? getWorldMatrix(nodes, frame, node.parentId, cache) : identityMatrix;
  const world = multiplyMatrices(parent, matrixFromState(frameStateFor(node, frame)));
  cache.set(nodeId, world);
  return world;
}

function displayMatrix(matrix: Matrix, pixelPerfect: boolean, gridSize: number): Matrix {
  return pixelPerfect ? { ...matrix, e: snapToGrid(matrix.e, gridSize), f: snapToGrid(matrix.f, gridSize) } : matrix;
}

function nodeControl(tool: TransformTool, node: RigNode, state: NodeFrameState, matrix: Matrix, asset: SpriteAsset | undefined, zoom: number) {
  if (node.locked || !node.visible || !state.visible || (tool === 'pivot' && !asset)) return null;
  const sprite = asset && { width: asset.width, height: asset.height, anchor: effectiveSpriteAnchor(asset, node.pivot) };
  return transformControl(tool, matrix, zoom, sprite);
}

function orderedNodes(nodes: Record<string, RigNode>, roots: string[]) {
  const result: string[] = [];
  const visit = (id: string) => {
    const node = nodes[id];
    if (!node) return;
    result.push(id);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return result;
}

function getImage(src: string, onReady: () => void) {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.onload = onReady;
  image.src = src;
  imageCache.set(src, image);
  return image;
}

function getDrawingPreview(source: string, onReady: () => void) {
  if (drawingPreview?.source === source) return drawingPreview.image;
  const image = new Image();
  image.onload = onReady;
  image.src = source;
  drawingPreview = { source, image };
  return image;
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, originX: number, originY: number, zoom: number, size: number) {
  const left = -originX / zoom;
  const right = (width - originX) / zoom;
  const top = -originY / zoom;
  const bottom = (height - originY) / zoom;
  const firstX = Math.floor(left / size) * size;
  const firstY = Math.floor(top / size) * size;
  context.lineWidth = 1 / zoom;
  context.strokeStyle = 'rgba(136, 151, 202, 0.16)';
  context.beginPath();
  for (let x = firstX; x <= right; x += size) { context.moveTo(x, top); context.lineTo(x, bottom); }
  for (let y = firstY; y <= bottom; y += size) { context.moveTo(left, y); context.lineTo(right, y); }
  context.stroke();
  context.strokeStyle = 'rgba(164, 178, 232, 0.42)';
  context.beginPath();
  context.moveTo(left, 0); context.lineTo(right, 0);
  context.moveTo(0, top); context.lineTo(0, bottom);
  context.stroke();
}

interface AnimationCanvasProps {
  showGrid: boolean;
}

export function AnimationCanvas({ showGrid }: AnimationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const assets = useProjectStore((state) => state.assets);
  const nodes = useProjectStore((state) => state.nodes);
  const roots = useProjectStore((state) => state.rootNodeIds);
  const settings = useProjectStore((state) => state.settings);
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId);
  const frames = useProjectStore((state) => state.frames);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const isPlaying = useProjectStore((state) => state.isPlaying);
  const allSelectedLocked = useProjectStore((state) => {
    const id = state.selectedNodeId;
    if (!id) return false;
    const selection = new Set(inspectorFrameIds(state));
    return selection.size > 0 && state.frames.every((frame) => !selection.has(frame.id) || Boolean(frame.footLocks?.[id]));
  });
  const selectedFrameCount = useProjectStore((state) => inspectorFrameIds(state).length);
  const onionSkinEnabled = useProjectStore((state) => state.onionSkinEnabled);
  const activeTool = useProjectStore((state) => state.activeTool);
  const showPivot = useProjectStore((state) => state.showPivot);
  const snapEnabled = useProjectStore((state) => state.snapEnabled);
  const selectNode = useProjectStore((state) => state.selectNode);
  const setActiveTool = useProjectStore((state) => state.setActiveTool);
  const beginTransform = useProjectStore((state) => state.beginTransform);
  const beginIk = useProjectStore((state) => state.beginIk);
  const dragIk = useProjectStore((state) => state.dragIk);
  const dragIkBend = useProjectStore((state) => state.dragIkBend);
  const toggleFootLock = useProjectStore((state) => state.toggleFootLock);
  const reverseIkBend = useProjectStore((state) => state.reverseIkBend);
  const updateNodeFrame = useProjectStore((state) => state.updateNodeFrame);
  const commitTransform = useProjectStore((state) => state.commitTransform);
  const updateNodePivot = useProjectStore((state) => state.updateNodePivot);
  const setAssetAnchorKeepingPixels = useProjectStore((state) => state.setAssetAnchorKeepingPixels);
  const duplicateNode = useProjectStore((state) => state.duplicateNode);
  const deleteNode = useProjectStore((state) => state.deleteNode);
  const undoTransform = useProjectStore((state) => state.undoTransform);
  const redoTransform = useProjectStore((state) => state.redoTransform);
  const dragRef = useRef<TransformDrag | null>(null);
  const ikDrag = useRef<({ pointerId: number } & (
    { kind: 'position'; start: Vec2 } | { kind: 'bend'; root: Vec2; tip: Vec2; side: -1 | 1 }
  )) | null>(null);
  const [ikMessage, setIkMessage] = useState<string | null>(null);
  const [activeGizmo, setActiveGizmo] = useState<GizmoPart | null>(null);
  const [bending, setBending] = useState(false);
  const currentFrame = frames[currentFrameIndex];
  const chain = selectedNodeId && activeTool === 'ik' ? ikChain(nodes, selectedNodeId) : null;
  const canSolveIk = Boolean(chain && currentFrame && captureFootLock(nodes, currentFrame, chain.end.id));

  useEffect(() => { setIkMessage(null); }, [selectedNodeId, currentFrame?.id, activeTool]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = '#161923';
    context.fillRect(0, 0, rect.width, rect.height);

    const originX = Math.round(rect.width / 2 + pan.x);
    const originY = Math.round(rect.height / 2 + pan.y);
    context.save();
    context.translate(originX, originY);
    context.scale(zoom, zoom);
    if (showGrid) drawGrid(context, rect.width, rect.height, originX, originY, zoom, settings.gridSize);

    context.fillStyle = '#1d2230';
    context.fillRect(-settings.canvasSize.x / 2, -settings.canvasSize.y / 2, settings.canvasSize.x, settings.canvasSize.y);
    context.strokeStyle = 'rgba(175, 190, 245, 0.52)';
    context.lineWidth = 1 / zoom;
    context.strokeRect(-settings.canvasSize.x / 2, -settings.canvasSize.y / 2, settings.canvasSize.x, settings.canvasSize.y);

    const drawNode = (node: RigNode, frame: AnimationFrame, showSelection: boolean, matrixCache: Map<string, Matrix>) => {
      const nodeState = frameStateFor(node, frame);
      if (!node.visible || !nodeState.visible) return;
      const worldMatrix = getWorldMatrix(nodes, frame, node.id, matrixCache);
      const assetId = nodeSpriteIdForFrame(node, nodeState);
      const asset: SpriteAsset | undefined = assetId ? assets[assetId] : undefined;
      if (asset) {
        const anchor = effectiveSpriteAnchor(asset, node.pivot);
        const image = getImage(asset.src, render);
        if (image.complete && image.naturalWidth) {
          const anchorX = snapToGrid(worldMatrix.e, settings.pixelGridSize);
          const anchorY = snapToGrid(worldMatrix.f, settings.pixelGridSize);
          const drawTransformOverlays = (translationX: number, translationY: number, drawBounds: boolean) => {
            if (!showSelection || node.id !== selectedNodeId) return;
            context.save();
            context.transform(worldMatrix.a, worldMatrix.b, worldMatrix.c, worldMatrix.d, translationX, translationY);
            context.strokeStyle = '#9ea9ff';
            context.lineWidth = 1 / zoom;
            if (drawBounds) context.strokeRect(-anchor.x - 2 / zoom, -anchor.y - 2 / zoom, asset.width + 4 / zoom, asset.height + 4 / zoom);
            if (showPivot && activeTool !== 'pivot' && activeTool !== 'move') {
              context.strokeStyle = '#aeb7ff';
              context.beginPath();
              context.moveTo(-5 / zoom, 0); context.lineTo(5 / zoom, 0);
              context.moveTo(0, -5 / zoom); context.lineTo(0, 5 / zoom);
              context.stroke();
              context.beginPath();
              context.arc(0, 0, 3 / zoom, 0, Math.PI * 2);
              context.stroke();
            }
            context.restore();
          };

          if (settings.pixelPerfectRotation) {
            const worldDeterminant = worldMatrix.a * worldMatrix.d - worldMatrix.b * worldMatrix.c;
            try {
              const rasterized = spriteRasterCache.get(asset.id, image, {
                angleRadians: Math.atan2(worldMatrix.b, worldMatrix.a),
                scaleX: Math.hypot(worldMatrix.a, worldMatrix.b),
                scaleY: Math.sign(worldDeterminant || 1) * Math.hypot(worldMatrix.c, worldMatrix.d),
                pivotX: anchor.x,
                pivotY: anchor.y,
                pixelGridSize: settings.pixelGridSize,
                alphaThreshold: DEFAULT_PIXEL_ALPHA_THRESHOLD,
                fillSinglePixelGaps: true,
                linearTransform: {
                  a: worldMatrix.a,
                  b: worldMatrix.b,
                  c: worldMatrix.c,
                  d: worldMatrix.d,
                },
              });
              context.drawImage(rasterized.canvas, anchorX + rasterized.offsetX, anchorY + rasterized.offsetY);
              if (showSelection && node.id === selectedNodeId) {
                context.save();
                context.strokeStyle = '#9ea9ff';
                context.lineWidth = 1 / zoom;
                context.strokeRect(
                  anchorX + rasterized.offsetX - 2 / zoom,
                  anchorY + rasterized.offsetY - 2 / zoom,
                  rasterized.width + 4 / zoom,
                  rasterized.height + 4 / zoom,
                );
                context.restore();
              }
              drawTransformOverlays(anchorX, anchorY, false);
            } catch {
              // A malformed or extreme scale should not take down the entire canvas.
              context.save();
              context.transform(worldMatrix.a, worldMatrix.b, worldMatrix.c, worldMatrix.d, anchorX, anchorY);
              context.drawImage(image, -anchor.x, -anchor.y, asset.width, asset.height);
              context.restore();
              drawTransformOverlays(anchorX, anchorY, true);
            }
          } else {
            context.save();
            context.transform(worldMatrix.a, worldMatrix.b, worldMatrix.c, worldMatrix.d, anchorX, anchorY);
            context.drawImage(image, -anchor.x, -anchor.y, asset.width, asset.height);
            context.restore();
            drawTransformOverlays(anchorX, anchorY, true);
          }
        }
      }
    };
    const drawFrame = (frame: AnimationFrame | undefined, opacity: number, showSelection: boolean) => {
      if (!frame) return;
      context.save();
      context.globalAlpha = opacity;
      const matrixCache = new Map<string, Matrix>();
      orderedNodes(nodes, roots)
        .sort((leftId, rightId) => {
          const leftNode = nodes[leftId];
          const rightNode = nodes[rightId];
          return (leftNode ? frameStateFor(leftNode, frame).sortingOrder : 0) - (rightNode ? frameStateFor(rightNode, frame).sortingOrder : 0);
        })
        .forEach((id) => {
        const node = nodes[id];
        if (node) drawNode(node, frame, showSelection, matrixCache);
        });
      context.restore();
    };
    if (onionSkinEnabled) {
      drawFrame(frames[currentFrameIndex - 1], 0.16, false);
      drawFrame(frames[currentFrameIndex + 1], 0.11, false);
    }
    drawFrame(frames[currentFrameIndex], 1, true);
    const canvasData = frames[currentFrameIndex]?.canvasData;
    if (canvasData) {
      const drawing = getDrawingPreview(canvasData, render);
      if (drawing.complete && drawing.naturalWidth) {
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(drawing, -settings.canvasSize.x / 2, -settings.canvasSize.y / 2, settings.canvasSize.x, settings.canvasSize.y);
        context.restore();
      }
    }
    const frame = frames[currentFrameIndex];
    const selectedNode = selectedNodeId ? nodes[selectedNodeId] : undefined;
    if (frame && selectedNode && !isPlaying) {
      const state = frameStateFor(selectedNode, frame);
      const id = nodeSpriteIdForFrame(selectedNode, state);
      const matrix = displayMatrix(getWorldMatrix(nodes, frame, selectedNode.id, new Map()), settings.pixelPerfectRotation, settings.pixelGridSize);
      const control = nodeControl(activeTool, selectedNode, state, matrix, id ? assets[id] : undefined, zoom);
      if ((activeTool === 'move' || activeTool === 'rotate') && !selectedNode.locked && selectedNode.visible && state.visible) {
        drawGizmo(context, activeTool, { x: matrix.e, y: matrix.f }, zoom, { x: matrix.a, y: matrix.b }, activeGizmo);
      } else if (control) {
        const { center, edge } = control;
        const color = activeTool === 'scale' ? '#72d9bb' : '#ffc578';
        context.strokeStyle = color;
        context.lineWidth = 1.5 / zoom;
        if (edge) {
          context.beginPath();
          context.moveTo(edge.x, edge.y);
          context.lineTo(center.x, center.y);
          context.stroke();
        }
        const size = 5 / zoom;
        context.beginPath();
        if (activeTool === 'scale') context.rect(center.x - size, center.y - size, size * 2, size * 2);
        else context.arc(center.x, center.y, size, 0, Math.PI * 2);
        context.fillStyle = '#17191f';
        context.fill();
        context.stroke();
        if (!edge) {
          const line = 8 / zoom;
          context.beginPath();
          context.moveTo(center.x - line, center.y); context.lineTo(center.x + line, center.y);
          context.moveTo(center.x, center.y - line); context.lineTo(center.x, center.y + line);
          context.stroke();
        }
      }
    }
    if (frame && !isPlaying && (activeTool === 'ik' || activeTool === 'move')) {
      const locks = activeFootLocks(nodes, frame);
      const selectedChain = activeTool === 'ik' && selectedNodeId ? ikChain(nodes, selectedNodeId) : null;
      const drawMarker = (point: Vec2, color: string, size: number) => {
        context.beginPath();
        context.arc(point.x, point.y, size / zoom, 0, Math.PI * 2);
        context.fillStyle = '#17191f';
        context.fill();
        context.strokeStyle = color;
        context.stroke();
      };
      context.lineWidth = 1.5 / zoom;
      if (selectedChain) {
        const points = [selectedChain.upper, selectedChain.lower, selectedChain.end].map((node) => nodePivotWorld(nodes, frame, node.id));
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.strokeStyle = '#7ae1bf';
        context.stroke();
        points.slice(0, 2).forEach((point) => drawMarker(point, '#7ae1bf', 3));
        if (captureFootLock(nodes, frame, selectedChain.end.id) && !locks.some(([id]) => id === selectedChain.end.id)) {
          const world = getWorldMatrix(nodes, frame, selectedChain.end.id, new Map());
          drawGizmo(context, 'ik', points[2], zoom, { x: world.a, y: world.b }, activeGizmo);
        }
        const handle = captureFootLock(nodes, frame, selectedChain.end.id) && bendHandle(points[0], points[1], points[2], zoom);
        if (handle) {
          context.strokeStyle = bending ? '#ffe69c' : '#bfadff';
          context.beginPath();
          context.moveTo(points[1].x, points[1].y);
          context.lineTo(handle.x, handle.y);
          context.setLineDash([3 / zoom, 3 / zoom]);
          context.stroke();
          context.setLineDash([]);
          const size = 6 / zoom;
          context.beginPath();
          context.moveTo(handle.x, handle.y - size);
          context.lineTo(handle.x + size, handle.y);
          context.lineTo(handle.x, handle.y + size);
          context.lineTo(handle.x - size, handle.y);
          context.closePath();
          context.fillStyle = '#17191f';
          context.fill();
          context.stroke();
        }
      }
      for (const [id, lock] of locks) {
        const actual = nodePivotWorld(nodes, frame, id);
        if (Math.hypot(actual.x - lock.point.x, actual.y - lock.point.y) > .01) {
          context.beginPath();
          context.moveTo(actual.x, actual.y);
          context.lineTo(lock.point.x, lock.point.y);
          context.strokeStyle = '#ffbf75';
          context.setLineDash([3 / zoom, 3 / zoom]);
          context.stroke();
          context.setLineDash([]);
        }
        drawMarker(lock.point, '#ffbf75', 5);
      }
    }
    context.restore();
  }, [activeGizmo, activeTool, assets, bending, currentFrameIndex, frames, isPlaying, nodes, onionSkinEnabled, pan.x, pan.y, roots, selectedNodeId, settings, showGrid, showPivot, zoom]);

  useEffect(() => {
    render();
    const observer = new ResizeObserver(render);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [render]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.isComposing && !isEditingText(event.target)) setSpaceDown(true);
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(false); };
    const resetSpace = () => setSpaceDown(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', resetSpace);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', resetSpace);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || isEditingText(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 'd' && selectedNodeId) { event.preventDefault(); duplicateNode(selectedNodeId); }
        if (key === 'z') { event.preventDefault(); if (event.shiftKey) redoTransform(); else undoTransform(); }
        if (key === 'y') { event.preventDefault(); redoTransform(); }
        return;
      }
      const tool = transformToolForKey(event);
      if (tool) { event.preventDefault(); setActiveTool(tool); }
      if (event.key === 'Delete' && selectedNodeId) { event.preventDefault(); deleteNode(selectedNodeId); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteNode, duplicateNode, redoTransform, selectedNodeId, setActiveTool, undoTransform]);

  const pointerToWorld = (event: React.PointerEvent<HTMLDivElement>): Vec2 | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const originX = Math.round(rect.width / 2 + pan.x);
    const originY = Math.round(rect.height / 2 + pan.y);
    return { x: (event.clientX - rect.left - originX) / zoom, y: (event.clientY - rect.top - originY) / zoom };
  };

  const hitTest = (worldPoint: Vec2, frame: AnimationFrame): string | null => {
    const cache = new Map<string, Matrix>();
    const nodeIds = orderedNodes(nodes, roots)
      .sort((leftId, rightId) => frameStateFor(nodes[leftId], frame).sortingOrder - frameStateFor(nodes[rightId], frame).sortingOrder)
      .reverse();
    for (const id of nodeIds) {
      const node = nodes[id];
      const nodeState = node ? frameStateFor(node, frame) : null;
      const assetId = node && nodeState ? nodeSpriteIdForFrame(node, nodeState) : null;
      const asset = assetId ? assets[assetId] : undefined;
      if (!node || !asset || !node.visible || !frameStateFor(node, frame).visible) continue;
      const anchor = effectiveSpriteAnchor(asset, node.pivot);
      const matrix = displayMatrix(getWorldMatrix(nodes, frame, id, cache), settings.pixelPerfectRotation, settings.pixelGridSize);
      const local = inverseTransformPoint(matrix, worldPoint);
      if (local && local.x >= -anchor.x && local.x <= asset.width - anchor.x && local.y >= -anchor.y && local.y <= asset.height - anchor.y) return id;
    }
    return null;
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (dragStart.current?.pointerId === event.pointerId) {
      dragStart.current = null;
      setIsPanning(false);
    }
    if (ikDrag.current?.pointerId === event.pointerId) {
      ikDrag.current = null;
      setActiveGizmo(null);
      setBending(false);
      commitTransform();
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setActiveGizmo(null);
    if (drag.tool !== 'pivot') {
      commitTransform();
      return;
    }
    const node = nodes[drag.nodeId];
    const asset = drag.pivotAsset;
    const point = !cancelled && pointerToWorld(event);
    if (!node || !asset || !point) return;
    const start = inverseTransformPoint(drag.nodeMatrix, drag.startWorld);
    const end = inverseTransformPoint(drag.nodeMatrix, point);
    if (!start || !end) return;
    const anchor = effectiveSpriteAnchor(asset, node.pivot);
    const next = {
      x: Math.min(asset.width, Math.max(0, Math.round(anchor.x + end.x - start.x))),
      y: Math.min(asset.height, Math.max(0, Math.round(anchor.y + end.y - start.y))),
    };
    if (next.x === anchor.x && next.y === anchor.y) return;
    // Change the anchor only after a real drag, compensating the pose so pixels stay put.
    if (asset.anchor) setAssetAnchorKeepingPixels(asset.id, node.id, next);
    else updateNodePivot(node.id, next);
  };

  return (
    <main className="canvas-workspace">
      <div className="canvas-header">
        <span className="canvas-title"><span className="live-dot" /> Animation canvas</span>
        <span className="canvas-size">{settings.canvasSize.x} × {settings.canvasSize.y}</span>
        {selectedFrameCount > 1 && <span className="canvas-batch-hint" title="Move, rotate and scale apply relatively to every selected frame">Editing {selectedFrameCount} selected frames</span>}
        <div className="zoom-controls">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value - 1))}><Icon name="zoomOut" /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(16, value + 1))}><Icon name="zoomIn" /></button>
        </div>
      </div>
      <div
        ref={stageRef}
        tabIndex={-1}
        className={`canvas-stage ${spaceDown || isPanning ? 'pan-ready' : ''} tool-${activeTool}`}
        onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(16, Math.max(1, value + (event.deltaY < 0 ? 1 : -1)))); }}
        onContextMenu={(event) => event.preventDefault()}
        onAuxClick={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (ikDrag.current || dragRef.current || dragStart.current) return;
          if (event.button !== 0 && event.button !== 1) return;
          event.currentTarget.focus({ preventScroll: true });
          if (spaceDown || event.button === 1) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
            setIsPanning(true);
            return;
          }
          const frame = frames[currentFrameIndex];
          const worldPoint = pointerToWorld(event);
          if (!frame || !worldPoint) return;
          const selectUnderPointer = () => selectNode(hitTest(worldPoint, frame));
          if (activeTool === 'select' || isPlaying) {
            selectUnderPointer();
            return;
          }
          if (activeTool === 'ik') {
            const end = chain && canSolveIk ? nodePivotWorld(nodes, frame, chain.end.id) : null;
            if (chain && end) {
              const root = nodePivotWorld(nodes, frame, chain.upper.id);
              const joint = nodePivotWorld(nodes, frame, chain.lower.id);
              const handle = bendHandle(root, joint, end, zoom);
              if (handle && hitTransformHandle(worldPoint, handle, zoom)) {
                if (!beginIk(chain.end.id, 'bend')) {
                  setIkMessage('Unlock the overlapping IK chain before changing the bend.');
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                const side = bendDistance(root, end, handle) < 0 ? -1 : 1;
                ikDrag.current = { pointerId: event.pointerId, kind: 'bend', root, tip: end, side };
                setBending(true);
                setIkMessage(null);
                return;
              }
            }
            const part = end && chain && !activeFootLocks(nodes, frame).some(([id]) => id === chain.end.id)
              ? hitGizmo('ik', worldPoint, end, zoom) : null;
            if (!chain || !part) {
              selectUnderPointer();
              return;
            }
            if (part === 'ring') {
              const store = useProjectStore.getState();
              const selectedFrames = new Set(inspectorFrameIds(store));
              if (store.frames.some((item) => selectedFrames.has(item.id) && activeFootLocks(nodes, item)
                .some(([id]) => isAncestor(nodes, chain.end.id, id)))) {
                setIkMessage('Unlock the affected foot before rotating this tip.');
                return;
              }
              const cache = new Map<string, Matrix>();
              const nodeMatrix = getWorldMatrix(nodes, frame, chain.end.id, cache);
              const parentMatrix = getWorldMatrix(nodes, frame, chain.lower.id, cache);
              const startState = frameStateFor(chain.end, frame);
              beginTransform(chain.end.id);
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { pointerId: event.pointerId, tool: 'rotate', nodeId: chain.end.id, startWorld: worldPoint,
                parentMatrix, nodeMatrix, startState, rotationLastPoint: worldPoint, rotationDegrees: startState.rotation, startScaleAxes: { x: 0, y: 0 } };
              setActiveGizmo('ring');
              setIkMessage(null);
              return;
            }
            if (!beginIk(chain.end.id)) {
              setIkMessage('Unlock the foot or overlapping IK chain before dragging.');
              return;
            }
            setIkMessage(null);
            event.currentTarget.setPointerCapture(event.pointerId);
            ikDrag.current = { pointerId: event.pointerId, kind: 'position', start: worldPoint };
            setActiveGizmo('center');
            return;
          }
          const node = selectedNodeId ? nodes[selectedNodeId] : null;
          if (!node) {
            selectUnderPointer();
            return;
          }
          const cache = new Map<string, Matrix>();
          const nodeMatrix = getWorldMatrix(nodes, frame, node.id, cache);
          const parentMatrix = node.parentId ? getWorldMatrix(nodes, frame, node.parentId, cache) : identityMatrix;
          const startState = frameStateFor(node, frame);
          const assetId = nodeSpriteIdForFrame(node, startState);
          const asset = assetId ? assets[assetId] : undefined;
          const shown = displayMatrix(nodeMatrix, settings.pixelPerfectRotation, settings.pixelGridSize);
          const control = nodeControl(activeTool, node, startState, shown, asset, zoom);
          const usesGizmo = activeTool === 'move' || activeTool === 'rotate';
          const part = usesGizmo && !node.locked && node.visible && startState.visible
            ? hitGizmo(activeTool, worldPoint, { x: shown.e, y: shown.f }, zoom) : null;
          if (!part && !hitTransformHandle(worldPoint, control?.center ?? null, zoom)) {
            selectUnderPointer();
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          const rotationOffset = activeTool === 'rotate' ? { x: nodeMatrix.e - shown.e, y: nodeMatrix.f - shown.f } : undefined;
          dragRef.current = {
            pointerId: event.pointerId,
            tool: activeTool,
            nodeId: node.id,
            startWorld: worldPoint,
            parentMatrix,
            nodeMatrix,
            startState: { ...startState, position: { ...startState.position }, scale: { ...startState.scale } },
            rotationLastPoint: rotationOffset ? { x: worldPoint.x + rotationOffset.x, y: worldPoint.y + rotationOffset.y } : worldPoint,
            rotationDegrees: startState.rotation,
            rotationOffset,
            moveAxis: activeTool === 'move' ? part ?? 'plane' : undefined,
            startScaleAxes: pointInNodeScaleAxes(parentMatrix, startState, worldPoint) ?? { x: 0, y: 0 },
            pivotAsset: activeTool === 'pivot' ? asset : undefined,
          };
          setActiveGizmo(part);
          if (activeTool !== 'pivot') beginTransform(node.id);
        }}
        onPointerMove={(event) => {
          if (dragStart.current) {
            if (event.pointerId !== dragStart.current.pointerId) return;
            setPan({ x: dragStart.current.panX + event.clientX - dragStart.current.x, y: dragStart.current.panY + event.clientY - dragStart.current.y });
            return;
          }
          const drag = dragRef.current;
          const worldPoint = pointerToWorld(event);
          const ik = ikDrag.current;
          if (ik) {
            if (worldPoint && event.pointerId === ik.pointerId) {
              if (ik.kind === 'bend') {
                const distance = bendDistance(ik.root, ik.tip, worldPoint);
                const side = distance < 0 ? -1 : 1;
                if (Math.abs(distance) * zoom > 4 && side !== ik.side) {
                  ik.side = side;
                  dragIkBend(side);
                }
              } else {
                const snapDelta = (value: number) => snapEnabled ? Math.round(value / settings.gridSize) * settings.gridSize : value;
                dragIk({ x: snapDelta(worldPoint.x - ik.start.x), y: snapDelta(worldPoint.y - ik.start.y) });
              }
            }
            return;
          }
          if (!drag || drag.pointerId !== event.pointerId || !worldPoint) return;
          if (drag.tool === 'move') {
            const delta = { x: worldPoint.x - drag.startWorld.x, y: worldPoint.y - drag.startWorld.y };
            const position = moveGizmoPosition(drag.parentMatrix, drag.startState.position, delta, drag.moveAxis ?? 'plane',
              snapEnabled ? settings.gridSize : settings.pixelPerfectRotation ? settings.pixelGridSize : 0);
            if (position) updateNodeFrame(drag.nodeId, { position });
          }
          if (drag.tool === 'rotate') {
            const point = drag.rotationOffset ? { x: worldPoint.x + drag.rotationOffset.x, y: worldPoint.y + drag.rotationOffset.y } : worldPoint;
            const delta = rotationDragDelta(drag.parentMatrix, drag.startState.position, drag.rotationLastPoint, point);
            drag.rotationLastPoint = point;
            if (delta === null) return;
            drag.rotationDegrees += delta;
            updateNodeFrame(drag.nodeId, { rotation: drag.rotationDegrees });
          }
          if (drag.tool === 'scale') {
            const currentAxes = pointInNodeScaleAxes(drag.parentMatrix, drag.startState, worldPoint);
            if (!currentAxes) return;
            updateNodeFrame(drag.nodeId, {
              scale: {
                x: scaledAxis(drag.startState.scale.x, drag.startScaleAxes.x, currentAxes.x),
                y: scaledAxis(drag.startState.scale.y, drag.startScaleAxes.y, currentAxes.y),
              },
            });
          }
        }}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, true)}
      >
        <canvas ref={canvasRef} />
        {activeTool === 'ik' && <div className="ik-panel" onPointerDown={(event) => event.stopPropagation()}>
          {chain?.end.ikBinding && <strong className="ik-panel-label">{chain.end.ikBinding.name}</strong>}
          <div className="ik-panel-label" title={chain ? `${chain.upper.name} → ${chain.lower.name} → ${chain.end.name}` : undefined}>
            {chain ? `${chain.upper.name} → ${chain.lower.name} → ${chain.end.name}` : 'Select a wrist, ankle or tip in the node tree'}
          </div>
          <div className="ik-panel-actions">
            <button type="button" className="tool-button" disabled={!selectedNodeId || (!canSolveIk && !allSelectedLocked)} aria-pressed={allSelectedLocked}
              onClick={() => selectedNodeId && setIkMessage(toggleFootLock(selectedNodeId))}>{allSelectedLocked ? 'Unlock foot' : 'Lock foot'}</button>
            <button type="button" className="tool-button" disabled={!canSolveIk}
              onClick={() => chain && setIkMessage(reverseIkBend(chain.end.id))}>Reverse bend</button>
          </div>
          <div role="status" className={ikMessage ? 'ik-panel-error' : 'ik-panel-hint'}>
            {ikMessage ?? (!chain ? 'Choose a valid chain in IK bindings.' : allSelectedLocked ? 'Foot pinned. Drag the purple diamond to change the bend.' : canSolveIk ? 'Center: move · Ring: rotate · Purple diamond: bend' : 'Give both bones a nonzero length.')}
          </div>
          <IkBindings onMessage={setIkMessage} />
        </div>}
        <div className="canvas-help">
          {activeTool === 'pivot' && <><span>Drag pivot to reposition</span><span>•</span></>}
          {activeTool === 'move' && <><span>Drag X / Y or the plane square</span><span>•</span></>}
          {activeTool === 'rotate' && <><span>Drag the rotation ring</span><span>•</span></>}
          <kbd>Scroll</kbd> zoom <span>•</span> <kbd>Middle mouse</kbd> or <kbd>Space + drag</kbd> pan
        </div>
      </div>
    </main>
  );
}
