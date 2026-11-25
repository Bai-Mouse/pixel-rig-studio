import { create } from 'zustand';
import { nodeSpriteIds, type AnimationFrame, type AnimationImportOptions, type AnimationTemplate, type AssetId, type FrameGroup, type IkBinding, type NodeFrameState, type NodeId, type ProjectSettings, type RigNode, type RotationSnapAngle, type SpriteAsset, type TransformTool, type TweenProperties, type Vec2 } from '../types/project';
import type { AnimationDataFile, SerializableProject } from '../export/projectSerializer';
import { normalizeProjectSettings } from '../export/projectSerializer';
import { createCharacterTemplateProject as buildCharacterTemplate } from './characterTemplate';
import { applyEditPlan, type EditPlan, type EditableScene } from '../codex/editPlan';
import { clampAnchor, effectiveSpriteAnchor } from '../utils/spriteAnchor';
import { activeFootLocks, captureFootLock, ikHierarchy, isAncestor, moveWithFootLocks, nodePivotWorld, poseIkBend, solveTwoBone } from './twoBoneIk';

type FrameStatePatch = Omit<Partial<NodeFrameState>, 'position' | 'scale'> & {
  position?: Partial<Vec2>;
  scale?: Partial<Vec2>;
};

interface TransformHistoryEntry {
  nodeId: NodeId;
  frameIndex: number;
  before: NodeFrameState;
  after: NodeFrameState;
}

interface PivotNodeSnapshot {
  pivot: Vec2;
  transform: RigNode['transform'];
  frameStates: Array<NodeFrameState | null>;
}

interface PivotHistoryEntry {
  snapshots: {
    before: Record<NodeId, PivotNodeSnapshot>;
    after: Record<NodeId, PivotNodeSnapshot>;
  };
}

interface NodeFramesHistoryEntry {
  nodeId: NodeId;
  frameIds?: string[];
  frameStates: {
    before: Array<NodeFrameState | null>;
    after: Array<NodeFrameState | null>;
  };
}

interface CodexHistoryEntry {
  codexEditId: string;
  label: string;
  before: EditableScene;
  after: EditableScene;
}
interface AssetHistoryEntry {
  assetsBefore: Record<AssetId, SpriteAsset | null>;
  assetsAfter: Record<AssetId, SpriteAsset | null>;
}
/** Re-anchoring keeps the drawn pixels in place, so the sprite edit and pose edit undo together. */
interface AnchorHistoryEntry {
  assetsBefore: Record<AssetId, SpriteAsset | null>;
  assetsAfter: Record<AssetId, SpriteAsset | null>;
  snapshots: {
    before: Record<NodeId, PivotNodeSnapshot>;
    after: Record<NodeId, PivotNodeSnapshot>;
  };
}
/** Structural timeline edits (insert, duplicate, delete, move, grouping, import) undo as one frame-list snapshot. */
interface TimelineSnapshot {
  frames: AnimationFrame[];
  currentFrameIndex: number;
  fps: number;
  isLooping: boolean;
  selectedFrameIds: string[];
}

interface TimelineHistoryEntry {
  timelineBefore: TimelineSnapshot;
  timelineAfter: TimelineSnapshot;
  label: string;
}

interface RigPoseHistoryEntry {
  rigBefore: AnimationFrame[];
  rigAfter: AnimationFrame[];
}
interface IkBindingHistoryEntry {
  bindingEnd: NodeId;
  bindingBefore?: IkBinding;
  bindingAfter?: IkBinding;
}
type HistoryEntry = TransformHistoryEntry | PivotHistoryEntry | NodeFramesHistoryEntry | CodexHistoryEntry | AssetHistoryEntry | AnchorHistoryEntry | TimelineHistoryEntry | RigPoseHistoryEntry | IkBindingHistoryEntry;

function withIkBinding(nodes: Record<NodeId, RigNode>, id: NodeId, binding?: IkBinding) {
  if (!nodes[id]) return nodes;
  const node = { ...nodes[id] };
  if (binding) node.ikBinding = binding;
  else delete node.ikBinding;
  return { ...nodes, [id]: node };
}

function restoreAssets(current: Record<AssetId, SpriteAsset>, patch: Record<AssetId, SpriteAsset | null>) {
  const result = { ...current };
  for (const [id, asset] of Object.entries(patch)) { if (asset) result[id] = asset; else delete result[id]; }
  return result;
}

interface TransformSession {
  nodeId: NodeId;
  frameIndex: number;
  before: NodeFrameState;
  frameIds: string[];
  frameStates: Array<NodeFrameState | null>;
  poseFrames?: AnimationFrame[];
  ik?: 'move' | 'bend';
}

interface ProjectState {
  applyCodexPlan: (plan: EditPlan, expected: EditableScene & { assets: Record<AssetId, SpriteAsset>; settings: ProjectSettings }) => string;
  assets: Record<AssetId, SpriteAsset>;
  nodes: Record<NodeId, RigNode>;
  rootNodeIds: NodeId[];
  folders: string[];
  settings: ProjectSettings;
  projectName: string;
  frames: AnimationFrame[];
  currentFrameIndex: number;
  selectedFrameIds: string[];
  frameSelectionAnchorId: string | null;
  inspectorSession: { nodeId: NodeId; frameIds: string[]; before: Array<NodeFrameState | null>; poseFrames?: AnimationFrame[] } | null;
  beginInspectorEdit: (nodeId: NodeId) => void;
  updateInspectorFrame: (nodeId: NodeId, patch: FrameStatePatch) => void;
  commitInspectorEdit: () => void;
  isPlaying: boolean;
  playbackGroupId: string | null;
  playbackFrameIds: string[] | null;
  isLooping: boolean;
  onionSkinEnabled: boolean;
  fps: number;
  activeTool: TransformTool;
  showPivot: boolean;
  snapEnabled: boolean;
  transformSession: TransformSession | null;
  transformHistory: HistoryEntry[];
  redoStack: HistoryEntry[];
  selectedNodeId: NodeId | null;
  selectedAssetId: AssetId | null;
  selectedAssetIds: AssetId[];
  selectNode: (id: NodeId | null) => void;
  selectAsset: (id: AssetId | null) => void;
  selectAssets: (ids: AssetId[], primaryId?: AssetId | null) => void;
  addAssets: (assets: SpriteAsset[]) => void;
  replaceAssets: (assets: SpriteAsset[]) => void;
  /** Sets or clears the sprite-space anchor used to align this sprite with its node origin. */
  setAssetAnchor: (assetId: AssetId, anchor: Vec2 | null) => void;
  /** Re-anchors one sprite while offsetting the node pose so its drawn pixels stay in place. */
  setAssetAnchorKeepingPixels: (assetId: AssetId, nodeId: NodeId, anchor: Vec2) => void;
  updateAssetSource: (id: AssetId, src: string, width: number, height: number) => void;
  deleteAsset: (id: AssetId) => void;
  createNodeForAsset: (assetId: AssetId) => void;
  setNodeAsset: (nodeId: NodeId, assetId: AssetId) => void;
  addNodeSprites: (nodeId: NodeId, assetIds: AssetId[]) => void;
  removeNodeSprite: (nodeId: NodeId, assetId: AssetId) => void;
  setNodeFrameSprite: (nodeId: NodeId, imageIndex: number) => void;
  renameNode: (nodeId: NodeId, name: string) => void;
  addRootNode: () => void;
  addChildNode: (parentId: NodeId) => void;
  reparentNode: (nodeId: NodeId, parentId: NodeId | null) => void;
  setNodeSortingOrder: (nodeId: NodeId, sortingOrder: number) => void;
  toggleNodeVisibility: (id: NodeId) => void;
  toggleNodeLock: (id: NodeId) => void;
  selectFrame: (index: number, mode?: 'single' | 'toggle' | 'range') => void;
  togglePlayback: () => void;
  toggleSelectionPlayback: () => void;
  advanceFrame: () => void;
  toggleLooping: () => void;
  toggleOnionSkin: () => void;
  setFps: (fps: number) => void;
  insertFrame: () => void;
  duplicateFrame: () => void;
  deleteFrame: () => void;
  moveFrame: (fromIndex: number, toIndex: number) => void;
  moveFrames: (frameIds: string[], boundary: number) => boolean;
  insertTweenFrames: (startIndex: number, endIndex: number, count: number, properties: TweenProperties) => void;
  groupFrames: (frameIndexes: number[], name: string, color: string) => void;
  /** Adds frames to an existing group instead of creating a new one. */
  addFramesToGroup: (frameIndexes: number[], groupId: string) => void;
  /** Removes exactly the given frames from whichever group they belong to; other members stay grouped. */
  removeFramesFromGroup: (frameIndexes: number[]) => void;
  renameFrameGroup: (groupId: string, name: string, color: string) => void;
  ungroupFrames: (groupId: string) => void;
  updateCanvasFrame: (canvasData: string | undefined) => void;
  applyAnimationTemplate: (template: AnimationTemplate) => void;
  loadAnimation: (animation: AnimationDataFile, options?: AnimationImportOptions) => boolean;
  setActiveTool: (tool: TransformTool) => void;
  toggleShowPivot: () => void;
  toggleSnap: () => void;
  togglePixelPerfectRotation: () => void;
  setPixelGridSize: (size: number) => void;
  setRotationSnapAngle: (angle: RotationSnapAngle) => void;
  beginTransform: (nodeId: NodeId) => void;
  setIkBinding: (endId: NodeId, name: string | null) => string | null;
  beginIk: (endId: NodeId, mode?: 'move' | 'bend') => boolean;
  dragIk: (delta: Vec2) => void;
  dragIkBend: (side: -1 | 1) => void;
  reverseIkBend: (endId: NodeId) => string | null;
  toggleFootLock: (endId: NodeId) => string | null;
  updateNodeFrame: (nodeId: NodeId, patch: FrameStatePatch) => void;
  syncNodeFrameToAllFrames: (nodeId: NodeId) => void;
  commitTransform: () => void;
  resetNodeTransform: (nodeId: NodeId) => void;
  flipNode: (nodeId: NodeId, axis: 'horizontal' | 'vertical') => void;
  updateNodePivot: (nodeId: NodeId, pivot: Vec2) => void;
  duplicateNode: (nodeId: NodeId) => void;
  deleteNode: (nodeId: NodeId) => void;
  undoTransform: () => void;
  redoTransform: () => void;
  createEmptyProject: () => void;
  createCharacterTemplateProject: () => void;
  loadProject: (project: SerializableProject, name: string) => void;
  setProjectName: (name: string) => void;
}

/** Fields a timeline snapshot has to remember so Ctrl+Z can put the whole time axis back. */
type TimelineTrackedState = Pick<ProjectState, 'frames' | 'currentFrameIndex' | 'fps' | 'isLooping' | 'selectedFrameIds' | 'transformHistory' | 'redoStack'>;
type TimelineChange = Partial<Pick<ProjectState, 'frames' | 'currentFrameIndex' | 'fps' | 'isLooping' | 'selectedFrameIds'>>;

const initialProject = buildCharacterTemplate();

function snapshotNode(node: RigNode): NodeFrameState {
  return {
    position: { ...node.transform.position },
    rotation: node.transform.rotation,
    scale: { ...node.transform.scale },
    visible: node.visible,
    imageIndex: Math.max(0, Math.round(node.defaultImageIndex ?? 0)),
    sortingOrder: node.sortingOrder ?? 0,
  };
}

function createFrame(nodes: Record<NodeId, RigNode>): AnimationFrame {
  return {
    id: `frame-${crypto.randomUUID()}`,
    nodeStates: Object.fromEntries(Object.values(nodes).map((node) => [node.id, snapshotNode(node)])),
  };
}

/**
 * A template can ship its own first frame (including sprite choices and sorting).
 * Clone it so every project created from the template owns independent frame data.
 */
