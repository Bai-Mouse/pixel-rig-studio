import type { RenderableProject } from './animationRenderer';
import type { AnimationFrame, NodeFrameState, ProjectSettings, RotationSnapAngle } from '../types/project';

export interface SerializableProject extends RenderableProject {
  fps: number;
  isLooping: boolean;
}

export interface ProjectFile {
  format: 'pixel-rig-studio-project';
  version: number;
  savedAt: string;
  settings: SerializableProject['settings'];
  assets: SerializableProject['assets'];
  nodes: SerializableProject['nodes'];
  rootNodeIds: SerializableProject['rootNodeIds'];
  animation: {
    fps: number;
    loop: boolean;
    frames: SerializableProject['frames'];
  };
}

export interface AnimationDataFile {
  format: 'pixel-rig-animation';
  version: number;
  fps: number;
  loop: boolean;
  canvasSize: SerializableProject['settings']['canvasSize'];
  nodes: Record<string, {
    name: string;
    parentId: string | null;
    assetId: string | null;
    pivot: { x: number; y: number };
  }>;
  frames: AnimationFrame[];
}

export function projectFile(project: SerializableProject): ProjectFile {
  return {
    format: 'pixel-rig-studio-project',
    version: 1,
    savedAt: new Date().toISOString(),
    settings: project.settings,
    assets: project.assets,
    nodes: project.nodes,
    rootNodeIds: project.rootNodeIds,
    animation: {
      fps: project.fps,
      loop: project.isLooping,
      frames: project.frames,
    },
  };
}

export function parseProjectFile(source: string): SerializableProject {
  let candidate: unknown;
  try {
    candidate = JSON.parse(source);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!candidate || typeof candidate !== 'object') throw new Error('This project file has an invalid structure.');
  const file = candidate as Partial<ProjectFile>;
  if (file.format !== 'pixel-rig-studio-project' || !file.settings || !file.assets || !file.nodes || !file.animation || !Array.isArray(file.rootNodeIds) || !Array.isArray(file.animation.frames)) {
    throw new Error('This is not a Pixel Rig Studio project file.');
  }
  if (typeof file.animation.fps !== 'number' || file.animation.fps < 1 || !Number.isFinite(file.animation.fps)) throw new Error('The project FPS is invalid.');
  return {
    settings: normalizeProjectSettings(file.settings),
    assets: file.assets,
    nodes: file.nodes,
    rootNodeIds: file.rootNodeIds,
    frames: file.animation.frames,
    fps: Math.min(60, Math.round(file.animation.fps)),
    isLooping: Boolean(file.animation.loop),
  } as SerializableProject;
}

const rotationSnapAngles: RotationSnapAngle[] = [0, 1, 5, 15, 45];

export function normalizeProjectSettings(settings: Pick<ProjectSettings, 'canvasSize' | 'gridSize'> & Partial<ProjectSettings>): ProjectSettings {
  const rotationSnapAngle = rotationSnapAngles.includes(settings.rotationSnapAngle as RotationSnapAngle)
    ? settings.rotationSnapAngle as RotationSnapAngle
    : 0;
  return {
    canvasSize: settings.canvasSize,
    gridSize: settings.gridSize,
    pixelPerfectRotation: settings.pixelPerfectRotation ?? true,
    pixelGridSize: Math.max(1, Math.min(16, Math.round(settings.pixelGridSize ?? 1))),
    rotationSnapAngle,
  };
}

export function animationDataFile(project: SerializableProject): AnimationDataFile {
  return {
    format: 'pixel-rig-animation',
    version: 1,
    fps: project.fps,
    loop: project.isLooping,
    canvasSize: project.settings.canvasSize,
    nodes: Object.fromEntries(Object.entries(project.nodes).map(([id, node]) => [id, {
      name: node.name,
      parentId: node.parentId,
      assetId: node.assetId,
      pivot: node.pivot,
    }])),
    frames: project.frames,
  };
}

function isNodeFrameState(value: unknown): value is NodeFrameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<NodeFrameState>;
  return Boolean(
    state.position && typeof state.position.x === 'number' && typeof state.position.y === 'number'
    && typeof state.rotation === 'number'
    && state.scale && typeof state.scale.x === 'number' && typeof state.scale.y === 'number'
    && typeof state.visible === 'boolean'
    && typeof state.imageIndex === 'number',
  );
}

export function parseAnimationData(source: string): AnimationDataFile {
  let candidate: unknown;
  try {
    candidate = JSON.parse(source);
  } catch {
    throw new Error('This animation file is not valid JSON.');
  }
  if (!candidate || typeof candidate !== 'object') throw new Error('This animation file has an invalid structure.');
  const file = candidate as Partial<AnimationDataFile>;
  if (file.format !== 'pixel-rig-animation' || !Array.isArray(file.frames) || typeof file.fps !== 'number' || file.fps < 1 || !Number.isFinite(file.fps)) {
    throw new Error('This is not a Pixel Rig Studio animation file.');
  }
  if (!file.frames.length || !file.frames.every((frame) => frame && typeof frame === 'object' && typeof frame.id === 'string' && frame.nodeStates && Object.values(frame.nodeStates).every(isNodeFrameState))) {
    throw new Error('This animation file has no valid frames.');
  }
  return {
    format: 'pixel-rig-animation',
    version: typeof file.version === 'number' ? file.version : 1,
    fps: Math.min(60, Math.round(file.fps)),
    loop: Boolean(file.loop),
    canvasSize: file.canvasSize ?? { x: 0, y: 0 },
    nodes: file.nodes ?? {},
    frames: file.frames,
  };
}
