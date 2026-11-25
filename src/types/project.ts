export type NodeId = string;
export type AssetId = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface SpriteAsset {
  id: AssetId;
  name: string;
  folder: string;
  src: string;
  width: number;
  height: number;
  /** The original imported PNG shared by a set of generated sprite slices. */
  source?: SpriteSource;
  /** The rectangle this sprite occupies in its source PNG. */
  slice?: SpriteSlice;
  /**
   * Sprite-space pixel (0..width, 0..height) that is aligned to the node origin.
   * Sprites without an anchor fall back to their node's pivot.
   */
  anchor?: Vec2;
}

export interface SpriteSource {
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
}

export interface SpriteSlice {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional alpha mask for automatically detected, non-rectangular components. */
  mask?: string;
}

export interface IkBinding {
  name: string;
  upperId: NodeId;
  lowerId: NodeId;
}

export interface RigNode {
  id: NodeId;
  name: string;
  parentId: NodeId | null;
  children: NodeId[];
  /** Sprites available to this node. Frames select one with imageIndex. */
  assetIds: AssetId[];
  /** Legacy single-sprite field kept optional so version 1 projects can migrate safely. */
  assetId?: AssetId | null;
  /** Higher values are drawn in front of lower values. */
  sortingOrder?: number;
  /** Sprite index that new frames start from. Frames may still pick another sprite. */
  defaultImageIndex?: number;
  pivot: Vec2;
  transform: {
    position: Vec2;
    rotation: number;
    scale: Vec2;
  };
  visible: boolean;
  locked: boolean;
  /** A named two-joint chain whose endpoint is this node. */
  ikBinding?: IkBinding;
}

export function nodeSpriteIds(node: Pick<RigNode, 'assetIds' | 'assetId'>): AssetId[] {
  if (Array.isArray(node.assetIds)) return node.assetIds;
  return node.assetId ? [node.assetId] : [];
}

export function nodeSpriteIdForFrame(node: Pick<RigNode, 'assetIds' | 'assetId'>, state?: Pick<NodeFrameState, 'imageIndex'> | null): AssetId | null {
  const ids = nodeSpriteIds(node);
  if (!ids.length) return null;
  const index = Math.max(0, Math.min(ids.length - 1, Math.round(state?.imageIndex ?? 0)));
  return ids[index] ?? null;
}

export interface ProjectSettings {
  canvasSize: Vec2;
  gridSize: number;
  pixelPerfectRotation: boolean;
  pixelGridSize: number;
  rotationSnapAngle: RotationSnapAngle;
}

export type RotationSnapAngle = 0 | 1 | 5 | 15 | 45;

/** The values that animation frames own for each reusable rig node. */
export interface NodeFrameState {
  position: Vec2;
  rotation: number;
  scale: Vec2;
  visible: boolean;
  /** Index into the owning node's sprite list for this frame. */
  imageIndex: number;
  /** Higher values are drawn in front on this animation frame. */
  sortingOrder: number;
}

export interface FrameGroup {
  id: string;
  name: string;
  color: string;
}

export interface AnimationFrame {
  id: string;
  nodeStates: Record<NodeId, NodeFrameState>;
  /** Transparent PNG data for the optional frame-by-frame drawing canvas. */
  canvasData?: string;
  /** Optional organizational group carried with the frame when reordered. */
  group?: FrameGroup;
  /** Planted end-node pivots in canvas/world coordinates. */
  footLocks?: Record<NodeId, FootLock>;
}

export interface FootLock {
  upperId: NodeId;
  lowerId: NodeId;
  point: Vec2;
  axis: Vec2;
}

export type TransformTool = 'select' | 'move' | 'rotate' | 'scale' | 'pivot' | 'ik';
export type AnimationTemplate = 'walk' | 'idle';

export interface TweenProperties {
  position: boolean;
  rotation: boolean;
  scale: boolean;
  visible: boolean;
  sprite: boolean;
}

/** How an imported animation is placed on the existing timeline. */
export type AnimationImportMode = 'replace' | 'insert' | 'overwrite' | 'delta';

export interface AnimationImportOptions {
  mode: AnimationImportMode;
  /**
   * Timeline index of the first imported frame. Defaults to the current frame.
   * Only used by the `insert`, `overwrite` and `delta` modes.
   */
  startIndex?: number;
}
