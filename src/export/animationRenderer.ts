import type { AnimationFrame, NodeFrameState, NodeId, ProjectSettings, RigNode, SpriteAsset } from '../types/project';

export interface RenderableProject {
  assets: Record<string, SpriteAsset>;
  nodes: Record<NodeId, RigNode>;
  rootNodeIds: NodeId[];
  settings: ProjectSettings;
  frames: AnimationFrame[];
}

function stateFor(node: RigNode, frame: AnimationFrame): NodeFrameState {
  return frame.nodeStates[node.id] ?? {
    position: node.transform.position,
    rotation: node.transform.rotation,
    scale: node.transform.scale,
    visible: node.visible,
    imageIndex: 0,
  };
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

export async function renderAnimationFrame(project: RenderableProject, frameIndex: number): Promise<HTMLCanvasElement> {
  const frame = project.frames[frameIndex];
  if (!frame) throw new Error('The selected animation frame does not exist.');
  const images = await loadAssets(project.assets);
  const canvas = document.createElement('canvas');
  canvas.width = project.settings.canvasSize.x;
  canvas.height = project.settings.canvasSize.y;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser cannot create an export canvas.');
  context.imageSmoothingEnabled = false;
  context.translate(canvas.width / 2, canvas.height / 2);

  const drawNode = (node: RigNode) => {
    const nodeState = stateFor(node, frame);
    if (!node.visible || !nodeState.visible) return;
    context.save();
    context.translate(Math.round(nodeState.position.x), Math.round(nodeState.position.y));
    context.rotate(nodeState.rotation * Math.PI / 180);
    context.scale(nodeState.scale.x, nodeState.scale.y);
    const asset = node.assetId ? project.assets[node.assetId] : null;
    const image = asset ? images.get(asset.id) : null;
    if (asset && image) context.drawImage(image, -node.pivot.x, -node.pivot.y, asset.width, asset.height);
    node.children.forEach((childId) => {
      const child = project.nodes[childId];
      if (child) drawNode(child);
    });
    context.restore();
  };

  project.rootNodeIds.forEach((id) => {
    const node = project.nodes[id];
    if (node) drawNode(node);
  });
  return canvas;
}

export async function renderAllFrames(project: RenderableProject) {
  return Promise.all(project.frames.map((_, index) => renderAnimationFrame(project, index)));
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
}

export function framePixels(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The frame pixels could not be read.');
  return new Uint8ClampedArray(context.getImageData(0, 0, canvas.width, canvas.height).data);
}

