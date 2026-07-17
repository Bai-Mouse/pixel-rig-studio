export interface PixelLinearTransform {
  a: number;
  b: number;
  c: number;
  d: number;
}

export const DEFAULT_PIXEL_ALPHA_THRESHOLD = 8;

export type PixelRotationOptions = {
  angleRadians: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
  pixelGridSize: number;
  alphaThreshold: number;
  fillSinglePixelGaps: boolean;
  /** Use this for a composed parent/world transform, including shear. */
  linearTransform?: PixelLinearTransform;
};

export type RasterizedSprite = {
  canvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

interface SourcePixels {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

const imagePixelCache = new WeakMap<HTMLImageElement, SourcePixels>();

export function snapToGrid(value: number, gridSize: number): number {
  const safeGridSize = Math.max(1, Math.round(gridSize));
  return Math.round(value / safeGridSize) * safeGridSize;
}

function sourceSize(source: HTMLImageElement | HTMLCanvasElement) {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  return { width: source.width, height: source.height };
}

function readSourcePixels(source: HTMLImageElement | HTMLCanvasElement) {
  if (source instanceof HTMLImageElement) {
    const cached = imagePixelCache.get(source);
    if (cached) return cached;
  }
  const { width, height } = sourceSize(source);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create a source pixel buffer.');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const result = { width, height, pixels: context.getImageData(0, 0, width, height).data };
  if (source instanceof HTMLImageElement) imagePixelCache.set(source, result);
  return result;
}

function transformsFor(options: PixelRotationOptions): PixelLinearTransform {
  if (options.linearTransform) return options.linearTransform;
  const cosine = Math.cos(options.angleRadians);
  const sine = Math.sin(options.angleRadians);
  return {
    a: cosine * options.scaleX,
    b: sine * options.scaleX,
    c: -sine * options.scaleY,
    d: cosine * options.scaleY,
  };
}

function pixelsMatch(data: Uint8ClampedArray, first: number, second: number) {
  return data[first] === data[second]
    && data[first + 1] === data[second + 1]
    && data[first + 2] === data[second + 2]
    && data[first + 3] === data[second + 3];
}

function fillConservativeDiagonalGaps(data: Uint8ClampedArray, width: number, height: number, alphaThreshold: number) {
  if (width < 3 || height < 3) return;
  const original = new Uint8ClampedArray(data);
  const indexAt = (x: number, y: number) => (y * width + x) * 4;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = indexAt(x, y);
      if (original[center + 3] >= alphaThreshold) continue;
      const northWest = indexAt(x - 1, y - 1);
      const southEast = indexAt(x + 1, y + 1);
      const northEast = indexAt(x + 1, y - 1);
      const southWest = indexAt(x - 1, y + 1);
      const firstDiagonalMatches = original[northWest + 3] >= alphaThreshold
        && original[southEast + 3] >= alphaThreshold
        && pixelsMatch(original, northWest, southEast);
      const secondDiagonalMatches = original[northEast + 3] >= alphaThreshold
        && original[southWest + 3] >= alphaThreshold
        && pixelsMatch(original, northEast, southWest);
      if (firstDiagonalMatches === secondDiagonalMatches) continue;
      const sourceIndex = firstDiagonalMatches ? northWest : northEast;
      data[center] = original[sourceIndex];
      data[center + 1] = original[sourceIndex + 1];
      data[center + 2] = original[sourceIndex + 2];
      data[center + 3] = original[sourceIndex + 3];
    }
  }
}

/**
 * Rasterizes in sprite/world pixel space. Every destination pixel center is
 * inverse-mapped to exactly one source pixel; the camera transform is not part
 * of this operation.
 */
export function rasterizeRotatedSprite(
  source: HTMLImageElement | HTMLCanvasElement,
  options: PixelRotationOptions,
): RasterizedSprite {
  const sourcePixels = readSourcePixels(source);
  const transform = transformsFor(options);
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (Math.abs(determinant) < 0.000001) throw new Error('Cannot rasterize a zero-scale sprite.');

  const transformCorner = (sourceX: number, sourceY: number) => ({
    x: transform.a * (sourceX - options.pivotX) + transform.c * (sourceY - options.pivotY),
    y: transform.b * (sourceX - options.pivotX) + transform.d * (sourceY - options.pivotY),
  });
  const corners = [
    transformCorner(0, 0),
    transformCorner(sourcePixels.width, 0),
    transformCorner(0, sourcePixels.height),
    transformCorner(sourcePixels.width, sourcePixels.height),
  ];
  const gridSize = Math.max(1, Math.round(options.pixelGridSize));
  const left = Math.floor(Math.min(...corners.map((point) => point.x)) / gridSize) * gridSize;
  const top = Math.floor(Math.min(...corners.map((point) => point.y)) / gridSize) * gridSize;
  const right = Math.ceil(Math.max(...corners.map((point) => point.x)) / gridSize) * gridSize;
  const bottom = Math.ceil(Math.max(...corners.map((point) => point.y)) / gridSize) * gridSize;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new Error('Sprite scale is too large to rasterize safely.');
  }
  const output = new ImageData(width, height);
  const inverseA = transform.d / determinant;
  const inverseB = -transform.b / determinant;
  const inverseC = -transform.c / determinant;
  const inverseD = transform.a / determinant;
  const alphaThreshold = Math.max(0, Math.min(255, Math.round(options.alphaThreshold)));

  for (let destinationY = 0; destinationY < height; destinationY += 1) {
    const worldY = top + destinationY + 0.5;
    for (let destinationX = 0; destinationX < width; destinationX += 1) {
      const worldX = left + destinationX + 0.5;
      const sourceX = inverseA * worldX + inverseC * worldY + options.pivotX;
      const sourceY = inverseB * worldX + inverseD * worldY + options.pivotY;
      const sampleX = Math.floor(sourceX);
      const sampleY = Math.floor(sourceY);
      if (sampleX < 0 || sampleX >= sourcePixels.width || sampleY < 0 || sampleY >= sourcePixels.height) continue;
      const sourceIndex = (sampleY * sourcePixels.width + sampleX) * 4;
      if (sourcePixels.pixels[sourceIndex + 3] < alphaThreshold) continue;
      const destinationIndex = (destinationY * width + destinationX) * 4;
      output.data[destinationIndex] = sourcePixels.pixels[sourceIndex];
      output.data[destinationIndex + 1] = sourcePixels.pixels[sourceIndex + 1];
      output.data[destinationIndex + 2] = sourcePixels.pixels[sourceIndex + 2];
      output.data[destinationIndex + 3] = sourcePixels.pixels[sourceIndex + 3];
    }
  }

  if (options.fillSinglePixelGaps) fillConservativeDiagonalGaps(output.data, width, height, Math.max(1, alphaThreshold));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a rasterized sprite canvas.');
  context.imageSmoothingEnabled = false;
  context.putImageData(output, 0, 0);
  return { canvas, offsetX: left, offsetY: top, width, height };
}
