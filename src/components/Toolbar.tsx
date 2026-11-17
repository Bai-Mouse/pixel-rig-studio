import { Icon } from './Icon';
import { useEffect, useRef } from 'react';
import { useProjectStore } from '../state/projectStore';
import type { RotationSnapAngle, TransformTool } from '../types/project';
import type { RecentProject } from '../project/recentProjects';

interface ToolbarProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onCopyProject: () => void;
  onOpenRecent: (recent: RecentProject) => void;
  onExport: () => void;
  onCodex: () => void;
  projectName: string;
  recentProjects: RecentProject[];
  showGrid: boolean;
  onToggleGrid: () => void;
  workspaceMode: 'nodes' | 'canvas';
  onWorkspaceModeChange: (mode: 'nodes' | 'canvas') => void;
}

export function Toolbar({ onNewProject, onOpenProject, onSaveProject, onCopyProject, onOpenRecent, onExport, onCodex, projectName, recentProjects, showGrid, onToggleGrid, workspaceMode, onWorkspaceModeChange }: ToolbarProps) {
  const toolbarRef = useRef<HTMLElement>(null);
  const closeMenus = () => toolbarRef.current?.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'));
  const run = (action: () => void) => { closeMenus(); action(); };
  useEffect(() => {
    const outside = (event: Event) => toolbarRef.current?.querySelectorAll('details[open]').forEach((menu) => { if (!menu.contains(event.target as Node)) menu.removeAttribute('open'); });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenus(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
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
    <header className="toolbar" ref={toolbarRef}>
      <div className="toolbar-main-row">
      <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
      <div className="brand">Pixel Rig <strong>Studio</strong></div>
      <details className="toolbar-menu"><summary>Project ▾</summary><div className="toolbar-menu-content">
        <button type="button" onClick={() => run(onNewProject)}><Icon name="plus" /> New project</button>
        <button type="button" onClick={() => run(onOpenProject)}><Icon name="import" /> Open project…</button>
        <button type="button" onClick={() => run(onCopyProject)}><Icon name="copy" /> Make project copy</button>
        <label>Recent projects<select aria-label="Recent projects" value="" onChange={(event) => { const recent = recentProjects.find((item) => item.id === event.target.value); if (recent) run(() => onOpenRecent(recent)); }}><option value="">Choose a project…</option>{recentProjects.map((recent) => <option key={recent.id} value={recent.id}>{recent.name} — {recent.path ?? 'Saved snapshot'}</option>)}</select></label>
      </div></details>
      <div className="project-name" title={projectName}>{projectName}</div>
      <div className="workspace-mode-switch" aria-label="Workspace mode">
        <button className={workspaceMode === 'nodes' ? 'active' : ''} type="button" onClick={() => onWorkspaceModeChange('nodes')}><Icon name="layers" /> Nodes</button>
        <button className={workspaceMode === 'canvas' ? 'active' : ''} type="button" onClick={() => onWorkspaceModeChange('canvas')}><Icon name="pixel" /> Canvas</button>
      </div>
      <button className="tool-button" type="button" onClick={onSaveProject}><Icon name="download" /> Save</button>
      <button className="tool-button" type="button" onClick={onExport}><Icon name="image" /> Export</button>
      <button className="tool-button codex-toolbar-button" type="button" onClick={onCodex}>AI 助手</button>
      </div>
      <div className="toolbar-edit-row">
      {workspaceMode === 'nodes' && <>
      <span className="toolbar-group-label">Tools</span>
      <div className="transform-tools" aria-label="Transform tools">
        {transformTools.map(({ tool, label, icon }) => (
          <button key={tool} type="button" className={`compact-tool ${activeTool === tool ? 'active' : ''}`} title={label} aria-pressed={activeTool === tool} onClick={() => setActiveTool(tool)}>
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <div className="toolbar-divider" />
      <details className="toolbar-menu"><summary>Transform ▾</summary><div className="toolbar-menu-content">
        <button type="button" disabled={!selectedNodeId} onClick={() => run(() => selectedNodeId && flipNode(selectedNodeId, 'horizontal'))}><Icon name="flipHorizontal" /> Flip horizontally</button>
        <button type="button" disabled={!selectedNodeId} onClick={() => run(() => selectedNodeId && flipNode(selectedNodeId, 'vertical'))}><Icon name="flipVertical" /> Flip vertically</button>
        <button type="button" disabled={!selectedNodeId} onClick={() => run(() => selectedNodeId && resetNodeTransform(selectedNodeId))}><Icon name="reset" /> Reset transform</button>
      </div></details>
      <details className="toolbar-menu"><summary>View ▾</summary><div className="toolbar-menu-content">
        <button type="button" aria-pressed={showGrid} onClick={onToggleGrid}><Icon name="grid" /> Grid {showGrid ? '✓' : ''}</button>
        <button type="button" aria-pressed={showPivot} onClick={toggleShowPivot}><Icon name="target" /> Show pivot {showPivot ? '✓' : ''}</button>
        <button type="button" aria-pressed={snapEnabled} onClick={toggleSnap}><Icon name="magnet" /> Snap to grid {snapEnabled ? '✓' : ''}</button>
      </div></details>
      <div className="toolbar-spacer" />
      <span className="toolbar-group-label">Pixel rendering</span>
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
      </>}
      {workspaceMode === 'canvas' && <span className="toolbar-group-label">Frame drawing · Drawing tools are above the canvas · Ctrl+Z undo / Ctrl+Y redo</span>}
      </div>
    </header>
  );
}
