import { Icon } from './Icon';
import { useProjectStore } from '../state/projectStore';
import type { RotationSnapAngle, TransformTool } from '../types/project';
import type { RecentProject } from '../project/recentProjects';

interface ToolbarProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onOpenRecent: (recent: RecentProject) => void;
  onExport: () => void;
  projectName: string;
  recentProjects: RecentProject[];
  showGrid: boolean;
  onToggleGrid: () => void;
  workspaceMode: 'nodes' | 'canvas';
  onWorkspaceModeChange: (mode: 'nodes' | 'canvas') => void;
}

export function Toolbar({ onNewProject, onOpenProject, onSaveProject, onOpenRecent, onExport, projectName, recentProjects, showGrid, onToggleGrid, workspaceMode, onWorkspaceModeChange }: ToolbarProps) {
  const activeTool = useProjectStore((state) => state.activeTool);
  const showPivot = useProjectStore((state) => state.showPivot);
  const snapEnabled = useProjectStore((state) => state.snapEnabled);
  const pixelPerfectRotation = useProjectStore((state) => state.settings.pixelPerfectRotation);
  const pixelGridSize = useProjectStore((state) => state.settings.pixelGridSize);
  const rotationSnapAngle = useProjectStore((state) => state.settings.rotationSnapAngle);
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId);
  const setActiveTool = useProjectStore((state) => state.setActiveTool);
  const toggleShowPivot = useProjectStore((state) => state.toggleShowPivot);
  const toggleSnap = useProjectStore((state) => state.toggleSnap);
  const togglePixelPerfectRotation = useProjectStore((state) => state.togglePixelPerfectRotation);
  const setPixelGridSize = useProjectStore((state) => state.setPixelGridSize);
  const setRotationSnapAngle = useProjectStore((state) => state.setRotationSnapAngle);
  const flipNode = useProjectStore((state) => state.flipNode);
  const resetNodeTransform = useProjectStore((state) => state.resetNodeTransform);
  const transformTools: { tool: TransformTool; label: string; icon: 'cursor' | 'move' | 'rotate' | 'scale' | 'target' }[] = [
    { tool: 'select', label: 'Select (V)', icon: 'cursor' },
    { tool: 'move', label: 'Move (W)', icon: 'move' },
    { tool: 'rotate', label: 'Rotate (R)', icon: 'rotate' },
    { tool: 'scale', label: 'Scale (S)', icon: 'scale' },
    { tool: 'pivot', label: 'Set pivot (P)', icon: 'target' },
  ];

  return (
    <header className="toolbar">
      <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
      <div className="brand">Pixel Rig <strong>Studio</strong></div>
      <div className="toolbar-divider" />
      <div className="workspace-mode-switch" aria-label="Workspace mode">
        <button className={workspaceMode === 'nodes' ? 'active' : ''} type="button" onClick={() => onWorkspaceModeChange('nodes')}><Icon name="layers" /> Nodes</button>
        <button className={workspaceMode === 'canvas' ? 'active' : ''} type="button" onClick={() => onWorkspaceModeChange('canvas')}><Icon name="pixel" /> Canvas</button>
      </div>
      <div className="toolbar-divider" />
      {workspaceMode === 'nodes' && <>
      <div className="transform-tools" aria-label="Transform tools">
        {transformTools.map(({ tool, label, icon }) => (
          <button key={tool} type="button" className={`compact-tool ${activeTool === tool ? 'active' : ''}`} title={label} aria-pressed={activeTool === tool} onClick={() => setActiveTool(tool)}>
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <div className="toolbar-divider" />
      <button className={`compact-tool ${showPivot ? 'active' : ''}`} type="button" title="Show selected pivot" aria-pressed={showPivot} onClick={toggleShowPivot}><Icon name="target" /></button>
      <button className={`compact-tool ${snapEnabled ? 'active' : ''}`} type="button" title="Snap to grid" aria-pressed={snapEnabled} onClick={toggleSnap}><Icon name="magnet" /></button>
      <div className="render-controls" aria-label="Pixel rotation rendering">
        <button className={`compact-tool pixel-rotation-toggle ${pixelPerfectRotation ? 'active' : ''}`} type="button" title={`Pixel-perfect rotation: ${pixelPerfectRotation ? 'On' : 'Off'}`} aria-label="Pixel-perfect rotation" aria-pressed={pixelPerfectRotation} onClick={togglePixelPerfectRotation}><Icon name="pixel" /><span>PP {pixelPerfectRotation ? 'On' : 'Off'}</span></button>
        <select className="render-setting-select" aria-label="Snap rotation angle" title="Snap rotation angle" value={rotationSnapAngle} onChange={(event) => setRotationSnapAngle(Number(event.target.value) as RotationSnapAngle)}>
          <option value={0}>Snap: Off</option>
          <option value={1}>Snap: 1 deg</option>
          <option value={5}>Snap: 5 deg</option>
          <option value={15}>Snap: 15 deg</option>
          <option value={45}>Snap: 45 deg</option>
        </select>
        <select className="render-setting-select pixel-grid-select" aria-label="Pixel grid size" title="Pixel grid size" value={pixelGridSize} onChange={(event) => setPixelGridSize(Number(event.target.value))}>
          <option value={1}>Grid: 1px</option>
          <option value={2}>Grid: 2px</option>
          <option value={4}>Grid: 4px</option>
          <option value={8}>Grid: 8px</option>
        </select>
      </div>
      <button className="compact-tool" type="button" title="Flip horizontally" disabled={!selectedNodeId} onClick={() => selectedNodeId && flipNode(selectedNodeId, 'horizontal')}><Icon name="flipHorizontal" /></button>
      <button className="compact-tool" type="button" title="Flip vertically" disabled={!selectedNodeId} onClick={() => selectedNodeId && flipNode(selectedNodeId, 'vertical')}><Icon name="flipVertical" /></button>
      <button className="compact-tool" type="button" title="Reset transform" disabled={!selectedNodeId} onClick={() => selectedNodeId && resetNodeTransform(selectedNodeId)}><Icon name="reset" /></button>
      <div className="toolbar-divider" />
      </>}
      <div className="project-name">{projectName} <span>•</span> Studio</div>
      <button className="file-tool" type="button" onClick={onNewProject}><Icon name="plus" /> New</button>
      <button className="file-tool" type="button" onClick={onOpenProject}><Icon name="import" /> Open</button>
      <button className="file-tool" type="button" onClick={onSaveProject}><Icon name="download" /> Save</button>
      <select className="recent-projects" aria-label="Recent projects" value="" onChange={(event) => { const recent = recentProjects.find((item) => item.id === event.target.value); if (recent) onOpenRecent(recent); }}>
        <option value="">Recent</option>
        {recentProjects.map((recent) => <option key={recent.id} value={recent.id}>{recent.name} — {recent.path ?? 'Saved project snapshot'}</option>)}
      </select>
      <div className="toolbar-spacer" />
      {workspaceMode === 'nodes' && <button className="tool-button" type="button" onClick={onToggleGrid} aria-pressed={showGrid}>
        <Icon name="grid" /> Grid
      </button>}
      <button className="tool-button" type="button" onClick={onExport}>
        <Icon name="download" /> Export
      </button>
    </header>
  );
}
