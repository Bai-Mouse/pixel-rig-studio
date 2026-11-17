# Pixel Rig Studio

A Tauri-ready React desktop workspace for building modular pixel-art characters from reusable sprite nodes.

## Current scope: Complete desktop workflow

- Three-panel desktop workspace (node hierarchy, canvas, properties)
- HTML Canvas renderer with inherited node transforms and no image smoothing
- A character template whose rig, pivots and first-frame pose come from the 知更鸟 project, textured by the bundled `Character Sheet.png`
- A template setup dialog: import a sheet, map each part region, nudge node positions in the preview, then create the project
- PNG import by file picker or drag and drop
- Optional sprite-sheet slicing at import, plus safe sprite deletion
- Image-library selection and adding a sprite as a new canvas node
- Per-sprite anchors (X/Y, centre, or follow the node pivot) that stay aligned to the same source pixel while cropping
- Crisp grid, zoom, and Space-drag panning
- Bottom timeline with frame selection, insert, duplicate, drag reordering, in-between frames, frame groups (create, join an existing group, or remove individual frames), and single or multi-frame delete controls
- Animation import into the selected frame: replace the timeline, apply the file's frame-to-frame pose deltas, insert at the offset, or overwrite from it
- Play/pause, loop, adjustable FPS, and onion-skin preview
- Per-frame node transform snapshots, ready for Phase 3 transform editing
- Move, rotate, scale, pivot, flip, reset, snapping, and transform undo/redo, with node position indicators while moving
- One shared undo/redo history: frame edits (insert, duplicate, delete, move, in-between, grouping, templates, animation import) undo and redo alongside pose edits
- Built-in pixel editor with drawing tools, layers, palette, grid, symmetry, and live PNG updates
- Project and animation JSON downloads, PNG sprite sheets, individual PNG frames, a current-frame PNG, GIF, and APNG export of any frame range or group

All five planned phases, project workflow, and native Tauri packaging are implemented.

## Run locally

Install Node.js with a working npm installation, then run:

```powershell
npm install
npm run dev
```

For Tauri development, install the Rust toolchain and the Windows C++ Build Tools, then run `npm run tauri dev`.

## Project workflow and Windows build

- **Open** restores a `.pixelrig.json` project from disk.
- **Save** downloads the complete project file and records it in the recent-project list when browser storage permits.
- **Export** includes the animation formats and project JSON download.

Create a Windows installer with:

```powershell
npm run tauri -- build --bundles nsis
```
