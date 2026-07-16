import { useState, type DragEvent, type MouseEvent } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import type { NodeId } from '../types/project';

type NodeRowProps = {
  id: NodeId;
  depth: number;
  draggedNodeId: NodeId | null;
  dropTargetId: NodeId | null;
  onDragStart: (event: DragEvent<HTMLDivElement>, nodeId: NodeId) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, nodeId: NodeId) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, nodeId: NodeId) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, nodeId: NodeId) => void;
  onSelect: (nodeId: NodeId) => void;
};

function NodeRow({ id, depth, draggedNodeId, dropTargetId, onDragStart, onDragEnd, onDragOver, onDrop, onContextMenu, onSelect }: NodeRowProps) {
  const node = useProjectStore((state) => state.nodes[id]);
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId);
  const toggleVisibility = useProjectStore((state) => state.toggleNodeVisibility);
  const toggleLock = useProjectStore((state) => state.toggleNodeLock);
  const deleteNode = useProjectStore((state) => state.deleteNode);

  if (!node) return null;
  return (
    <>
      <div
        className={`node-row ${selectedNodeId === id ? 'selected' : ''} ${draggedNodeId === id ? 'dragging' : ''} ${dropTargetId === id ? 'drop-target' : ''}`}
        draggable
        style={{ paddingLeft: 10 + depth * 16 }}
        onDragStart={(event) => onDragStart(event, id)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOver(event, id)}
        onDrop={(event) => onDrop(event, id)}
        onContextMenu={(event) => onContextMenu(event, id)}
      >
        <button className="node-main" type="button" onClick={() => onSelect(id)}>
          <span className={`node-chevron ${node.children.length ? '' : 'blank'}`}><Icon name="chevron" size={12} /></span>
          <span className="node-swatch" />
          <span>{node.name}</span>
        </button>
        <span className="node-actions">
          <button type="button" title={node.visible ? 'Hide node' : 'Show node'} onClick={() => toggleVisibility(id)}><Icon name={node.visible ? 'eye' : 'eyeOff'} size={14} /></button>
          <button type="button" title={node.locked ? 'Unlock node' : 'Lock node'} onClick={() => toggleLock(id)}><Icon name={node.locked ? 'lock' : 'unlock'} size={14} /></button>
          <button type="button" className="delete-node-action" title="Delete node" onClick={() => { if (window.confirm(`Delete ${node.name} and all child nodes?`)) deleteNode(id); }}><Icon name="trash" size={14} /></button>
        </span>
      </div>
      {node.children.map((child) => <NodeRow key={child} id={child} depth={depth + 1} draggedNodeId={draggedNodeId} dropTargetId={dropTargetId} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop} onContextMenu={onContextMenu} onSelect={onSelect} />)}
    </>
  );
}

export function NodeHierarchy() {
  const rootNodeIds = useProjectStore((state) => state.rootNodeIds);
  const selectNode = useProjectStore((state) => state.selectNode);
  const reparentNode = useProjectStore((state) => state.reparentNode);
  const addChildNode = useProjectStore((state) => state.addChildNode);
  const [draggedNodeId, setDraggedNodeId] = useState<NodeId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<NodeId | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: NodeId; x: number; y: number } | null>(null);

  const clearDrag = () => {
    setDraggedNodeId(null);
    setDropTargetId(null);
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, nodeId: NodeId) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', nodeId);
    setDraggedNodeId(nodeId);
    setContextMenu(null);
  };

  const handleNodeDragOver = (event: DragEvent<HTMLDivElement>, nodeId: NodeId) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedNodeId && draggedNodeId !== nodeId) {
      event.dataTransfer.dropEffect = 'move';
      setDropTargetId(nodeId);
    }
  };

  const handleNodeDrop = (event: DragEvent<HTMLDivElement>, parentId: NodeId) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedNodeId && draggedNodeId !== parentId) reparentNode(draggedNodeId, parentId);
    clearDrag();
  };

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (draggedNodeId) reparentNode(draggedNodeId, null);
    clearDrag();
  };

  return (
    <section className="panel hierarchy-panel" onClick={() => setContextMenu(null)}>
      <div className="panel-heading">
        <span><Icon name="layers" /> Node hierarchy</span>
        <span className="subtle-count">{rootNodeIds.length} root</span>
      </div>
      <div className={`tree-root ${draggedNodeId && !dropTargetId ? 'root-drop-target' : ''}`} onDragOver={(event) => { event.preventDefault(); setDropTargetId(null); }} onDrop={handleRootDrop}>
        {rootNodeIds.map((id) => <NodeRow key={id} id={id} depth={0} draggedNodeId={draggedNodeId} dropTargetId={dropTargetId} onDragStart={handleDragStart} onDragEnd={clearDrag} onDragOver={handleNodeDragOver} onDrop={handleNodeDrop} onContextMenu={(event, nodeId) => { event.preventDefault(); setContextMenu({ nodeId, x: event.clientX, y: event.clientY }); }} onSelect={(nodeId) => { setContextMenu(null); selectNode(nodeId); }} />)}
        <div className="root-drop-zone">Drag here to place at root level</div>
      </div>
      <p className="panel-hint">Drag onto a node to make it a child. Right-click a node to add a child.</p>
      {contextMenu && (
        <div className="hierarchy-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { addChildNode(contextMenu.nodeId); setContextMenu(null); }}><Icon name="plus" size={14} /> Add child node</button>
        </div>
      )}
    </section>
  );
}
