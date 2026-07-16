import { rasterizeRotatedSprite, type PixelRotationOptions, type RasterizedSprite } from './pixelRotation';

interface CacheEntry {
  assetId: string;
  rasterized: RasterizedSprite;
}

const sourceIds = new WeakMap<object, number>();
let nextSourceId = 1;

function sourceId(source: HTMLImageElement | HTMLCanvasElement) {
  const existing = sourceIds.get(source);
  if (existing) return existing;
  const id = nextSourceId;
  nextSourceId += 1;
  sourceIds.set(source, id);
  return id;
}

function stableNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(6) : '0';
}

function cacheKey(assetId: string, source: HTMLImageElement | HTMLCanvasElement, options: PixelRotationOptions) {
  const linear = options.linearTransform;
  return [
    assetId,
    sourceId(source),
    stableNumber(options.angleRadians),
    stableNumber(options.scaleX),
    stableNumber(options.scaleY),
    stableNumber(options.pivotX),
    stableNumber(options.pivotY),
    options.pixelGridSize,
    options.alphaThreshold,
    options.fillSinglePixelGaps ? 1 : 0,
    linear ? [linear.a, linear.b, linear.c, linear.d].map(stableNumber).join(',') : 'local',
  ].join('|');
}

export class SpriteRasterCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly maxEntries = 192) {}

  get(assetId: string, source: HTMLImageElement | HTMLCanvasElement, options: PixelRotationOptions) {
    const key = cacheKey(assetId, source, options);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.rasterized;
    }
    const rasterized = rasterizeRotatedSprite(source, options);
    this.entries.set(key, { assetId, rasterized });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
    return rasterized;
  }

  invalidateAsset(assetId: string) {
    for (const [key, entry] of this.entries) {
      if (entry.assetId === assetId) this.entries.delete(key);
    }
  }

  clear() {
    this.entries.clear();
  }
}

export const spriteRasterCache = new SpriteRasterCache();
