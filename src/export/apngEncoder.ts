import type { RasterFrame } from './gifEncoder';

function concatenate(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => { output.set(part, offset); offset += part.length; });
  return output;
}

function unsigned32(value: number) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function unsigned16(value: number) {
  return new Uint8Array([(value >>> 8) & 255, value & 255]);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  bytes.forEach((byte) => { value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); });
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  const crc = crc32(concatenate([typeBytes, data]));
  return concatenate([unsigned32(data.length), typeBytes, data, unsigned32(crc)]);
}

function scanlines(frame: RasterFrame) {
  const stride = frame.width * 4;
  const data = new Uint8Array((stride + 1) * frame.height);
  for (let row = 0; row < frame.height; row += 1) {
    data[row * (stride + 1)] = 0;
    data.set(frame.pixels.slice(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return data;
}

async function deflate(bytes: Uint8Array) {
  if (!('CompressionStream' in globalThis)) throw new Error('APNG export needs a browser with CompressionStream support.');
  const compression = new CompressionStream('deflate');
  const writer = compression.writable.getWriter();
  await writer.write(new Uint8Array(bytes));
  await writer.close();
  return new Uint8Array(await new Response(compression.readable).arrayBuffer());
}

export async function encodeApng(frames: RasterFrame[], fps: number): Promise<Blob> {
  if (!frames.length) throw new Error('There are no frames to export.');
  const { width, height } = frames[0];
  if (frames.some((frame) => frame.width !== width || frame.height !== height)) throw new Error('APNG frames must have matching dimensions.');
  let sequence = 0;
  const delayDenominator = Math.max(1, Math.min(65535, Math.round(fps)));
  const frameControl = () => concatenate([
    unsigned32(sequence++), unsigned32(width), unsigned32(height), unsigned32(0), unsigned32(0),
    unsigned16(1), unsigned16(delayDenominator), new Uint8Array([0, 0]),
  ]);
  const parts: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', concatenate([unsigned32(width), unsigned32(height), new Uint8Array([8, 6, 0, 0, 0])])),
    chunk('acTL', concatenate([unsigned32(frames.length), unsigned32(0)])),
  ];
  for (let index = 0; index < frames.length; index += 1) {
    parts.push(chunk('fcTL', frameControl()));
    const compressed = await deflate(scanlines(frames[index]));
    parts.push(index === 0 ? chunk('IDAT', compressed) : chunk('fdAT', concatenate([unsigned32(sequence++), compressed])));
  }
  parts.push(chunk('IEND', new Uint8Array()));
  return new Blob([concatenate(parts)], { type: 'image/apng' });
}
