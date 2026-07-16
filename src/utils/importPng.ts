import type { SpriteAsset, SpriteSlice, SpriteSource } from '../types/project';

export interface SpriteImportCandidate {
  name: string;
  src: string;
  width: number;
  height: number;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function dimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('The image could not be decoded.'));
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = src;
  });
}

export async function filesToImportCandidates(files: File[]): Promise<SpriteImportCandidate[]> {
  const pngFiles = files.filter((file) => file.type === 'image/png' || file.name.toLowerCase().endsWith('.png'));
  return Promise.all(
    pngFiles.map(async (file) => {
      const src = await readAsDataUrl(file);
      const { width, height } = await dimensions(src);
      return { name: file.name, src, width, height };
    }),
  );
}

function bareName(name: string) {
  return name.replace(/\.png$/i, '') || 'sprite';
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be decoded.'));
    image.src = source;
  });
}

function sourceFor(candidate: SpriteImportCandidate): SpriteSource {
  return {
    id: `source-${crypto.randomUUID()}`,
    name: candidate.name,
    src: candidate.src,
    width: candidate.width,
    height: candidate.height,
  };
}

function encodeMask(mask: Uint8Array) {
  let binary = '';
  mask.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function maskFromSlice(slice: SpriteSlice) {
  if (!slice.mask) return null;
  const binary = atob(slice.mask);
  if (binary.length !== slice.width * slice.height) throw new Error('The saved auto-slice mask is invalid.');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cropImage(image: HTMLImageElement, slice: SpriteSlice): string {
  const canvas = document.createElement('canvas');
  canvas.width = slice.width;
  canvas.height = slice.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not slice this sprite sheet.');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, slice.x, slice.y, slice.width, slice.height, 0, 0, slice.width, slice.height);
  const mask = maskFromSlice(slice);
  if (mask) {
    const pixels = context.getImageData(0, 0, slice.width, slice.height);
    mask.forEach((visible, index) => { if (!visible) pixels.data[index * 4 + 3] = 0; });
    context.putImageData(pixels, 0, 0);
  }
  return canvas.toDataURL('image/png');
}

export async function createAssetsFromSlices(candidate: SpriteImportCandidate, slices: SpriteSlice[]): Promise<SpriteAsset[]> {
  const validSlices = slices.filter((slice) => Number.isInteger(slice.x)
    && Number.isInteger(slice.y)
    && Number.isInteger(slice.width)
    && Number.isInteger(slice.height)
    && slice.width > 0
    && slice.height > 0
    && slice.x >= 0
    && slice.y >= 0
    && slice.x + slice.width <= candidate.width
    && slice.y + slice.height <= candidate.height);
  if (!validSlices.length) throw new Error('Draw or keep at least one valid sprite region.');
  const source = sourceFor(candidate);
  if (validSlices.length === 1 && validSlices[0].x === 0 && validSlices[0].y === 0 && validSlices[0].width === candidate.width && validSlices[0].height === candidate.height) {
    return [{
      id: `asset-${crypto.randomUUID()}`,
      name: candidate.name,
      folder: 'Unsorted',
      src: candidate.src,
      width: candidate.width,
      height: candidate.height,
      source,
      slice: validSlices[0],
    }];
  }
  const image = await loadImage(candidate.src);
  return validSlices.map((slice, index) => ({
    id: `asset-${crypto.randomUUID()}`,
    name: `${bareName(candidate.name)}_part_${String(index + 1).padStart(2, '0')}.png`,
    folder: 'Unsorted',
    src: cropImage(image, slice),
    width: slice.width,
    height: slice.height,
    source,
    slice,
  }));
}

export async function createAssetsFromCandidate(candidate: SpriteImportCandidate, tileWidth = candidate.width, tileHeight = candidate.height): Promise<SpriteAsset[]> {
  if (!Number.isInteger(tileWidth) || !Number.isInteger(tileHeight) || tileWidth < 1 || tileHeight < 1) throw new Error('Tile dimensions must be whole positive pixels.');
  const columns = Math.floor(candidate.width / tileWidth);
  const rows = Math.floor(candidate.height / tileHeight);
  if (!columns || !rows) throw new Error('Tile dimensions are larger than the imported image.');
  const slices: SpriteSlice[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slices.push({ x: column * tileWidth, y: row * tileHeight, width: tileWidth, height: tileHeight });
    }
  }
  return createAssetsFromSlices(candidate, slices);
}

export async function detectSpriteParts(candidate: SpriteImportCandidate): Promise<SpriteSlice[]> {
  const image = await loadImage(candidate.src);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = candidate.width;
  sourceCanvas.height = candidate.height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Your browser could not inspect this sprite sheet.');
  sourceContext.imageSmoothingEnabled = false;
  sourceContext.drawImage(image, 0, 0, candidate.width, candidate.height);
  const sourcePixels = sourceContext.getImageData(0, 0, candidate.width, candidate.height).data;
  const visited = new Uint8Array(candidate.width * candidate.height);
  const components: Array<{ pixels: number[]; minX: number; maxX: number; minY: number; maxY: number }> = [];

  for (let startY = 0; startY < candidate.height; startY += 1) {
    for (let startX = 0; startX < candidate.width; startX += 1) {
      const start = startY * candidate.width + startX;
      if (visited[start] || sourcePixels[start * 4 + 3] === 0) continue;
      visited[start] = 1;
      const stack = [start];
      const pixels: number[] = [];
      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;
      while (stack.length) {
        const point = stack.pop()!;
        const x = point % candidate.width;
        const y = Math.floor(point / candidate.width);
        pixels.push(point);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        const neighbours = [point - 1, point + 1, point - candidate.width, point + candidate.width];
        neighbours.forEach((next) => {
          if (next < 0 || next >= visited.length || visited[next]) return;
          const nextX = next % candidate.width;
          if (Math.abs(nextX - x) > 1) return;
          if (sourcePixels[next * 4 + 3] === 0) return;
          visited[next] = 1;
          stack.push(next);
        });
      }
      components.push({ pixels, minX, maxX, minY, maxY });
    }
  }
  if (!components.length) throw new Error('No visible sprite parts were found in this PNG.');
  components.sort((left, right) => left.minY - right.minY || left.minX - right.minX);
  return components.map((component) => {
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    const mask = new Uint8Array(width * height);
    component.pixels.forEach((point) => {
      const x = point % candidate.width;
      const y = Math.floor(point / candidate.width);
      mask[(y - component.minY) * width + x - component.minX] = 1;
    });
    const slice = { x: component.minX, y: component.minY, width, height, mask: encodeMask(mask) };
    return slice;
  });
}

export async function createAssetsFromDetectedParts(candidate: SpriteImportCandidate): Promise<SpriteAsset[]> {
  return createAssetsFromSlices(candidate, await detectSpriteParts(candidate));
}

/** Re-renders every slice belonging to one imported PNG while preserving asset and node IDs. */
export async function replaceAssetsFromSource(assets: SpriteAsset[], sourceId: string, candidate: SpriteImportCandidate): Promise<SpriteAsset[]> {
  const related = assets.filter((asset) => asset.source?.id === sourceId && asset.slice);
  if (!related.length) throw new Error('This sprite has no replaceable source image.');
  const incompatible = related.find((asset) => !asset.slice || asset.slice.x + asset.slice.width > candidate.width || asset.slice.y + asset.slice.height > candidate.height);
  if (incompatible) throw new Error(`The replacement PNG is too small for the saved slice layout (${incompatible.slice!.x + incompatible.slice!.width} x ${incompatible.slice!.y + incompatible.slice!.height} px required).`);
  const image = await loadImage(candidate.src);
  return related.map((asset) => ({
    ...asset,
    src: cropImage(image, asset.slice!),
    source: { id: sourceId, name: candidate.name, src: candidate.src, width: candidate.width, height: candidate.height },
  }));
}

export async function filesToAssets(files: File[]): Promise<SpriteAsset[]> {
  const candidates = await filesToImportCandidates(files);
  const assets = await Promise.all(candidates.map((candidate) => createAssetsFromCandidate(candidate)));
  return assets.flat();
}
