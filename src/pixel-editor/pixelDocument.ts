import type { SpriteAsset } from '../types/project';

export type PixelTool = 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'rectangle' | 'line';

export interface PixelLayer {
  id: string;
  name: string;
  visible: boolean;
  pixels: Uint8ClampedArray;
}

export interface PixelDocument {
  width: number;
  height: number;
  layers: PixelLayer[];
}

export type Rgba = [number, number, number, number];

export function clonePixelDocument(document: PixelDocument): PixelDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => ({ ...layer, pixels: new Uint8ClampedArray(layer.pixels) })),
  };
}

export async function createPixelDocument(asset: SpriteAsset): Promise<PixelDocument> {
  const image = new Image();
  image.src = asset.src;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = asset.width;
  canvas.height = asset.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Your browser cannot create a pixel canvas.');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, asset.width, asset.height);
  return {
    width: asset.width,
    height: asset.height,
    layers: [{ id: crypto.randomUUID(), name: 'Layer 1', visible: true, pixels: context.getImageData(0, 0, asset.width, asset.height).data }],
  };
}

export function compositeDocument(document: PixelDocument): Uint8ClampedArray {
  const output = new Uint8ClampedArray(document.width * document.height * 4);
  document.layers.forEach((layer) => {
    if (!layer.visible) return;
    for (let index = 0; index < output.length; index += 4) {
      const sourceAlpha = layer.pixels[index + 3] / 255;
      if (!sourceAlpha) continue;
      const destinationAlpha = output[index + 3] / 255;
      const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      output[index] = Math.round((layer.pixels[index] * sourceAlpha + output[index] * destinationAlpha * (1 - sourceAlpha)) / alpha);
      output[index + 1] = Math.round((layer.pixels[index + 1] * sourceAlpha + output[index + 1] * destinationAlpha * (1 - sourceAlpha)) / alpha);
      output[index + 2] = Math.round((layer.pixels[index + 2] * sourceAlpha + output[index + 2] * destinationAlpha * (1 - sourceAlpha)) / alpha);
      output[index + 3] = Math.round(alpha * 255);
    }
  });
  return output;
}

export function toPngDataUrl(pixelDocument: PixelDocument): string {
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = pixelDocument.width;
  canvas.height = pixelDocument.height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.putImageData(new ImageData(new Uint8ClampedArray(compositeDocument(pixelDocument)), pixelDocument.width, pixelDocument.height), 0, 0);
  return canvas.toDataURL('image/png');
}

export function hexToRgba(hex: string): Rgba {
  const normalized = hex.replace('#', '');
  const safe = normalized.length === 3 ? normalized.split('').map((value) => value + value).join('') : normalized.padEnd(6, '0');
  return [Number.parseInt(safe.slice(0, 2), 16), Number.parseInt(safe.slice(2, 4), 16), Number.parseInt(safe.slice(4, 6), 16), 255];
}

export function rgbaToHex([red, green, blue]: Rgba): string {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function offset(document: PixelDocument, x: number, y: number) {
  return (y * document.width + x) * 4;
}

export function setPixel(document: PixelDocument, layerId: string, x: number, y: number, color: Rgba, symmetry = false) {
  const layer = document.layers.find((item) => item.id === layerId);
  if (!layer || x < 0 || y < 0 || x >= document.width || y >= document.height) return;
  const write = (pointX: number) => {
    const index = offset(document, pointX, y);
    layer.pixels.set(color, index);
  };
  write(x);
  if (symmetry && document.width - 1 - x !== x) write(document.width - 1 - x);
}

export function drawLine(document: PixelDocument, layerId: string, startX: number, startY: number, endX: number, endY: number, color: Rgba, symmetry = false) {
  let x = startX;
  let y = startY;
  const deltaX = Math.abs(endX - startX);
  const deltaY = -Math.abs(endY - startY);
  const stepX = startX < endX ? 1 : -1;
  const stepY = startY < endY ? 1 : -1;
  let error = deltaX + deltaY;
  while (true) {
    setPixel(document, layerId, x, y, color, symmetry);
    if (x === endX && y === endY) break;
    const twiceError = 2 * error;
    if (twiceError >= deltaY) { error += deltaY; x += stepX; }
    if (twiceError <= deltaX) { error += deltaX; y += stepY; }
  }
}

export function drawRectangle(document: PixelDocument, layerId: string, startX: number, startY: number, endX: number, endY: number, color: Rgba, symmetry = false) {
  drawLine(document, layerId, startX, startY, endX, startY, color, symmetry);
  drawLine(document, layerId, endX, startY, endX, endY, color, symmetry);
  drawLine(document, layerId, endX, endY, startX, endY, color, symmetry);
  drawLine(document, layerId, startX, endY, startX, startY, color, symmetry);
}

function colorsMatch(pixels: Uint8ClampedArray, index: number, color: Rgba) {
  return pixels[index] === color[0] && pixels[index + 1] === color[1] && pixels[index + 2] === color[2] && pixels[index + 3] === color[3];
}

export function floodFill(document: PixelDocument, layerId: string, startX: number, startY: number, color: Rgba, symmetry = false) {
  const layer = document.layers.find((item) => item.id === layerId);
  if (!layer || startX < 0 || startY < 0 || startX >= document.width || startY >= document.height) return;
  const start = offset(document, startX, startY);
  const target: Rgba = [layer.pixels[start], layer.pixels[start + 1], layer.pixels[start + 2], layer.pixels[start + 3]];
  if (target.every((value, index) => value === color[index])) return;
  const queue: Array<[number, number]> = [[startX, startY]];
  while (queue.length) {
    const [x, y] = queue.pop()!;
    const index = offset(document, x, y);
    if (!colorsMatch(layer.pixels, index, target)) continue;
    setPixel(document, layerId, x, y, color, symmetry);
    if (x > 0) queue.push([x - 1, y]);
    if (x < document.width - 1) queue.push([x + 1, y]);
    if (y > 0) queue.push([x, y - 1]);
    if (y < document.height - 1) queue.push([x, y + 1]);
  }
}

export function colorAt(document: PixelDocument, x: number, y: number): Rgba {
  const pixels = compositeDocument(document);
  const index = offset(document, x, y);
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
}
