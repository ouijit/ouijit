/**
 * Minimal PNG decode/compose/encode for the theme composite — no imagemagick
 * or sharp on the capture machine, and Node ships zlib, so this stays
 * dependency-free. Handles only what our own captures produce: 8-bit
 * truecolor (RGB/RGBA), non-interlaced.
 */

import * as zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`unsupported PNG shape (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4, 255);

  // Undo per-scanline filtering (spec filters 0-4), then normalize to RGBA.
  const prior = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = prior[i];
      const upLeft = i >= channels ? prior[i - channels] : 0;
      let value = line[i];
      switch (filter) {
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
      }
      line[i] = value & 0xff;
    }
    line.copy(prior);
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      rgba[dst] = line[src];
      rgba[dst + 1] = line[src + 1];
      rgba[dst + 2] = line[src + 2];
      if (channels === 4) rgba[dst + 3] = line[src + 3];
    }
  }

  return { width, height, rgba };
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(...buffers) {
  let c = -1;
  for (const buffer of buffers) {
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(header.subarray(4), data), 0);
  return Buffer.concat([header, data, crc]);
}

export function encodePng({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Join equally sized images into one frame of slanted vertical bands with a
 * transparent seam between neighbours — image i owns band i, left to right.
 * Band edges feather their alpha over a couple of pixels; a hard per-pixel
 * cut stair-steps visibly along the slant.
 */
export function composeDiagonalSlices(images, { gap = 14, tilt = 72, feather = 2 } = {}) {
  const [{ width, height }] = images;
  for (const image of images) {
    if (image.width !== width || image.height !== height) throw new Error('composite inputs differ in size');
  }

  const out = Buffer.alloc(width * height * 4);
  const n = images.length;
  for (let y = 0; y < height; y++) {
    const shift = tilt * (y / height - 0.5);
    const boundaries = [];
    for (let i = 1; i < n; i++) boundaries.push((width * i) / n + shift);
    for (let x = 0; x < width; x++) {
      let slice = 0;
      let nearest = Infinity;
      for (const boundary of boundaries) {
        const distance = Math.abs(x - boundary);
        if (distance < nearest) nearest = distance;
        if (x > boundary) slice++;
      }
      const coverage = Math.min(1, Math.max(0, (nearest - gap / 2) / feather + 1));
      if (coverage === 0) continue; // stays transparent
      const offset = (y * width + x) * 4;
      const source = images[slice].rgba;
      out[offset] = source[offset];
      out[offset + 1] = source[offset + 1];
      out[offset + 2] = source[offset + 2];
      out[offset + 3] = Math.round(source[offset + 3] * coverage);
    }
  }

  return { width, height, rgba: out };
}