function initialFrames(nodes: Record<NodeId, RigNode>, templateFrames?: AnimationFrame[]): AnimationFrame[] {
  const first = templateFrames?.[0];
  return [first ? cloneFrame(first) : createFrame(nodes)];
}

function cloneFrame(frame: AnimationFrame): AnimationFrame {
  return {
    id: `frame-${crypto.randomUUID()}`,
    canvasData: frame.canvasData,
    group: frame.group ? { ...frame.group } : undefined,
    ...(frame.footLocks ? { footLocks: structuredClone(frame.footLocks) } : {}),
    nodeStates: Object.fromEntries(
      Object.entries(frame.nodeStates).map(([nodeId, state]) => [
        nodeId,
        { ...state, position: { ...state.position }, scale: { ...state.scale } },
      ]),
    ),
  };
}

function cloneFrameState(state: NodeFrameState): NodeFrameState {
  return { ...state, position: { ...state.position }, scale: { ...state.scale } };
}

/**
 * Adds the change between two imported frames to an existing pose.
 * Continuous values are relative (scale by ratio, rotation by angle, position by offset);
 * discrete values only change when the imported animation changes them, so a pose that is
 * not part of the animation stays untouched.
 */
function addPoseDelta(current: NodeFrameState, target: NodeFrameState, previous: NodeFrameState, spriteCount: number): NodeFrameState {
  const scaledAxis = (currentValue: number, targetValue: number, previousValue: number) => (
    Math.abs(previousValue) > 0.0001
      ? currentValue * (targetValue / previousValue)
      : currentValue + (targetValue - previousValue)
  );
  const lastSpriteIndex = Math.max(0, spriteCount - 1);
  const imageIndex = Math.max(0, Math.round(current.imageIndex))
    + Math.round(target.imageIndex - previous.imageIndex);
  return {
    position: {
      x: current.position.x + target.position.x - previous.position.x,
      y: current.position.y + target.position.y - previous.position.y,
    },
    rotation: current.rotation + target.rotation - previous.rotation,
    scale: {
      x: scaledAxis(current.scale.x, target.scale.x, previous.scale.x),
      y: scaledAxis(current.scale.y, target.scale.y, previous.scale.y),
    },
    visible: target.visible === previous.visible ? current.visible : target.visible,
    imageIndex: Math.min(lastSpriteIndex, imageIndex),
    sortingOrder: current.sortingOrder + target.sortingOrder - previous.sortingOrder,
  };
}

function cloneNodeTransform(transform: RigNode['transform']): RigNode['transform'] {
  return { ...transform, position: { ...transform.position }, scale: { ...transform.scale } };
}

function mergeFrameState(state: NodeFrameState, patch: FrameStatePatch): NodeFrameState {
  return {
    ...state,
    ...patch,
    position: { ...state.position, ...patch.position },
    scale: { ...state.scale, ...patch.scale },
  };
}

/** Canvas gestures are relative to the reference frame, not absolute pose copies. */
function relativeTransformPatch(base: NodeFrameState, reference: NodeFrameState, patch: FrameStatePatch): FrameStatePatch {
  const result: FrameStatePatch = { ...patch };
  if (patch.position) result.position = Object.fromEntries((['x', 'y'] as const)
    .filter((axis) => patch.position![axis] !== undefined)
    .map((axis) => [axis, base.position[axis] + patch.position![axis]! - reference.position[axis]]));
  if (patch.rotation !== undefined) result.rotation = base.rotation + patch.rotation - reference.rotation;
  if (patch.scale) result.scale = Object.fromEntries((['x', 'y'] as const)
    .filter((axis) => patch.scale![axis] !== undefined)
    .map((axis) => [axis, reference.scale[axis] !== 0
      ? base.scale[axis] * patch.scale![axis]! / reference.scale[axis]
      : base.scale[axis] + patch.scale![axis]! - reference.scale[axis]]));
  return result;
}

function stateMatches(left: NodeFrameState, right: NodeFrameState) {
  return left.position.x === right.position.x
    && left.position.y === right.position.y
    && left.rotation === right.rotation
    && left.scale.x === right.scale.x
    && left.scale.y === right.scale.y
    && left.visible === right.visible
    && left.imageIndex === right.imageIndex
    && left.sortingOrder === right.sortingOrder;
}

/**
 * Moving a pivot changes the point from which the texture is drawn. Offset the
 * node position by that same vector after rotation and scale so the rendered
 * pixels stay exactly where they were.
 */
function positionWithPivotCompensation(state: Pick<NodeFrameState, 'position' | 'rotation' | 'scale'>, pivotDelta: Vec2): Vec2 {
  const radians = state.rotation * Math.PI / 180;
  const x = pivotDelta.x * state.scale.x;
  const y = pivotDelta.y * state.scale.y;
  return {
    x: state.position.x + Math.cos(radians) * x - Math.sin(radians) * y,
    y: state.position.y + Math.sin(radians) * x + Math.cos(radians) * y,
  };
}

function capturePivotSnapshots(nodes: Record<NodeId, RigNode>, frames: AnimationFrame[], nodeIds: NodeId[]): Record<NodeId, PivotNodeSnapshot> {
  return Object.fromEntries(nodeIds.flatMap((nodeId) => {
    const node = nodes[nodeId];
    if (!node) return [];
    return [[nodeId, {
      pivot: { ...node.pivot },
      transform: cloneNodeTransform(node.transform),
      frameStates: frames.map((frame) => frame.nodeStates[nodeId] ? cloneFrameState(frame.nodeStates[nodeId]) : null),
    }]];
  })) as Record<NodeId, PivotNodeSnapshot>;
}

function restorePivotSnapshots(nodes: Record<NodeId, RigNode>, frames: AnimationFrame[], snapshots: Record<NodeId, PivotNodeSnapshot>) {
  const restoredNodes = { ...nodes };
  for (const [nodeId, snapshot] of Object.entries(snapshots)) {
    const node = restoredNodes[nodeId];
    if (node) restoredNodes[nodeId] = { ...node, pivot: { ...snapshot.pivot }, transform: cloneNodeTransform(snapshot.transform) };
  }
  const restoredFrames = frames.map((frame, index) => {
    const nodeStates = { ...frame.nodeStates };
    for (const [nodeId, snapshot] of Object.entries(snapshots)) {
      const nodeState = snapshot.frameStates[index];
      if (nodeState) nodeStates[nodeId] = cloneFrameState(nodeState);
      else delete nodeStates[nodeId];
    }
    return { ...frame, nodeStates };
  });
  return { nodes: restoredNodes, frames: restoredFrames };
}

function withFrameNodeState(frames: AnimationFrame[], frameIndex: number, nodeId: NodeId, nodeState: NodeFrameState) {
  return frames.map((frame, index) => index === frameIndex
    ? { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: cloneFrameState(nodeState) } }
    : frame);
}

function restoreNodeFrameStates(frames: AnimationFrame[], nodeId: NodeId, frameStates: Array<NodeFrameState | null>, frameIds?: string[]) {
  return frames.map((frame, index) => {
    if (frameIds) index = frameIds.indexOf(frame.id);
    if (index < 0) return frame;
    if (index >= frameStates.length) return frame;
    const nodeStates = { ...frame.nodeStates };
    const nodeState = frameStates[index];
    if (nodeState) nodeStates[nodeId] = cloneFrameState(nodeState);
    else delete nodeStates[nodeId];
    return { ...frame, nodeStates };
  });
}

export function inspectorFrameIds(state: Pick<ProjectState, 'frames' | 'currentFrameIndex' | 'selectedFrameIds'>) {
  const current = state.frames[state.currentFrameIndex];
  if (!current) return [];
  return state.selectedFrameIds.includes(current.id)
    ? state.frames.filter((frame) => state.selectedFrameIds.includes(frame.id)).map((frame) => frame.id)
    : [current.id];
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function lerpRotation(start: number, end: number, amount: number) {
  const shortestDelta = ((end - start + 540) % 360) - 180;
  return start + shortestDelta * amount;
}

function tweenNodeState(start: NodeFrameState, end: NodeFrameState, amount: number, properties: TweenProperties): NodeFrameState {
  return {
    position: properties.position ? { x: lerp(start.position.x, end.position.x, amount), y: lerp(start.position.y, end.position.y, amount) } : { ...start.position },
    rotation: properties.rotation ? lerpRotation(start.rotation, end.rotation, amount) : start.rotation,
    scale: properties.scale ? { x: lerp(start.scale.x, end.scale.x, amount), y: lerp(start.scale.y, end.scale.y, amount) } : { ...start.scale },
    visible: properties.visible && amount >= 0.5 ? end.visible : start.visible,
    imageIndex: properties.sprite && amount >= 0.5 ? end.imageIndex : start.imageIndex,
    sortingOrder: start.sortingOrder,
  };
}

function createEmptyNode(parentId: NodeId | null, name: string): RigNode {
  return {
    id: `node-${crypto.randomUUID()}`,
    name,
    parentId,
    children: [],
    assetIds: [],
    assetId: null,
    sortingOrder: 0,
    pivot: { x: 0, y: 0 },
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    visible: true,
    locked: false,
  };
}

interface TransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const identityMatrix: TransformMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function frameStateForNode(node: RigNode, frame: AnimationFrame): NodeFrameState {
  return frame.nodeStates[node.id] ?? snapshotNode(node);
}

function matrixFromFrameState(frameState: NodeFrameState): TransformMatrix {
  const radians = frameState.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine * frameState.scale.x,
    b: sine * frameState.scale.x,
    c: -sine * frameState.scale.y,
    d: cosine * frameState.scale.y,
    e: frameState.position.x,
    f: frameState.position.y,
  };
}

function multiplyTransformMatrices(parent: TransformMatrix, child: TransformMatrix): TransformMatrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

function invertTransformMatrix(matrix: TransformMatrix): TransformMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 0.000001) return null;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

function worldMatrixForNode(nodes: Record<NodeId, RigNode>, frame: AnimationFrame, nodeId: NodeId, cache: Map<NodeId, TransformMatrix>): TransformMatrix {
  const cached = cache.get(nodeId);
  if (cached) return cached;
  const node = nodes[nodeId];
  if (!node) return identityMatrix;
  const parent = node.parentId ? worldMatrixForNode(nodes, frame, node.parentId, cache) : identityMatrix;
  const matrix = multiplyTransformMatrices(parent, matrixFromFrameState(frameStateForNode(node, frame)));
  cache.set(nodeId, matrix);
  return matrix;
}

function stateWithMatrixTransform(state: NodeFrameState, matrix: TransformMatrix): NodeFrameState {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  if (scaleX < 0.000001) return { ...state, position: { x: matrix.e, y: matrix.f } };
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return {
    ...state,
    position: { x: matrix.e, y: matrix.f },
    rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
    scale: { x: scaleX, y: determinant / scaleX },
  };
}

function defaultTransformFrame(nodes: Record<NodeId, RigNode>): AnimationFrame {
  return { id: 'default-transforms', nodeStates: Object.fromEntries(Object.values(nodes).map((node) => [node.id, snapshotNode(node)])) };
}

function descendantsOf(nodes: Record<NodeId, RigNode>, nodeId: NodeId): NodeId[] {
  const node = nodes[nodeId];
  if (!node) return [];
  return [nodeId, ...node.children.flatMap((childId) => descendantsOf(nodes, childId))];
}

function describeNode(node: RigNode) {
  return `${node.id} ${node.name}`.toLowerCase();
}

function findCharacterNode(nodes: Record<NodeId, RigNode>, terms: string[]) {
  return Object.values(nodes).find((node) => terms.some((term) => describeNode(node).includes(term)));
}

