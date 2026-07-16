export interface RasterFrame {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

function concatenate(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => { output.set(part, offset); offset += part.length; });
  return output;
}

function word(value: number) {
  return new Uint8Array([value & 255, (value >> 8) & 255]);
}

function text(value: string) {
  return new Uint8Array([...value].map((character) => character.charCodeAt(0)));
}

function globalPalette() {
  const palette = new Uint8Array(256 * 3);
  for (let red = 0; red < 6; red += 1) {
    for (let green = 0; green < 7; green += 1) {
      for (let blue = 0; blue < 6; blue += 1) {
        const index = 1 + red * 42 + green * 6 + blue;
        palette[index * 3] = Math.round(red * 255 / 5);
        palette[index * 3 + 1] = Math.round(green * 255 / 6);
        palette[index * 3 + 2] = Math.round(blue * 255 / 5);
      }
    }
  }
  return palette;
}

function paletteIndex(red: number, green: number, blue: number, alpha: number) {
  if (alpha < 128) return 0;
  return 1 + Math.round(red * 5 / 255) * 42 + Math.round(green * 6 / 255) * 6 + Math.round(blue * 5 / 255);
}

function indexedPixels(frame: RasterFrame) {
  const indices = new Uint8Array(frame.width * frame.height);
  for (let pixel = 0, index = 0; pixel < frame.pixels.length; pixel += 4, index += 1) {
    indices[index] = paletteIndex(frame.pixels[pixel], frame.pixels[pixel + 1], frame.pixels[pixel + 2], frame.pixels[pixel + 3]);
  }
  return indices;
}

function lzw(indices: Uint8Array) {
  const clearCode = 256;
  const endCode = 257;
  let nextCode = 258;
  let codeSize = 9;
  let dictionary = new Map<string, number>();
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  const write = (code: number) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      output.push(buffer & 255);
      buffer >>= 8;
      bits -= 8;
    }
  };
  const reset = () => {
    dictionary = new Map();
    for (let index = 0; index < 256; index += 1) dictionary.set(String(index), index);
    nextCode = 258;
    codeSize = 9;
  };
  reset();
  write(clearCode);
  if (!indices.length) {
    write(endCode);
    return new Uint8Array(output);
  }
  let prefix = String(indices[0]);
  for (let index = 1; index < indices.length; index += 1) {
    const value = String(indices[index]);
    const key = `${prefix},${value}`;
    if (dictionary.has(key)) {
      prefix = key;
      continue;
    }
    write(dictionary.get(prefix)!);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode);
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      write(clearCode);
      reset();
    }
    prefix = value;
  }
  write(dictionary.get(prefix)!);
  write(endCode);
  if (bits) output.push(buffer & 255);
  return new Uint8Array(output);
}

function subBlocks(bytes: Uint8Array) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const chunk = bytes.slice(offset, offset + 255);
    chunks.push(new Uint8Array([chunk.length]), chunk);
  }
  chunks.push(new Uint8Array([0]));
  return concatenate(chunks);
}

export function encodeGif(frames: RasterFrame[], fps: number): Blob {
  if (!frames.length) throw new Error('There are no frames to export.');
  const { width, height } = frames[0];
  if (frames.some((frame) => frame.width !== width || frame.height !== height)) throw new Error('GIF frames must have matching dimensions.');
  const parts: Uint8Array[] = [
    text('GIF89a'),
    word(width), word(height),
    new Uint8Array([0xf7, 0, 0]),
    globalPalette(),
    new Uint8Array([0x21, 0xff, 0x0b]), text('NETSCAPE2.0'), new Uint8Array([0x03, 0x01, 0x00, 0x00, 0x00]),
  ];
  const delay = Math.max(1, Math.min(65535, Math.round(100 / fps)));
  frames.forEach((frame) => {
    parts.push(
      new Uint8Array([0x21, 0xf9, 0x04, 0x09]), word(delay), new Uint8Array([0, 0]),
      new Uint8Array([0x2c]), word(0), word(0), word(width), word(height), new Uint8Array([0]),
      new Uint8Array([8]), subBlocks(lzw(indexedPixels(frame))),
    );
  });
  parts.push(new Uint8Array([0x3b]));
  return new Blob([concatenate(parts)], { type: 'image/gif' });
}

