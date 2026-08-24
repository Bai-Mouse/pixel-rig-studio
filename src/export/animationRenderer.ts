import { nodeSpriteIdForFrame, type AnimationFrame, type NodeFrameState, type NodeId, type ProjectSettings, type RigNode, type SpriteAsset } from '../types/project';
import { DEFAULT_PIXEL_ALPHA_THRESHOLD, snapToGrid } from '../canvas/pixelRotation';
import { spriteRasterCache } from '../canvas/spriteRasterCache';

export interface RenderableProject {
  assets: Record<string, SpriteAsset>;
  nodes: Record<NodeId, RigNode>;
  rootNodeIds: NodeId[];
  settings: ProjectSettings;
  frames: AnimationFrame[];
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const identityMatrix: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function stateFor(node: RigNode, frame: AnimationFrame): NodeFrameState {
  return frame.nodeStates[node.id] ?? {
    position: node.transform.position,
    rotation: node.transform.rotation,
    scale: node.transform.scale,
    visible: node.visible,
    imageIndex: 0,
    sortingOrder: node.sortingOrder ?? 0,
  };
}

function matrixForState(state: NodeFrameState): Matrix {
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

export type ExportLayerSource = 'nodes' | 'canvas' | 'combined';

function getWorldMatrix(nodes: Record<NodeId, RigNode>, frame: AnimationFrame, nodeId: NodeId, cache: Map<NodeId, Matrix>): Matrix {
  const cached = cache.get(nodeId);
  if (cached) return cached;
  const node = nodes[nodeId];
  if (!node) return identityMatrix;
  const parent = node.parentId ? getWorldMatrix(nodes, frame, node.parentId, cache) : identityMatrix;
  const world = multiplyMatrices(parent, matrixForState(stateFor(node, frame)));
  cache.set(nodeId, world);
  return world;
}

function orderedNodeIds(nodes: Record<NodeId, RigNode>, rootNodeIds: NodeId[]) {
  const ids: NodeId[] = [];
  const visit = (nodeId: NodeId) => {
    const node = nodes[nodeId];
    if (!node) return;
    ids.push(nodeId);
    node.children.forEach(visit);
  };
  rootNodeIds.forEach(visit);
  return ids;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A sprite image could not be rendered.'));
    image.src = source;
  });
}

async function loadAssets(assets: Record<string, SpriteAsset>) {
  const entries = await Promise.all(Object.values(assets).map(async (asset) => [asset.id, await loadImage(asset.src)] as const));
  return new Map(entries);
}

function renderFrameWithImages(project: RenderableProject, frameIndex: number, images: Map<string, HTMLImageElement>): HTMLCanvasElement {
  const frame = project.frames[frameIndex];
  if (!frame) throw new Error('The selected animation frame does not exist.');
  const canvas = document.createElement('canvas');
  canvas.width = project.settings.canvasSize.x;
  canvas.height = project.settings.canvasSize.y;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser cannot create an export canvas.');
  context.imageSmoothingEnabled = false;
  context.translate(canvas.width / 2, canvas.height / 2);

  const drawNode = (node: RigNode, worldMatrix: Matrix) => {
    const nodeState = stateFor(node, frame);
    if (!node.visible || !nodeState.visible) return;
    const assetId = nodeSpriteIdForFrame(node, nodeState);
    const asset = assetId ? project.assets[assetId] : null;
    const image = asset ? images.get(asset.id) : null;
    if (asset && image) {
      const anchorX = snapToGrid(worldMatrix.e, project.settings.pixelGridSize);
      const anchorY = snapToGrid(worldMatrix.f, project.settings.pixelGridSize);
      if (project.settings.pixelPerfectRotation) {
        const worldDeterminant = worldMatrix.a * worldMatrix.d - worldMatrix.b * worldMatrix.c;
        try {
          const rasterized = spriteRasterCache.get(asset.id, image, {
            angleRadians: Math.atan2(worldMatrix.b, worldMatrix.a),
            scaleX: Math.hypot(worldMatrix.a, worldMatrix.b),
            scaleY: Math.sign(worldDeterminant || 1) * Math.hypot(worldMatrix.c, worldMatrix.d),
            pivotX: node.pivot.x,
            pivotY: node.pivot.y,
            pixelGridSize: project.settings.pixelGridSize,
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
        } catch {
          context.save();
          context.transform(worldMatrix.a, worldMatrix.b, worldMatrix.c, worldMatrix.d, anchorX, anchorY);
          context.drawImage(image, -node.pivot.x, -node.pivot.y, asset.width, asset.height);
          context.restore();
        }
      } else {
        context.save();
        context.transform(worldMatrix.a, worldMatrix.b, worldMatrix.c, worldMatrix.d, anchorX, anchorY);
        context.drawImage(image, -node.pivot.x, -node.pivot.y, asset.width, asset.height);
        context.restore();
      }
    }
  };

  const matrixCache = new Map<NodeId, Matrix>();
  orderedNodeIds(project.nodes, project.rootNodeIds)
    .sort((leftId, rightId) => {
      const leftNode = project.nodes[leftId];
      const rightNode = project.nodes[rightId];
      return (leftNode ? stateFor(leftNode, frame).sortingOrder : 0) - (rightNode ? stateFor(rightNode, frame).sortingOrder : 0);
    })
    .forEach((id) => {
      const node = project.nodes[id];
      if (node) drawNode(node, getWorldMatrix(project.nodes, frame, id, matrixCache));
    });
  return canvas;
}

export async function renderAnimationFrame(project: RenderableProject, frameIndex: number): Promise<HTMLCanvasElement> {
  return renderFrameWithImages(project, frameIndex, await loadAssets(project.assets));
}

async function renderDrawingFrame(project: RenderableProject, frameIndex: number): Promise<HTMLCanvasElement> {
  const frame = project.frames[frameIndex];
  if (!frame) throw new Error('The selected animation frame does not exist.');
  const canvas = document.createElement('canvas');
  canvas.width = project.settings.canvasSize.x;
  canvas.height = project.settings.canvasSize.y;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser cannot create an export canvas.');
  context.imageSmoothingEnabled = false;
  if (frame.canvasData) context.drawImage(await loadImage(frame.canvasData), 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function renderAllFrames(project: RenderableProject, source: ExportLayerSource = 'nodes') {
  if (source === 'canvas') return Promise.all(project.frames.map((_, index) => renderDrawingFrame(project, index)));
  const images = await loadAssets(project.assets);
  const nodeFrames = project.frames.map((_, index) => renderFrameWithImages(project, index, images));
  if (source === 'nodes') return nodeFrames;
  const drawingFrames = await Promise.all(project.frames.map((_, index) => renderDrawingFrame(project, index)));
  return nodeFrames.map((nodeFrame, index) => {
    const context = nodeFrame.getContext('2d');
    if (context) {
      context.imageSmoothingEnabled = false;
      context.drawImage(drawingFrames[index], 0, 0);
    }
    return nodeFrame;
  });
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
}

export function framePixels(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The frame pixels could not be read.');
  return new Uint8ClampedArray(context.getImageData(0, 0, canvas.width, canvas.height).data);
}