function findLimbNode(nodes: Record<NodeId, RigNode>, side: 'left' | 'right', limb: 'arm' | 'leg') {
  const sideTerms = side === 'left' ? ['left', '左'] : ['right', '右'];
  const limbTerms = limb === 'arm' ? ['arm', 'hand', '臂', '手'] : ['leg', 'foot', '腿', '脚'];
  return Object.values(nodes).find((node) => {
    const description = describeNode(node);
    return sideTerms.some((term) => description.includes(term)) && limbTerms.some((term) => description.includes(term));
  });
}

/** Timeline-only state that must not survive a wholesale frame import. */
function clearedTimelineState() {
  return {
    isPlaying: false,
    playbackGroupId: null,
    playbackFrameIds: null,
    selectedFrameIds: [] as string[],
    frameSelectionAnchorId: null,
    inspectorSession: null,
    transformSession: null,
  };
}

const timelineHistoryLimit = 80;

function timelineSnapshot(state: TimelineTrackedState): TimelineSnapshot {
  return {
    frames: state.frames,
    currentFrameIndex: state.currentFrameIndex,
    fps: state.fps,
    isLooping: state.isLooping,
    selectedFrameIds: state.selectedFrameIds,
  };
}

/**
 * Records one undo step for a structural frame edit.
 * Frames are immutable, so the snapshots only keep references and no frame data is copied.
 */
function timelineHistory(state: TimelineTrackedState, next: TimelineChange, label: string) {
  const before = timelineSnapshot(state);
  const after: TimelineSnapshot = {
    frames: next.frames ?? state.frames,
    currentFrameIndex: next.currentFrameIndex ?? state.currentFrameIndex,
    fps: next.fps ?? state.fps,
    isLooping: next.isLooping ?? state.isLooping,
    selectedFrameIds: next.selectedFrameIds ?? state.selectedFrameIds,
  };
  if (after.frames === before.frames
    && after.currentFrameIndex === before.currentFrameIndex
    && after.fps === before.fps
    && after.isLooping === before.isLooping
    && after.selectedFrameIds === before.selectedFrameIds) return {};
  const entry: TimelineHistoryEntry = { timelineBefore: before, timelineAfter: after, label };
  return {
    transformHistory: [...state.transformHistory, entry].slice(-timelineHistoryLimit),
    redoStack: [] as HistoryEntry[],
  };
}

function restoreTimeline(snapshot: TimelineSnapshot) {
  const frames = snapshot.frames;
  return {
    frames,
    currentFrameIndex: Math.min(Math.max(0, frames.length - 1), Math.max(0, snapshot.currentFrameIndex)),
    fps: snapshot.fps,
    isLooping: snapshot.isLooping,
    selectedFrameIds: snapshot.selectedFrameIds.filter((id) => frames.some((frame) => frame.id === id)),
    frameSelectionAnchorId: null,
  };
}

function poseHistory(before: AnimationFrame[], frames: AnimationFrame[]) {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const changed = before.filter((frame) => {
    const next = byId.get(frame.id);
    return next && (JSON.stringify(frame.nodeStates) !== JSON.stringify(next.nodeStates) || frame.footLocks !== next.footLocks);
  });
  return changed.length ? { rigBefore: changed, rigAfter: changed.map((frame) => byId.get(frame.id)!) } : null;
}

function restoreRigPose(frames: AnimationFrame[], target: AnimationFrame[], previous: AnimationFrame[]) {
  const pairs = new Map(target.map((frame, index) => [frame.id, { frame, previous: previous[index] }]));
  return frames.map((current) => {
    const pair = pairs.get(current.id);
    if (!pair) return current;
    const nodeStates = { ...current.nodeStates };
    for (const id of new Set([...Object.keys(pair.frame.nodeStates), ...Object.keys(pair.previous.nodeStates)])) {
      if (pair.frame.nodeStates[id] === pair.previous.nodeStates[id]) continue;
      if (pair.frame.nodeStates[id]) nodeStates[id] = pair.frame.nodeStates[id];
      else delete nodeStates[id];
    }
    const next = { ...current, nodeStates };
    if (pair.frame.footLocks !== pair.previous.footLocks) {
      if (pair.frame.footLocks) next.footLocks = pair.frame.footLocks;
      else delete next.footLocks;
    }
    return next;
  });
}

