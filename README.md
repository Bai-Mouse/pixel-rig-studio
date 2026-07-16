# Pixel Rig Studio

A Tauri-ready React desktop workspace for building modular pixel-art characters from reusable sprite nodes.

## Current scope: Complete desktop workflow

- Three-panel desktop workspace (node hierarchy, canvas, properties)
- HTML Canvas renderer with inherited node transforms and no image smoothing
- Sample character rig to demonstrate hierarchy inheritance
- PNG import by file picker or drag and drop
- Optional sprite-sheet slicing at import, plus safe sprite deletion
- Image-library selection and adding a sprite as a new canvas node
- Crisp grid, zoom, and Space-drag panning
- Bottom timeline with frame selection, insert, duplicate, and delete controls
- Play/pause, loop, adjustable FPS, and onion-skin preview
- Per-frame node transform snapshots, ready for Phase 3 transform editing
- Move, rotate, scale, pivot, flip, reset, snapping, and transform undo/redo
- Built-in pixel editor with drawing tools, layers, palette, grid, symmetry, and live PNG updates
- Project and animation JSON downloads, PNG sprite sheets, individual PNG frames, GIF, and APNG export

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
