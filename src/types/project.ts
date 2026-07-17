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

export interface RigNode {
  id: NodeId;
  name: string;
  parentId: NodeId | null;
  children: NodeId[];
  assetId: AssetId | null;
  /** Higher values are drawn in front of lower values. */
  sortingOrder?: number;
  pivot: Vec2;
  transform: {
    position: Vec2;
    rotation: number;
    scale: Vec2;
  };
  visible: boolean;
  locked: boolean;
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
  /** Reserved for the multiple-sprites-per-node workflow. */
  imageIndex: number;
}

export interface AnimationFrame {
  id: string;
  nodeStates: Record<NodeId, NodeFrameState>;
}

export type TransformTool = 'select' | 'move' | 'rotate' | 'scale' | 'pivot';
export type AnimationTemplate = 'walk' | 'idle';