function framesForTemplate(state: Pick<ProjectState, 'nodes' | 'rootNodeIds' | 'frames' | 'currentFrameIndex'>, template: AnimationTemplate) {
  const baseFrame = state.frames[state.currentFrameIndex];
  const baseStates = Object.fromEntries(Object.values(state.nodes).map((node) => [node.id, cloneFrameState(baseFrame?.nodeStates[node.id] ?? snapshotNode(node))])) as Record<NodeId, NodeFrameState>;
  const leftArm = findLimbNode(state.nodes, 'left', 'arm');
  const rightArm = findLimbNode(state.nodes, 'right', 'arm');
  const leftLeg = findLimbNode(state.nodes, 'left', 'leg');
  const rightLeg = findLimbNode(state.nodes, 'right', 'leg');
  const body = findCharacterNode(state.nodes, ['body', 'torso', '身体', '躯干']) ?? state.nodes[state.rootNodeIds[0] ?? ''];
  const head = findCharacterNode(state.nodes, ['head', '头']);
  const walkSwing = [0, 24, 24, 0, -24, -24];
  const bodyBob = [0, 0, 1, 1, 0, -1];
  const headBob = [0, -1, -1, 0, 1, 1];

  return Array.from({ length: 6 }, (_, index): AnimationFrame => {
    const nodeStates = Object.fromEntries(Object.entries(baseStates).map(([nodeId, frameState]) => [nodeId, cloneFrameState(frameState)])) as Record<NodeId, NodeFrameState>;
    if (template === 'walk') {
      const swing = walkSwing[index];
      if (leftArm) nodeStates[leftArm.id].rotation += swing;
      if (rightArm) nodeStates[rightArm.id].rotation -= swing;
      if (leftLeg) nodeStates[leftLeg.id].rotation -= swing;
      if (rightLeg) nodeStates[rightLeg.id].rotation += swing;
    } else {
      if (body) nodeStates[body.id].position.y += bodyBob[index];
      if (head) nodeStates[head.id].position.y += headBob[index];
    }
    return { id: `frame-${crypto.randomUUID()}`, nodeStates };
  });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  applyCodexPlan: (plan, expected) => {
    const state = get();
    if (state.nodes !== expected.nodes || state.frames !== expected.frames || state.assets !== expected.assets
      || state.rootNodeIds !== expected.rootNodeIds || state.settings !== expected.settings
      || state.fps !== expected.fps || state.isLooping !== expected.isLooping) {
      throw new Error('项目已在生成方案后改变，请重新发送请求。');
    }
    if (!plan.operations.length) throw new Error('该回复没有需要应用的修改。');
    state.commitInspectorEdit();
    state.commitTransform();
    const before: EditableScene = { nodes: state.nodes, rootNodeIds: state.rootNodeIds, frames: state.frames, fps: state.fps, isLooping: state.isLooping };
    const after = applyEditPlan(before, plan, Object.keys(state.assets));
    if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('方案没有改变项目属性。');
    const codexEditId = crypto.randomUUID();
    const entry: CodexHistoryEntry = { codexEditId, label: plan.message, before, after };
    const currentFrameId = state.frames[state.currentFrameIndex]?.id;
    set((latest) => ({
      ...after,
      currentFrameIndex: Math.max(0, after.frames.findIndex((frame) => frame.id === currentFrameId)),
      selectedFrameIds: latest.selectedFrameIds.filter((id) => after.frames.some((frame) => frame.id === id)),
      selectedNodeId: latest.selectedNodeId && after.nodes[latest.selectedNodeId] ? latest.selectedNodeId : null,
      transformHistory: [...latest.transformHistory, entry], redoStack: [],
      transformSession: null, inspectorSession: null, isPlaying: false, playbackGroupId: null,
    }));
    return codexEditId;
  },
  ...initialProject,
  projectName: 'Untitled character',
  selectedFrameIds: [],
  frameSelectionAnchorId: null,
  inspectorSession: null,
  frames: initialFrames(initialProject.nodes, initialProject.frames),
  currentFrameIndex: 0,
  isPlaying: false,
  playbackGroupId: null,
  playbackFrameIds: null,
  isLooping: true,
  onionSkinEnabled: false,
  fps: 12,
  activeTool: 'move',
  showPivot: false,
  snapEnabled: false,
  transformSession: null,
  transformHistory: [],
  redoStack: [],
  selectedNodeId: 'body',
  selectedAssetId: null,
  selectedAssetIds: [],
  selectNode: (selectedNodeId) => set({ selectedNodeId, selectedAssetId: null, selectedAssetIds: [] }),
  selectAsset: (selectedAssetId) => set({ selectedAssetId, selectedAssetIds: selectedAssetId ? [selectedAssetId] : [] }),
  selectAssets: (ids, primaryId = null) =>
    set((state) => {
      const selectedAssetIds = [...new Set(ids)].filter((id) => Boolean(state.assets[id]));
      return {
        selectedAssetIds,
        selectedAssetId: primaryId && selectedAssetIds.includes(primaryId) ? primaryId : selectedAssetIds[selectedAssetIds.length - 1] ?? null,
      };
    }),
  addAssets: (newAssets) => {
    if (!newAssets.length) return;
    get().commitInspectorEdit(); get().commitTransform();
    set((state) => ({
      assets: {
        ...state.assets,
        ...Object.fromEntries(newAssets.map((asset) => [asset.id, asset])),
      },
      selectedAssetId: newAssets.length ? newAssets[newAssets.length - 1].id : state.selectedAssetId,
      selectedAssetIds: newAssets.length ? [newAssets[newAssets.length - 1].id] : state.selectedAssetIds,
      transformHistory: [...state.transformHistory, {
        assetsBefore: Object.fromEntries(newAssets.map((asset) => [asset.id, state.assets[asset.id] ?? null])),
        assetsAfter: Object.fromEntries(newAssets.map((asset) => [asset.id, asset])),
      }], redoStack: [],
    }));
  },
  replaceAssets: (updatedAssets) => {
    get().commitInspectorEdit(); get().commitTransform();
    set((state) => {
      const valid = updatedAssets.filter((asset) => state.assets[asset.id]);
      if (!valid.length) return {};
      const assetsAfter = Object.fromEntries(valid.map((asset) => [asset.id, asset]));
      return { assets: { ...state.assets, ...assetsAfter }, transformHistory: [...state.transformHistory, {
        assetsBefore: Object.fromEntries(valid.map((asset) => [asset.id, state.assets[asset.id]])), assetsAfter,
      }], redoStack: [] };
    });
  },
  setAssetAnchor: (assetId, anchor) => {
    const asset = get().assets[assetId];
    if (!asset) return;
    const next: SpriteAsset = { ...asset };
    if (anchor) next.anchor = clampAnchor(anchor, asset.width, asset.height);
    else delete next.anchor;
    get().replaceAssets([next]);
  },
  setAssetAnchorKeepingPixels: (assetId, nodeId, anchor) =>
    set((state) => {
      const asset = state.assets[assetId];
      const node = state.nodes[nodeId];
      if (!asset || !node || node.locked) return {};
      const previousAnchor = effectiveSpriteAnchor(asset, node.pivot);
      const nextAnchor = clampAnchor({ x: Math.round(anchor.x), y: Math.round(anchor.y) }, asset.width, asset.height);
      const anchorDelta = { x: nextAnchor.x - previousAnchor.x, y: nextAnchor.y - previousAnchor.y };
      if (!anchorDelta.x && !anchorDelta.y) return {};
      const affectedNodeIds = [nodeId, ...node.children.filter((childId) => Boolean(state.nodes[childId]))];
      const nextNodes: Record<NodeId, RigNode> = {
        ...state.nodes,
        [nodeId]: { ...node, transform: { ...node.transform, position: positionWithPivotCompensation(node.transform, anchorDelta) } },
      };
      node.children.forEach((childId) => {
        const child = state.nodes[childId];
        if (!child) return;
        nextNodes[childId] = {
          ...child,
          transform: { ...child.transform, position: { x: child.transform.position.x - anchorDelta.x, y: child.transform.position.y - anchorDelta.y } },
        };
      });
      const nextFrames = state.frames.map((frame) => {
        const nodeState = frame.nodeStates[nodeId] ?? snapshotNode(node);
        const nodeStates = {
          ...frame.nodeStates,
          [nodeId]: { ...nodeState, position: positionWithPivotCompensation(nodeState, anchorDelta) },
        };
        node.children.forEach((childId) => {
          const child = state.nodes[childId];
          if (!child) return;
          const childState = frame.nodeStates[childId] ?? snapshotNode(child);
          nodeStates[childId] = { ...childState, position: { x: childState.position.x - anchorDelta.x, y: childState.position.y - anchorDelta.y } };
        });
        return { ...frame, nodeStates };
      });
      const nextAsset: SpriteAsset = { ...asset, anchor: nextAnchor };
      const historyEntry: AnchorHistoryEntry = {
        assetsBefore: { [assetId]: asset },
        assetsAfter: { [assetId]: nextAsset },
        snapshots: {
          before: capturePivotSnapshots(state.nodes, state.frames, affectedNodeIds),
          after: capturePivotSnapshots(nextNodes, nextFrames, affectedNodeIds),
        },
      };
      return {
        assets: { ...state.assets, [assetId]: nextAsset },
        nodes: nextNodes,
        frames: nextFrames,
        transformHistory: [...state.transformHistory, historyEntry],
        redoStack: [],
      };
    }),
  updateAssetSource: (id, src, width, height) =>
    set((state) => {
      const asset = state.assets[id];
      if (!asset) return {};
      return { assets: { ...state.assets, [id]: { ...asset, src, width, height } } };
    }),
  deleteAsset: (id) =>
    set((state) => {
      if (!state.assets[id]) return {};
      const { [id]: _, ...assets } = state.assets;
      const selectedAssetIds = state.selectedAssetIds.filter((assetId) => assetId !== id);
      return {
        assets,
        nodes: Object.fromEntries(Object.entries(state.nodes).map(([nodeId, node]) => {
          const previousIds = nodeSpriteIds(node);
          const removedIndex = previousIds.indexOf(id);
          const assetIds = previousIds.filter((assetId) => assetId !== id);
          return [nodeId, removedIndex >= 0 ? { ...node, assetIds, assetId: assetIds[0] ?? null } : node];
        })) as Record<NodeId, RigNode>,
        frames: state.frames.map((frame) => ({
          ...frame,
          nodeStates: Object.fromEntries(Object.entries(frame.nodeStates).map(([nodeId, nodeState]) => {
            const previousIds = state.nodes[nodeId] ? nodeSpriteIds(state.nodes[nodeId]) : [];
            const removedIndex = previousIds.indexOf(id);
            if (removedIndex < 0) return [nodeId, nodeState];
            const imageIndex = nodeState.imageIndex > removedIndex ? nodeState.imageIndex - 1 : Math.min(nodeState.imageIndex, Math.max(0, previousIds.length - 2));
            return [nodeId, { ...nodeState, imageIndex }];
          })),
        })),
        selectedAssetIds,
        selectedAssetId: state.selectedAssetId === id
          ? selectedAssetIds[selectedAssetIds.length - 1] ?? null
          : state.selectedAssetId,
      };
    }),
  createNodeForAsset: (assetId) => {
    const asset = get().assets[assetId];
    if (!asset) return;

    const id = `node-${crypto.randomUUID()}`;
    const node: RigNode = {
      id,
      name: asset.name.replace(/\.png$/i, ''),
      parentId: null,
      children: [],
      assetIds: [assetId],
      assetId,
      sortingOrder: 0,
      pivot: { x: Math.floor(asset.width / 2), y: Math.floor(asset.height / 2) },
      transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
      visible: true,
      locked: false,
    };
    set((state) => ({
      nodes: { ...state.nodes, [id]: node },
      rootNodeIds: [...state.rootNodeIds, id],
      frames: state.frames.map((frame) => ({
        ...frame,
        nodeStates: { ...frame.nodeStates, [id]: snapshotNode(node) },
      })),
      selectedNodeId: id,
      selectedAssetId: null,
      selectedAssetIds: [],
    }));
  },
  setNodeAsset: (nodeId, assetId) => {
    const node = get().nodes[nodeId];
    if (!node) return;
    const existingIndex = nodeSpriteIds(node).indexOf(assetId);
    if (existingIndex >= 0) get().setNodeFrameSprite(nodeId, existingIndex);
    else get().addNodeSprites(nodeId, [assetId]);
  },
  addNodeSprites: (nodeId, assetIds) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      const existing = nodeSpriteIds(node);
      const validNewIds = assetIds.filter((assetId) => Boolean(state.assets[assetId]) && !existing.includes(assetId));
      if (!validNewIds.length) return {};
      const nextIds = [...existing, ...validNewIds];
      const selectedIndex = nextIds.indexOf(validNewIds[validNewIds.length - 1]);
      const firstAsset = !existing.length ? state.assets[validNewIds[0]] : null;
      const selectedFrames = new Set(inspectorFrameIds(state));
      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...node,
            assetIds: nextIds,
            assetId: nextIds[0] ?? null,
            pivot: firstAsset ? { x: Math.floor(firstAsset.width / 2), y: Math.floor(firstAsset.height / 2) } : node.pivot,
          },
        },
        frames: state.frames.map((frame) => selectedFrames.has(frame.id)
          ? { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: { ...(frame.nodeStates[nodeId] ?? snapshotNode(node)), imageIndex: selectedIndex } } }
          : frame),
      };
    }),
  removeNodeSprite: (nodeId, assetId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      const previousIds = nodeSpriteIds(node);
      const removedIndex = previousIds.indexOf(assetId);
      if (removedIndex < 0) return {};
      const assetIds = previousIds.filter((id) => id !== assetId);
      return {
        nodes: { ...state.nodes, [nodeId]: { ...node, assetIds, assetId: assetIds[0] ?? null } },
        frames: state.frames.map((frame) => {
          const nodeState = frame.nodeStates[nodeId] ?? snapshotNode(node);
          const imageIndex = nodeState.imageIndex > removedIndex ? nodeState.imageIndex - 1 : Math.min(nodeState.imageIndex, Math.max(0, assetIds.length - 1));
          return { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: { ...nodeState, imageIndex } } };
        }),
      };
    }),
  setNodeFrameSprite: (nodeId, imageIndex) => {
      const state = get();
      const node = state.nodes[nodeId];
      if (!node || node.locked) return;
      const maxIndex = Math.max(0, nodeSpriteIds(node).length - 1);
      const nextIndex = Math.max(0, Math.min(maxIndex, Math.round(imageIndex)));
      state.beginInspectorEdit(nodeId);
      get().updateInspectorFrame(nodeId, { imageIndex: nextIndex });
      get().commitInspectorEdit();
  },
  renameNode: (nodeId, name) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      return { nodes: { ...state.nodes, [nodeId]: { ...node, name: name.trim() || 'Node' } } };
    }),
  addRootNode: () =>
    set((state) => {
      const node = createEmptyNode(null, 'New Node');
      return {
        nodes: { ...state.nodes, [node.id]: node },
        rootNodeIds: [...state.rootNodeIds, node.id],
        frames: state.frames.map((frame) => ({ ...frame, nodeStates: { ...frame.nodeStates, [node.id]: snapshotNode(node) } })),
        selectedNodeId: node.id,
        selectedAssetId: null,
        selectedAssetIds: [],
      };
    }),
  addChildNode: (parentId) =>
    set((state) => {
      const parent = state.nodes[parentId];
      if (!parent) return {};
      const child = createEmptyNode(parentId, 'New Child');
      return {
        nodes: { ...state.nodes, [child.id]: child, [parentId]: { ...parent, children: [...parent.children, child.id] } },
        frames: state.frames.map((frame) => ({ ...frame, nodeStates: { ...frame.nodeStates, [child.id]: snapshotNode(child) } })),
        selectedNodeId: child.id,
        selectedAssetId: null,
        selectedAssetIds: [],
      };
    }),
  reparentNode: (nodeId, parentId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node || node.parentId === parentId || (parentId && !state.nodes[parentId])) return {};
      if (parentId && descendantsOf(state.nodes, nodeId).includes(parentId)) return {};
      const defaults = defaultTransformFrame(state.nodes);
      const defaultCache = new Map<NodeId, TransformMatrix>();
      const oldDefaultWorld = worldMatrixForNode(state.nodes, defaults, nodeId, defaultCache);
      const newParentDefaultWorld = parentId ? worldMatrixForNode(state.nodes, defaults, parentId, defaultCache) : identityMatrix;
      const inverseDefaultParent = invertTransformMatrix(newParentDefaultWorld);
      if (!inverseDefaultParent) return {};
      const defaultState = stateWithMatrixTransform(snapshotNode(node), multiplyTransformMatrices(inverseDefaultParent, oldDefaultWorld));
      let nodes: Record<NodeId, RigNode> = {
        ...state.nodes,
        [nodeId]: {
          ...node,
          parentId,
          transform: { position: defaultState.position, rotation: defaultState.rotation, scale: defaultState.scale },
        },
      };
      if (node.parentId) {
        const oldParent = nodes[node.parentId];
        nodes = { ...nodes, [oldParent.id]: { ...oldParent, children: oldParent.children.filter((childId) => childId !== nodeId) } };
      }
      if (parentId) {
        const newParent = nodes[parentId];
        nodes = { ...nodes, [parentId]: { ...newParent, children: [...newParent.children, nodeId] } };
      }
      const rootNodeIds = state.rootNodeIds.filter((id) => id !== nodeId);
      if (!parentId) rootNodeIds.push(nodeId);
      const frames = state.frames.map((frame) => {
        const cache = new Map<NodeId, TransformMatrix>();
        const oldWorld = worldMatrixForNode(state.nodes, frame, nodeId, cache);
        const newParentWorld = parentId ? worldMatrixForNode(state.nodes, frame, parentId, cache) : identityMatrix;
        const inverseParent = invertTransformMatrix(newParentWorld);
        if (!inverseParent) return frame;
        const current = frameStateForNode(node, frame);
        return { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: stateWithMatrixTransform(current, multiplyTransformMatrices(inverseParent, oldWorld)) } };
      });
      return { nodes, rootNodeIds, frames };
    }),
  setNodeSortingOrder: (nodeId, sortingOrder) => {
    get().beginInspectorEdit(nodeId);
    get().updateInspectorFrame(nodeId, { sortingOrder: Number.isFinite(sortingOrder) ? Math.round(sortingOrder) : 0 });
    get().commitInspectorEdit();
  },
  toggleNodeVisibility: (id) =>
    set((state) => ({
      nodes: { ...state.nodes, [id]: { ...state.nodes[id], visible: !state.nodes[id].visible } },
    })),
  toggleNodeLock: (id) =>
    set((state) => ({
      nodes: { ...state.nodes, [id]: { ...state.nodes[id], locked: !state.nodes[id].locked } },
    })),
  selectFrame: (index, mode = 'single') => {
    get().commitInspectorEdit();
    get().commitTransform();
    set((state) => {
      const target = state.frames[index];
      if (!target) return {};
      let ids = inspectorFrameIds(state);
      if (mode === 'toggle') {
        ids = ids.includes(target.id) ? ids.filter((id) => id !== target.id) : [...ids, target.id];
        if (!ids.length) ids = [target.id];
      } else if (mode === 'range') {
        const anchor = state.frames.findIndex((frame) => frame.id === state.frameSelectionAnchorId);
        const start = anchor < 0 ? state.currentFrameIndex : anchor;
        ids = state.frames.slice(Math.min(start, index), Math.max(start, index) + 1).map((frame) => frame.id);
      } else ids = [target.id];
      return {
        selectedFrameIds: ids,
        frameSelectionAnchorId: mode === 'range' ? state.frameSelectionAnchorId : target.id,
        currentFrameIndex: ids.includes(target.id) ? index : state.frames.findIndex((frame) => frame.id === ids[ids.length - 1]),
        isPlaying: false,
        playbackGroupId: null,
      };
    });
  },
  togglePlayback: () =>
    set((state) => {
      if (state.isPlaying) return { isPlaying: false, playbackGroupId: null, playbackFrameIds: null };
      return {
        isPlaying: true,
        selectedFrameIds: [],
        playbackFrameIds: null,
        playbackGroupId: state.frames[state.currentFrameIndex]?.group?.id ?? null,
      };
    }),
  toggleSelectionPlayback: () => {
    get().commitInspectorEdit();
    get().commitTransform();
    set((state) => {
      if (state.isPlaying && state.playbackFrameIds) {
        return { isPlaying: false, playbackFrameIds: null };
      }
      const selected = inspectorFrameIds(state);
      const group = state.frames[state.currentFrameIndex]?.group;
      const ids = selected.length > 1 || !group
        ? selected
        : state.frames.filter((frame) => frame.group?.id === group.id).map((frame) => frame.id);
      if (ids.length < 2) return {};
      return {
        isPlaying: true, playbackGroupId: null, playbackFrameIds: ids,
        currentFrameIndex: state.frames.findIndex((frame) => frame.id === ids[0]),
      };
    });
  },
  advanceFrame: () =>
    set((state) => {
      if (!state.isPlaying) return {};
      const selected = state.playbackFrameIds ? new Set(state.playbackFrameIds) : null;
      const playbackIndexes = selected
        ? state.frames.flatMap((frame, index) => selected.has(frame.id) ? [index] : [])
        : state.playbackGroupId
        ? state.frames.flatMap((frame, index) => frame.group?.id === state.playbackGroupId ? [index] : [])
        : state.frames.map((_, index) => index);
      if (!playbackIndexes.length) return { isPlaying: false, playbackGroupId: null, playbackFrameIds: null };

      const playbackPosition = playbackIndexes.indexOf(state.currentFrameIndex);
      if (playbackPosition < 0) return { currentFrameIndex: playbackIndexes[0] };
      if (playbackPosition < playbackIndexes.length - 1) {
        return { currentFrameIndex: playbackIndexes[playbackPosition + 1] };
      }
      if (selected || state.isLooping) return { currentFrameIndex: playbackIndexes[0] };
      return { isPlaying: false, playbackGroupId: null };
    }),
  toggleLooping: () => set((state) => ({ isLooping: !state.isLooping })),
  toggleOnionSkin: () => set((state) => ({ onionSkinEnabled: !state.onionSkinEnabled })),
  setFps: (fps) => set({ fps: Number.isFinite(fps) ? Math.min(60, Math.max(1, Math.round(fps))) : 12 }),
  insertFrame: () =>
    set((state) => {
      const nextIndex = state.currentFrameIndex + 1;
      const frames = [...state.frames];
      frames.splice(nextIndex, 0, createFrame(state.nodes));
      const next = { frames, currentFrameIndex: nextIndex, isPlaying: false };
      return { ...next, ...timelineHistory(state, next, 'Insert frame') };
    }),
  duplicateFrame: () => {
    get().commitInspectorEdit();
    get().commitTransform();
    set((state) => {
      const selected = new Set(inspectorFrameIds(state));
      const originals = state.frames.filter((frame) => selected.has(frame.id));
      if (!originals.length) return {};
      const copies = originals.map(cloneFrame);
      const insertionIndex = state.frames.lastIndexOf(originals[originals.length - 1]) + 1;
      const activeCopyOffset = originals.indexOf(state.frames[state.currentFrameIndex]);
      const frames = [...state.frames];
      frames.splice(insertionIndex, 0, ...copies);
      const selectedFrameIds = copies.map((frame) => frame.id);
      const next = {
        ...clearedTimelineState(), frames, selectedFrameIds,
        currentFrameIndex: insertionIndex + activeCopyOffset,
        frameSelectionAnchorId: copies[activeCopyOffset].id,
      };
      return { ...next, ...timelineHistory(state, next, copies.length > 1 ? `Duplicate ${copies.length} frames` : 'Duplicate frame') };
    });
  },
  deleteFrame: () =>
    set((state) => {
      // A multi-frame selection deletes every selected frame; otherwise only the current one.
      const doomed = new Set(inspectorFrameIds(state));
      if (!doomed.size) return { isPlaying: false };
      const frames = state.frames.filter((frame) => !doomed.has(frame.id));
      // An animation needs at least one frame, so a selection covering the whole timeline is refused.
      if (!frames.length) return { isPlaying: false };
      const removedBeforeCurrent = state.frames
        .slice(0, state.currentFrameIndex)
        .filter((frame) => doomed.has(frame.id)).length;
      const next = {
        frames,
        currentFrameIndex: Math.min(frames.length - 1, Math.max(0, state.currentFrameIndex - removedBeforeCurrent)),
        isPlaying: false,
        playbackGroupId: null,
        selectedFrameIds: [] as string[],
        frameSelectionAnchorId: null,
        transformSession: null,
        inspectorSession: null,
      };
      return { ...next, ...timelineHistory(state, next, doomed.size > 1 ? `Delete ${doomed.size} frames` : 'Delete frame') };
    }),
  moveFrame: (fromIndex, toIndex) => {
    const state = get();
    if (fromIndex === toIndex || !state.frames[fromIndex] || !state.frames[toIndex]) return;
    state.moveFrames([state.frames[fromIndex].id], toIndex + (fromIndex < toIndex ? 1 : 0));
  },
  moveFrames: (frameIds, boundary) => {
    const state = get();
    if (!Number.isInteger(boundary) || boundary < 0 || boundary > state.frames.length) return false;
    const selected = new Set(frameIds);
    const moved = state.frames.filter((frame) => selected.has(frame.id));
    if (!moved.length || moved.length !== selected.size) return false;
    const insertionIndex = state.frames.slice(0, boundary).filter((frame) => !selected.has(frame.id)).length;
    const remaining = state.frames.filter((frame) => !selected.has(frame.id));
    remaining.splice(insertionIndex, 0, ...moved);
    if (remaining.every((frame, index) => frame === state.frames[index])) return false;

    state.commitInspectorEdit();
    state.commitTransform();
    const current = get();
    const activeId = current.frames[current.currentFrameIndex]?.id;
    const focusedId = activeId && selected.has(activeId) ? activeId : moved[0].id;
    const anchor = current.frameSelectionAnchorId;
    const next = {
      ...clearedTimelineState(), frames: remaining,
      currentFrameIndex: remaining.findIndex((frame) => frame.id === focusedId),
      selectedFrameIds: moved.map((frame) => frame.id),
      frameSelectionAnchorId: anchor && selected.has(anchor) ? anchor : focusedId,
    };
    set({ ...next, ...timelineHistory(current, next, moved.length > 1 ? `Move ${moved.length} frames` : 'Move frame') });
    return true;
  },
  insertTweenFrames: (firstIndex, secondIndex, requestedCount, properties) =>
    set((state) => {
      const startIndex = Math.min(firstIndex, secondIndex);
      const endIndex = Math.max(firstIndex, secondIndex);
      const startFrame = state.frames[startIndex];
      const endFrame = state.frames[endIndex];
      const count = Math.max(1, Math.min(120, Math.round(requestedCount)));
      if (!startFrame || !endFrame || startIndex === endIndex || !Object.values(properties).some(Boolean)) return {};
      const tweenFrames = Array.from({ length: count }, (_, index): AnimationFrame => {
        const amount = (index + 1) / (count + 1);
        return {
          id: `frame-${crypto.randomUUID()}`,
          nodeStates: Object.fromEntries(Object.values(state.nodes).map((node) => {
            const start = startFrame.nodeStates[node.id] ?? snapshotNode(node);
            const end = endFrame.nodeStates[node.id] ?? snapshotNode(node);
            return [node.id, tweenNodeState(start, end, amount, properties)];
          })),
        };
      });
      const frames = [...state.frames];
      frames.splice(startIndex + 1, 0, ...tweenFrames);
      const next = { frames, currentFrameIndex: startIndex + 1, isPlaying: false, transformSession: null };
      return { ...next, ...timelineHistory(state, next, `Insert ${count} in-between frame${count === 1 ? '' : 's'}`) };
    }),
  groupFrames: (frameIndexes, name, color) =>
    set((state) => {
      const selected = new Set(frameIndexes.filter((index) => index >= 0 && index < state.frames.length));
      if (!selected.size) return {};
      const group: FrameGroup = {
        id: `group-${crypto.randomUUID()}`,
        name: name.trim() || 'Frame Group',
        color,
      };
      const next = {
        frames: state.frames.map((frame, index) => selected.has(index) ? { ...frame, group: { ...group } } : frame),
        isPlaying: false,
      };
      return { ...next, ...timelineHistory(state, next, `Group ${selected.size} frame${selected.size === 1 ? '' : 's'}`) };
    }),
  addFramesToGroup: (frameIndexes, groupId) =>
    set((state) => {
      const selected = new Set(frameIndexes.filter((index) => index >= 0 && index < state.frames.length));
      const group = state.frames.find((frame) => frame.group?.id === groupId)?.group;
      if (!selected.size || !group) return {};
      const next = {
        frames: state.frames.map((frame, index) => selected.has(index) ? { ...frame, group: { ...group } } : frame),
        isPlaying: false,
      };
      return { ...next, ...timelineHistory(state, next, `Add ${selected.size} frame${selected.size === 1 ? '' : 's'} to “${group.name}”`) };
    }),
  removeFramesFromGroup: (frameIndexes) =>
    set((state) => {
      const selected = new Set(frameIndexes.filter((index) => index >= 0 && index < state.frames.length));
      const affected = state.frames.filter((frame, index) => selected.has(index) && frame.group).length;
      if (!affected) return {};
      const next = {
        frames: state.frames.map((frame, index) => {
          if (!selected.has(index) || !frame.group) return frame;
          const { group: _, ...ungrouped } = frame;
          return ungrouped;
        }),
        isPlaying: false,
      };
      return { ...next, ...timelineHistory(state, next, `Remove ${affected} frame${affected === 1 ? '' : 's'} from group`) };
    }),
  renameFrameGroup: (groupId, name, color) =>
    set((state) => {
      const next = {
        frames: state.frames.map((frame) => frame.group?.id === groupId
          ? { ...frame, group: { id: groupId, name: name.trim() || 'Frame Group', color } }
          : frame),
      };
      return { ...next, ...timelineHistory(state, next, 'Edit frame group') };
    }),
  ungroupFrames: (groupId) =>
    set((state) => {
      const next = {
        frames: state.frames.map((frame) => {
          if (frame.group?.id !== groupId) return frame;
          const { group: _, ...ungrouped } = frame;
          return ungrouped;
        }),
      };
      return { ...next, ...timelineHistory(state, next, 'Ungroup frames') };
    }),
  updateCanvasFrame: (canvasData) =>
    set((state) => ({
      frames: state.frames.map((frame, index) => index === state.currentFrameIndex ? { ...frame, canvasData } : frame),
      isPlaying: false,
    })),
  applyAnimationTemplate: (template) =>
    set((state) => {
      const nextIndex = state.currentFrameIndex + 1;
      const frames = [...state.frames];
      frames.splice(nextIndex, 0, ...framesForTemplate(state, template));
      const next = {
        frames,
        currentFrameIndex: nextIndex,
        isPlaying: false,
        transformSession: null,
      };
      return { ...next, ...timelineHistory(state, next, `Add ${template} template frames`) };
    }),
  loadAnimation: (animation, options) => {
    const state = get();
    const matchedNodeIds = Object.keys(state.nodes).filter((nodeId) => animation.frames.some((frame) => Boolean(frame.nodeStates[nodeId])));
    if (!matchedNodeIds.length) return false;
    const importedFrames = animation.frames.map((frame) => ({
      id: `frame-${crypto.randomUUID()}`,
      canvasData: frame.canvasData,
      group: frame.group ? { ...frame.group } : undefined,
      nodeStates: Object.fromEntries(Object.values(state.nodes).map((node) => [
        node.id,
        cloneFrameState(frame.nodeStates[node.id] ?? snapshotNode(node)),
      ])) as Record<NodeId, NodeFrameState>,
    }));
    const mode = options?.mode ?? 'replace';
    const startIndex = Math.max(0, Math.min(state.frames.length, Math.round(options?.startIndex ?? state.currentFrameIndex)));
    if (mode === 'insert') {
      const frames = [...state.frames];
      frames.splice(startIndex, 0, ...importedFrames);
      const next = { ...clearedTimelineState(), frames, currentFrameIndex: startIndex };
      set({ ...next, ...timelineHistory(state, next, `Import ${importedFrames.length} animation frames`) });
      return true;
    }
    if (mode === 'delta') {
      const baseFrame = state.frames[startIndex];
      if (!baseFrame) return false;
      const frames = [...state.frames];
      let previousStates = baseFrame.nodeStates;
      importedFrames.forEach((frame, offset) => {
        const previousSourceStates = offset === 0 ? frame.nodeStates : importedFrames[offset - 1].nodeStates;
        const nodeStates = Object.fromEntries(Object.values(state.nodes).map((node) => {
          const current = previousStates[node.id] ?? snapshotNode(node);
          return [node.id, addPoseDelta(
            current,
            frame.nodeStates[node.id] ?? snapshotNode(node),
            previousSourceStates[node.id] ?? snapshotNode(node),
            nodeSpriteIds(node).length,
          )];
        })) as Record<NodeId, NodeFrameState>;
        const index = startIndex + offset;
        const existing = frames[index];
        // Keep the original frame id, group and drawing layer: only the pose accumulates.
        const nextFrame = existing ? { ...existing, nodeStates } : { id: `frame-${crypto.randomUUID()}`, nodeStates };
        if (offset) delete nextFrame.footLocks;
        frames[index] = nextFrame;
        previousStates = nodeStates;
      });
      const next = { ...clearedTimelineState(), frames, currentFrameIndex: startIndex };
      set({ ...next, ...timelineHistory(state, next, `Apply ${importedFrames.length} animation deltas`) });
      return true;
    }
    if (mode === 'overwrite') {
      const frames = [...state.frames];
      importedFrames.forEach((frame, offset) => {
        const existing = frames[startIndex + offset];
        // Keep the original frame id and group so selections and grouping survive the paste.
        frames[startIndex + offset] = existing
          ? { ...existing, canvasData: frame.canvasData, nodeStates: frame.nodeStates }
          : frame;
        delete frames[startIndex + offset].footLocks;
      });
      const next = { ...clearedTimelineState(), frames, currentFrameIndex: startIndex };
      set({ ...next, ...timelineHistory(state, next, `Overwrite ${importedFrames.length} animation frames`) });
      return true;
    }
    const next = {
      ...clearedTimelineState(),
      frames: importedFrames,
      currentFrameIndex: 0,
      isLooping: animation.loop,
      fps: animation.fps,
    };
    set({ ...next, ...timelineHistory(state, next, 'Replace timeline with imported animation') });
    return true;
  },
  setActiveTool: (activeTool) => set({ activeTool }),
  toggleShowPivot: () => set((state) => ({ showPivot: !state.showPivot })),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  togglePixelPerfectRotation: () => set((state) => ({
    settings: { ...state.settings, pixelPerfectRotation: !state.settings.pixelPerfectRotation },
  })),
  setPixelGridSize: (size) => set((state) => ({
    settings: { ...state.settings, pixelGridSize: Math.max(1, Math.min(16, Math.round(size || 1))) },
  })),
  setRotationSnapAngle: (rotationSnapAngle) => set((state) => ({
    settings: { ...state.settings, rotationSnapAngle },
  })),
  beginTransform: (nodeId) => {
    get().commitInspectorEdit();
    get().commitTransform();
    set((state) => {
      const node = state.nodes[nodeId];
      const frame = state.frames[state.currentFrameIndex];
      if (!node || node.locked || !frame) return {};
      const before = frame.nodeStates[nodeId] ?? snapshotNode(node);
      const frameIds = inspectorFrameIds(state);
      const poseFrames = state.frames.filter((item) => frameIds.includes(item.id));
      const hasLockedFeet = poseFrames.some((item) => activeFootLocks(state.nodes, item)
        .some(([endId]) => endId !== nodeId && isAncestor(state.nodes, nodeId, endId)));
      return {
        transformSession: { nodeId, frameIndex: state.currentFrameIndex, before: cloneFrameState(before), frameIds,
          frameStates: frameIds.map((id) => {
            const value = state.frames.find((item) => item.id === id)?.nodeStates[nodeId];
            return value ? cloneFrameState(value) : null;
          }), ...(hasLockedFeet ? { poseFrames } : {}) },
        isPlaying: false, playbackGroupId: null,
      };
    });
  },
  setIkBinding: (endId, name) => {
    get().commitInspectorEdit();
    get().commitTransform();
    const state = get();
    const node = state.nodes[endId];
    if (!node) return 'Select an endpoint.';
    const chain = ikHierarchy(state.nodes, endId);
    const label = name?.trim().slice(0, 48);
    if (name !== null && (!chain || !label)) return 'Enter a name and select a tip below two joints.';
    const binding = label && chain ? { name: label, upperId: chain.upper.id, lowerId: chain.lower.id } : undefined;
    if (JSON.stringify(node.ikBinding) === JSON.stringify(binding)) return null;
    const entry: IkBindingHistoryEntry = { bindingEnd: endId, bindingBefore: node.ikBinding, bindingAfter: binding };
    set({ nodes: withIkBinding(state.nodes, endId, binding), transformHistory: [...state.transformHistory, entry], redoStack: [] });
    return null;
  },
  beginIk: (endId, mode = 'move') => {
    const state = get();
    const frame = state.frames[state.currentFrameIndex];
    const target = frame && captureFootLock(state.nodes, frame, endId);
    if (!frame || !target || activeFootLocks(state.nodes, frame).some(([id, lock]) =>
      !(mode === 'bend' && id === endId) && (isAncestor(state.nodes, lock.upperId, endId) || isAncestor(state.nodes, target.upperId, id)))) return false;
    state.beginTransform(endId);
    const current = get();
    const session = current.transformSession;
    if (!session) return false;
    set({ transformSession: { ...session, ik: mode, poseFrames: current.frames.filter((item) => session.frameIds.includes(item.id)) } });
    return true;
  },
  dragIk: (delta) => set((state) => {
    const session = state.transformSession;
    if (session?.ik !== 'move' || !session.poseFrames || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return {};
    const byId = new Map(session.poseFrames.map((frame) => [frame.id, frame]));
    return { frames: state.frames.map((frame) => {
      const original = byId.get(frame.id);
      if (!original) return frame;
      const start = captureFootLock(state.nodes, original, session.nodeId);
      if (!start || activeFootLocks(state.nodes, original).some(([id, lock]) =>
        isAncestor(state.nodes, lock.upperId, session.nodeId) || isAncestor(state.nodes, start.upperId, id))) return frame;
      const target = { x: start.point.x + delta.x, y: start.point.y + delta.y };
      const solved = !delta.x && !delta.y ? original
        : solveTwoBone(state.nodes, original, session.nodeId, target, original, false, start.axis)?.frame;
      return solved ? { ...frame, nodeStates: solved.nodeStates } : frame;
    }) };
  }),
  dragIkBend: (side) => set((state) => {
    const session = state.transformSession;
    if (session?.ik !== 'bend' || !session.poseFrames) return {};
    const originals = new Map(session.poseFrames.map((frame) => [frame.id, frame]));
    return { frames: state.frames.map((frame) => {
      const original = originals.get(frame.id);
      if (!original) return frame;
      const target = captureFootLock(state.nodes, original, session.nodeId);
      if (!target || activeFootLocks(state.nodes, original).some(([id, lock]) => id !== session.nodeId
        && (isAncestor(state.nodes, lock.upperId, session.nodeId) || isAncestor(state.nodes, target.upperId, id)))) return frame;
      return { ...frame, nodeStates: poseIkBend(state.nodes, original, session.nodeId, side).nodeStates };
    }) };
  }),
  reverseIkBend: (endId) => {
    get().commitInspectorEdit();
    get().commitTransform();
    const state = get();
    const selected = new Set(inspectorFrameIds(state));
    const originals = state.frames.filter((frame) => selected.has(frame.id));
    const frames = state.frames.map((frame) => {
      if (!selected.has(frame.id)) return frame;
      const target = activeFootLocks(state.nodes, frame).find(([id]) => id === endId)?.[1] ?? captureFootLock(state.nodes, frame, endId);
      if (!target || activeFootLocks(state.nodes, frame).some(([id, lock]) => id !== endId
        && (isAncestor(state.nodes, lock.upperId, endId) || isAncestor(state.nodes, target.upperId, id)))) return frame;
      const solved = solveTwoBone(state.nodes, frame, endId, target.point, frame, true, target.axis);
      return solved && solved.error <= .005 ? solved.frame : frame;
    });
    const history = poseHistory(originals, frames);
    if (!history) return 'The selected pose cannot bend the other way at this target.';
    set({ frames, transformHistory: [...state.transformHistory, history], redoStack: [], isPlaying: false, playbackGroupId: null });
    return null;
  },
  toggleFootLock: (endId) => {
    get().commitInspectorEdit();
    get().commitTransform();
    const state = get();
    const frame = state.frames[state.currentFrameIndex];
    if (!frame) return 'Select a frame first.';
    const selected = new Set(inspectorFrameIds(state));
    const originals = state.frames.filter((item) => selected.has(item.id));
    const unlocking = originals.every((item) => Boolean(item.footLocks?.[endId]));
    const target = unlocking ? null : captureFootLock(state.nodes, frame, endId);
    if (!unlocking && !target) return 'Choose a wrist, ankle or tip below two unlocked joints with nonzero bone lengths.';
    const replacements = new Map<string, AnimationFrame>();
    for (const item of originals) {
      const footLocks = { ...item.footLocks };
      if (!target) {
        delete footLocks[endId];
        const updated = { ...item };
        if (Object.keys(footLocks).length) updated.footLocks = footLocks; else delete updated.footLocks;
        replacements.set(item.id, updated);
        continue;
      }
      const overlapping = activeFootLocks(state.nodes, item).some(([id, other]) => id !== endId
        && (isAncestor(state.nodes, other.upperId, endId) || isAncestor(state.nodes, target.upperId, id)));
      if (overlapping) return 'Unlock the overlapping chain first.';
      const end = nodePivotWorld(state.nodes, item, endId);
      const solved = Math.hypot(end.x - target.point.x, end.y - target.point.y) <= .00001 && item === frame
        ? { frame: item, error: 0 }
        : solveTwoBone(state.nodes, item, endId, target.point, item, false, target.axis);
      if (!solved || solved.error > .005) return `Frame ${state.frames.indexOf(item) + 1} cannot reach the lock point. Move the body closer or narrow the selection.`;
      replacements.set(item.id, { ...solved.frame, footLocks: { ...footLocks, [endId]: target } });
    }
    const frames = state.frames.map((item) => replacements.get(item.id) ?? item);
    const history = poseHistory(originals, frames);
    if (history) set({ frames, transformHistory: [...state.transformHistory, history], redoStack: [], isPlaying: false, playbackGroupId: null });
    return null;
  },
  updateNodeFrame: (nodeId, patch) => {
    if (get().transformSession?.nodeId !== nodeId) get().beginTransform(nodeId);
    set((state) => {
      const node = state.nodes[nodeId];
      const session = state.transformSession;
      if (!node || node.locked || !session || session.nodeId !== nodeId) return {};
      const angleIncrement = state.settings.rotationSnapAngle;
      const snappedPatch = patch.rotation !== undefined && angleIncrement > 0
        ? { ...patch, rotation: Math.round(patch.rotation / angleIncrement) * angleIncrement }
        : patch;
      return { frames: state.frames.map((frame) => {
        const index = session.frameIds.indexOf(frame.id);
        if (index < 0) return frame;
        const base = session.frameStates[index] ?? snapshotNode(node);
        const current = frame.nodeStates[nodeId] ?? snapshotNode(node);
        const next = mergeFrameState(current, relativeTransformPatch(base, session.before, snappedPatch));
        if (patch.position && activeFootLocks(state.nodes, frame).some(([endId]) => endId === nodeId)) return frame;
        const original = session.poseFrames?.[index];
        if (original && patch.position) return moveWithFootLocks(state.nodes, original, frame, nodeId, next.position);
        return { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: next } };
      }) };
    });
  },
  beginInspectorEdit: (nodeId) => {
    get().commitTransform();
    get().commitInspectorEdit();
    set((state) => {
      if (!state.nodes[nodeId] || state.nodes[nodeId].locked) return {};
      const frameIds = inspectorFrameIds(state);
      const poseFrames = state.frames.filter((frame) => frameIds.includes(frame.id));
      const hasLockedFeet = poseFrames.some((frame) => activeFootLocks(state.nodes, frame)
        .some(([endId]) => endId !== nodeId && isAncestor(state.nodes, nodeId, endId)));
      return {
        inspectorSession: {
          nodeId, frameIds,
          ...(hasLockedFeet ? { poseFrames } : {}),
          before: frameIds.map((id) => {
            const value = state.frames.find((frame) => frame.id === id)?.nodeStates[nodeId];
            return value ? cloneFrameState(value) : null;
          }),
        },
        isPlaying: false, playbackGroupId: null,
      };
    });
  },
  updateInspectorFrame: (nodeId, patch) => {
    if (get().inspectorSession?.nodeId !== nodeId) get().beginInspectorEdit(nodeId);
    set((state) => {
      const node = state.nodes[nodeId];
      const session = state.inspectorSession;
      if (!node || node.locked || !session || session.nodeId !== nodeId) return {};
      const angle = state.settings.rotationSnapAngle;
      const adjusted = patch.rotation !== undefined && angle > 0
        ? { ...patch, rotation: Math.round(patch.rotation / angle) * angle } : patch;
      return {
        frames: state.frames.map((frame) => {
          const index = session.frameIds.indexOf(frame.id);
          if (index < 0) return frame;
          const current = frame.nodeStates[nodeId] ?? snapshotNode(node);
          const next = mergeFrameState(current, adjusted);
          if (adjusted.position && activeFootLocks(state.nodes, frame).some(([endId]) => endId === nodeId)) return frame;
          const updated = { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: next } };
          const original = session.poseFrames?.[index];
          if (original && adjusted.position) {
            updated.nodeStates[nodeId] = { ...next, position: current.position };
            return moveWithFootLocks(state.nodes, original, updated, nodeId, next.position);
          }
          return updated;
        }),
      };
    });
  },
  commitInspectorEdit: () => set((state) => {
    const session = state.inspectorSession;
    if (!session) return {};
    if (session.poseFrames) {
      const history = poseHistory(session.poseFrames, state.frames);
      return history ? { inspectorSession: null, transformHistory: [...state.transformHistory, history], redoStack: [] } : { inspectorSession: null };
    }
    const after = session.frameIds.map((id) => {
      const value = state.frames.find((frame) => frame.id === id)?.nodeStates[session.nodeId];
      return value ? cloneFrameState(value) : null;
    });
    if (after.every((value, index) => value && session.before[index]
      ? stateMatches(value, session.before[index]!) : value === session.before[index])) return { inspectorSession: null };
    const entry: NodeFramesHistoryEntry = { nodeId: session.nodeId, frameIds: session.frameIds, frameStates: { before: session.before, after } };
    return { inspectorSession: null, transformHistory: [...state.transformHistory, entry], redoStack: [] };
  }),
  syncNodeFrameToAllFrames: (nodeId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      const frame = state.frames[state.currentFrameIndex];
      if (!node || node.locked || !frame || state.frames.length < 2) return {};
      const sourceState = cloneFrameState(frame.nodeStates[nodeId] ?? snapshotNode(node));
      const before = state.frames.map((item) => item.nodeStates[nodeId] ? cloneFrameState(item.nodeStates[nodeId]) : null);
      if (before.every((item) => item && stateMatches(item, sourceState))) return {};
      const frames = state.frames.map((item) => ({
        ...item,
        nodeStates: { ...item.nodeStates, [nodeId]: cloneFrameState(sourceState) },
      }));
      const entry: NodeFramesHistoryEntry = {
        nodeId,
        frameStates: {
          before,
          after: frames.map((item) => cloneFrameState(item.nodeStates[nodeId])),
        },
      };
      return {
        frames,
        isPlaying: false,
        playbackGroupId: null,
        transformSession: null,
        transformHistory: [...state.transformHistory, entry],
        redoStack: [],
      };
    }),
  commitTransform: () =>
    set((state) => {
      const session = state.transformSession;
      if (!session) return {};
      if (session.poseFrames) {
        const history = poseHistory(session.poseFrames, state.frames);
        return history ? { transformSession: null, transformHistory: [...state.transformHistory, history], redoStack: [] } : { transformSession: null };
      }
      const after = session.frameIds.map((id) => {
        const value = state.frames.find((frame) => frame.id === id)?.nodeStates[session.nodeId];
        return value ? cloneFrameState(value) : null;
      });
      if (after.every((value, index) => value && session.frameStates[index]
        ? stateMatches(value, session.frameStates[index]!) : value === session.frameStates[index])) return { transformSession: null };
      const entry: NodeFramesHistoryEntry = { nodeId: session.nodeId, frameIds: session.frameIds, frameStates: { before: session.frameStates, after } };
      return {
        transformSession: null,
        transformHistory: [...state.transformHistory, entry],
        redoStack: [],
      };
    }),
  resetNodeTransform: (nodeId) => {
    get().commitInspectorEdit(); get().commitTransform();
    get().beginInspectorEdit(nodeId);
    set((state) => {
      const node = state.nodes[nodeId];
      const session = state.inspectorSession;
      if (!node || node.locked || !session || session.nodeId !== nodeId) return {};
      // Reset restores the exact default, even when rotation snapping is enabled.
      return { frames: state.frames.map((frame) => session.frameIds.includes(frame.id)
        ? { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: mergeFrameState(frame.nodeStates[nodeId] ?? snapshotNode(node), node.transform) } }
        : frame) };
    });
    get().commitInspectorEdit();
  },
  flipNode: (nodeId, axis) => {
    get().commitTransform(); get().commitInspectorEdit();
    get().beginInspectorEdit(nodeId);
    set((state) => {
      const node = state.nodes[nodeId];
      const session = state.inspectorSession;
      if (!node || node.locked || !session || session.nodeId !== nodeId) return {};
      return {
        frames: state.frames.map((frame) => {
          if (!session.frameIds.includes(frame.id)) return frame;
          const before = frame.nodeStates[nodeId] ?? snapshotNode(node);
          const after = mergeFrameState(before, axis === 'horizontal' ? { scale: { x: -before.scale.x } } : { scale: { y: -before.scale.y } });
          return { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: after } };
        }),
      };
    });
    get().commitInspectorEdit();
  },
  updateNodePivot: (nodeId, pivot) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node || node.locked) return {};
      const nextPivot = { x: Math.round(pivot.x), y: Math.round(pivot.y) };
      const pivotDelta = { x: nextPivot.x - node.pivot.x, y: nextPivot.y - node.pivot.y };
      if (!pivotDelta.x && !pivotDelta.y) return {};
      const affectedNodeIds = [nodeId, ...node.children.filter((childId) => Boolean(state.nodes[childId]))];
      const nextTransform = {
        ...node.transform,
        position: positionWithPivotCompensation(node.transform, pivotDelta),
      };
      const nextNodes: Record<NodeId, RigNode> = {
        ...state.nodes,
        [nodeId]: { ...node, pivot: nextPivot, transform: nextTransform },
      };
      node.children.forEach((childId) => {
        const child = state.nodes[childId];
        if (!child) return;
        nextNodes[childId] = {
          ...child,
          transform: {
            ...child.transform,
            position: { x: child.transform.position.x - pivotDelta.x, y: child.transform.position.y - pivotDelta.y },
          },
        };
      });
      const nextFrames = state.frames.map((frame) => {
        const nodeState = frame.nodeStates[nodeId] ?? snapshotNode(node);
        const nodeStates = {
          ...frame.nodeStates,
          [nodeId]: {
            ...nodeState,
            position: positionWithPivotCompensation(nodeState, pivotDelta),
          },
        };
        node.children.forEach((childId) => {
          const child = state.nodes[childId];
          if (!child) return;
          const childState = frame.nodeStates[childId] ?? snapshotNode(child);
          nodeStates[childId] = {
            ...childState,
            position: { x: childState.position.x - pivotDelta.x, y: childState.position.y - pivotDelta.y },
          };
        });
        return { ...frame, nodeStates };
      });
      const historyEntry: PivotHistoryEntry = {
        snapshots: {
          before: capturePivotSnapshots(state.nodes, state.frames, affectedNodeIds),
          after: capturePivotSnapshots(nextNodes, nextFrames, affectedNodeIds),
        },
      };
      return {
        nodes: nextNodes,
        frames: nextFrames,
        transformHistory: [...state.transformHistory, historyEntry],
        redoStack: [],
      };
    }),
  duplicateNode: (nodeId) =>
    set((state) => {
      const source = state.nodes[nodeId];
      if (!source) return {};
      const id = `node-${crypto.randomUUID()}`;
      const copy: RigNode = { ...source, id, name: `${source.name} Copy`, children: [], assetIds: [...nodeSpriteIds(source)], transform: { ...source.transform, position: { ...source.transform.position }, scale: { ...source.transform.scale } }, pivot: { ...source.pivot } };
      delete copy.ikBinding;
      const parent = source.parentId ? state.nodes[source.parentId] : null;
      const nodes = {
        ...state.nodes,
        [id]: copy,
        ...(parent ? { [parent.id]: { ...parent, children: [...parent.children, id] } } : {}),
      };
      const rootNodeIds = parent ? state.rootNodeIds : [...state.rootNodeIds, id];
      return {
        nodes,
        rootNodeIds,
        frames: state.frames.map((frame) => ({
          ...frame,
          nodeStates: { ...frame.nodeStates, [id]: cloneFrameState(frame.nodeStates[nodeId] ?? snapshotNode(source)) },
        })),
        selectedNodeId: id,
      };
    }),
  deleteNode: (nodeId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      const deletedIds = new Set(descendantsOf(state.nodes, nodeId));
      const nodes = Object.fromEntries(Object.entries(state.nodes)
        .filter(([id]) => !deletedIds.has(id))
        .map(([id, item]) => [id, { ...item, children: item.children.filter((childId) => !deletedIds.has(childId)) }])) as Record<NodeId, RigNode>;
      return {
        nodes,
        rootNodeIds: state.rootNodeIds.filter((id) => !deletedIds.has(id)),
        frames: state.frames.map((frame) => ({
          ...frame,
          nodeStates: Object.fromEntries(Object.entries(frame.nodeStates).filter(([id]) => !deletedIds.has(id))),
        })),
        selectedNodeId: null,
      };
    }),
  undoTransform: () =>
    set((state) => {
      const entry = state.transformHistory[state.transformHistory.length - 1];
      if (!entry) return {};
      if ('bindingEnd' in entry) return {
        nodes: withIkBinding(state.nodes, entry.bindingEnd, entry.bindingBefore),
        transformHistory: state.transformHistory.slice(0, -1), redoStack: [...state.redoStack, entry],
      };
      if ('rigBefore' in entry) return {
        frames: restoreRigPose(state.frames, entry.rigBefore, entry.rigAfter),
        transformHistory: state.transformHistory.slice(0, -1), redoStack: [...state.redoStack, entry],
        isPlaying: false, playbackGroupId: null, transformSession: null, inspectorSession: null,
      };
      if ('timelineBefore' in entry) {
        return {
          ...restoreTimeline(entry.timelineBefore),
          transformHistory: state.transformHistory.slice(0, -1),
          redoStack: [...state.redoStack, entry],
          transformSession: null,
          inspectorSession: null,
          isPlaying: false,
          playbackGroupId: null,
        };
      }
      if ('assetsBefore' in entry && 'snapshots' in entry) {
        const assets = restoreAssets(state.assets, entry.assetsBefore);
        const restored = restorePivotSnapshots(state.nodes, state.frames, entry.snapshots.before);
        return {
          ...restored,
          assets,
          selectedAssetId: state.selectedAssetId && assets[state.selectedAssetId] ? state.selectedAssetId : null,
          selectedAssetIds: state.selectedAssetIds.filter((id) => assets[id]),
          transformHistory: state.transformHistory.slice(0, -1),
          redoStack: [...state.redoStack, entry],
          transformSession: null,
          inspectorSession: null,
        };
      }
      if ('assetsBefore' in entry) {
        const assets = restoreAssets(state.assets, entry.assetsBefore);
        return { assets, selectedAssetId: state.selectedAssetId && assets[state.selectedAssetId] ? state.selectedAssetId : null,
          selectedAssetIds: state.selectedAssetIds.filter((id) => assets[id]), transformHistory: state.transformHistory.slice(0, -1), redoStack: [...state.redoStack, entry], transformSession: null, inspectorSession: null };
      }
      if ('codexEditId' in entry) {
        const current: EditableScene = { nodes: state.nodes, rootNodeIds: state.rootNodeIds, frames: state.frames, fps: state.fps, isLooping: state.isLooping };
        // Existing tools that do not create history can still change the scene after an AI edit.
        // Preserve those edits as a separate redo checkpoint instead of losing them.
        if (JSON.stringify(current) !== JSON.stringify(entry.after)) {
          const checkpoint: CodexHistoryEntry = { codexEditId: crypto.randomUUID(), label: '后续手动编辑', before: entry.after, after: current };
          return {
            ...entry.after,
            currentFrameIndex: Math.min(state.currentFrameIndex, entry.after.frames.length - 1),
            selectedFrameIds: [], selectedNodeId: state.selectedNodeId && entry.after.nodes[state.selectedNodeId] ? state.selectedNodeId : null,
            redoStack: [...state.redoStack, checkpoint],
            transformSession: null, inspectorSession: null, isPlaying: false, playbackGroupId: null,
          };
        }
        return {
          ...entry.before,
          currentFrameIndex: Math.min(state.currentFrameIndex, entry.before.frames.length - 1),
          selectedFrameIds: state.selectedFrameIds.filter((id) => entry.before.frames.some((frame) => frame.id === id)),
          selectedNodeId: state.selectedNodeId && entry.before.nodes[state.selectedNodeId] ? state.selectedNodeId : null,
          transformHistory: state.transformHistory.slice(0, -1), redoStack: [...state.redoStack, entry],
          transformSession: null, inspectorSession: null, isPlaying: false, playbackGroupId: null,
        };
      }
      if ('snapshots' in entry) {
        const restored = restorePivotSnapshots(state.nodes, state.frames, entry.snapshots.before);
        return {
          ...restored,
          transformHistory: state.transformHistory.slice(0, -1),
          redoStack: [...state.redoStack, entry],
          transformSession: null,
        };
      }
      if ('frameStates' in entry) {
        if (!state.nodes[entry.nodeId]) return {};
        return {
          frames: restoreNodeFrameStates(state.frames, entry.nodeId, entry.frameStates.before, entry.frameIds),
          transformHistory: state.transformHistory.slice(0, -1),
          redoStack: [...state.redoStack, entry],
          transformSession: null,
        };
      }
      if (!state.nodes[entry.nodeId]) return {};
      return {
        frames: withFrameNodeState(state.frames, entry.frameIndex, entry.nodeId, entry.before),
        transformHistory: state.transformHistory.slice(0, -1),
        redoStack: [...state.redoStack, entry],
        transformSession: null,
      };
    }),
  redoTransform: () =>
    set((state) => {
      const entry = state.redoStack[state.redoStack.length - 1];
      if (!entry) return {};
      if ('bindingEnd' in entry) return {
        nodes: withIkBinding(state.nodes, entry.bindingEnd, entry.bindingAfter),
        transformHistory: [...state.transformHistory, entry], redoStack: state.redoStack.slice(0, -1),
      };
      if ('rigAfter' in entry) return {
        frames: restoreRigPose(state.frames, entry.rigAfter, entry.rigBefore),
        transformHistory: [...state.transformHistory, entry], redoStack: state.redoStack.slice(0, -1),
        isPlaying: false, playbackGroupId: null, transformSession: null, inspectorSession: null,
      };
      if ('timelineBefore' in entry) {
        return {
          ...restoreTimeline(entry.timelineAfter),
          transformHistory: [...state.transformHistory, entry],
          redoStack: state.redoStack.slice(0, -1),
          transformSession: null,
          inspectorSession: null,
          isPlaying: false,
          playbackGroupId: null,
        };
      }
      if ('assetsBefore' in entry && 'snapshots' in entry) {
        const assets = restoreAssets(state.assets, entry.assetsAfter);
        const restored = restorePivotSnapshots(state.nodes, state.frames, entry.snapshots.after);
        return {
          ...restored,
          assets,
          selectedAssetId: state.selectedAssetId && assets[state.selectedAssetId] ? state.selectedAssetId : null,
          selectedAssetIds: state.selectedAssetIds.filter((id) => assets[id]),
          transformHistory: [...state.transformHistory, entry],
          redoStack: state.redoStack.slice(0, -1),
          transformSession: null,
          inspectorSession: null,
        };
      }
      if ('assetsAfter' in entry) {
        return { assets: restoreAssets(state.assets, entry.assetsAfter), transformHistory: [...state.transformHistory, entry], redoStack: state.redoStack.slice(0, -1), transformSession: null, inspectorSession: null };
      }
      if ('codexEditId' in entry) {
        return {
          ...entry.after,
          currentFrameIndex: Math.min(state.currentFrameIndex, entry.after.frames.length - 1),
          selectedFrameIds: state.selectedFrameIds.filter((id) => entry.after.frames.some((frame) => frame.id === id)),
          selectedNodeId: state.selectedNodeId && entry.after.nodes[state.selectedNodeId] ? state.selectedNodeId : null,
          transformHistory: [...state.transformHistory, entry], redoStack: state.redoStack.slice(0, -1),
          transformSession: null, inspectorSession: null, isPlaying: false, playbackGroupId: null,
        };
      }
      if ('snapshots' in entry) {
        const restored = restorePivotSnapshots(state.nodes, state.frames, entry.snapshots.after);
        return {
          ...restored,
          transformHistory: [...state.transformHistory, entry],
          redoStack: state.redoStack.slice(0, -1),
          transformSession: null,
        };
      }
      if ('frameStates' in entry) {
        if (!state.nodes[entry.nodeId]) return {};
        return {
          frames: restoreNodeFrameStates(state.frames, entry.nodeId, entry.frameStates.after, entry.frameIds),
          transformHistory: [...state.transformHistory, entry],
          redoStack: state.redoStack.slice(0, -1),
          transformSession: null,
        };
      }
      if (!state.nodes[entry.nodeId]) return {};
      return {
        frames: withFrameNodeState(state.frames, entry.frameIndex, entry.nodeId, entry.after),
        transformHistory: [...state.transformHistory, entry],
        redoStack: state.redoStack.slice(0, -1),
        transformSession: null,
      };
    }),
  createEmptyProject: () => {
    const nodes: Record<NodeId, RigNode> = {};
    set({
      assets: {},
      nodes,
      rootNodeIds: [],
      folders: ['All sprites', 'Body', 'Head', 'Hair', 'Hands', 'Legs', 'Weapons', 'Effects'],
      settings: {
        canvasSize: { x: 320, y: 240 },
        gridSize: 8,
        pixelPerfectRotation: true,
        pixelGridSize: 1,
        rotationSnapAngle: 0,
      },
      projectName: 'Untitled project',
      selectedFrameIds: [],
      frameSelectionAnchorId: null,
      inspectorSession: null,
      frames: [createFrame(nodes)],
      currentFrameIndex: 0,
      isPlaying: false,
      playbackGroupId: null,
      isLooping: true,
      onionSkinEnabled: false,
      fps: 12,
      activeTool: 'move',
      showPivot: false,
      snapEnabled: false,
      transformSession: null,
      transformHistory: [],
      redoStack: [],
      selectedNodeId: null,
      selectedAssetId: null,
      selectedAssetIds: [],
    });
  },
  createCharacterTemplateProject: () => {
    const template = buildCharacterTemplate();
    set({
      ...template,
      projectName: 'Character template',
      selectedFrameIds: [],
      frameSelectionAnchorId: null,
      inspectorSession: null,
      frames: initialFrames(template.nodes, template.frames),
      currentFrameIndex: 0,
      isPlaying: false,
      playbackGroupId: null,
      isLooping: true,
      onionSkinEnabled: false,
      fps: 12,
      activeTool: 'move',
      showPivot: false,
      snapEnabled: false,
      transformSession: null,
      transformHistory: [],
      redoStack: [],
      selectedNodeId: 'body',
      selectedAssetId: null,
      selectedAssetIds: [],
    });
  },
  loadProject: (project, name) =>
    set({
      assets: project.assets,
      nodes: project.nodes,
      rootNodeIds: project.rootNodeIds,
      folders: ['All sprites', ...Array.from(new Set(Object.values(project.assets).map((asset) => asset.folder))).filter(Boolean)],
      settings: normalizeProjectSettings(project.settings),
      frames: project.frames.length ? project.frames : [createFrame(project.nodes)],
      currentFrameIndex: 0,
      isPlaying: false,
      playbackGroupId: null,
      isLooping: project.isLooping,
      selectedFrameIds: [],
      frameSelectionAnchorId: null,
      inspectorSession: null,
      onionSkinEnabled: false,
      fps: project.fps,
      selectedNodeId: project.rootNodeIds[0] ?? null,
      selectedAssetId: null,
      selectedAssetIds: [],
      activeTool: 'move',
      transformSession: null,
      transformHistory: [],
      redoStack: [],
      projectName: name,
    }),
  setProjectName: (projectName) => set({ projectName }),
}));
