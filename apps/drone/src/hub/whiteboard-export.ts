import zlib from 'node:zlib';

import type { WhiteboardDocument } from './whiteboard-store';

export type WhiteboardImageExport = {
  ok: true;
  whiteboardId: string;
  title: string;
  version: number;
  mimeType: 'image/png';
  width: number;
  height: number;
  visibleElementCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  padding: number;
  scale: number;
  data: string;
  byteLength: number;
};

export type WhiteboardImageExportOptions = {
  padding?: unknown;
  maxWidth?: unknown;
  maxHeight?: unknown;
  backgroundColor?: unknown;
};

type Rgba = { r: number; g: number; b: number; a: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const DEFAULT_PADDING = 48;
const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_MAX_HEIGHT = 1200;
const MIN_IMAGE_SIDE = 160;
const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_PIXELS = 4_000_000;

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const BLACK: Rgba = { r: 15, g: 23, b: 42, a: 255 };

const NAMED_COLORS: Record<string, Rgba> = {
  black: BLACK,
  white: WHITE,
  transparent: TRANSPARENT,
  red: { r: 220, g: 38, b: 38, a: 255 },
  blue: { r: 37, g: 99, b: 235, a: 255 },
  green: { r: 22, g: 163, b: 74, a: 255 },
  yellow: { r: 234, g: 179, b: 8, a: 255 },
  orange: { r: 249, g: 115, b: 22, a: 255 },
  purple: { r: 126, g: 34, b: 206, a: 255 },
  gray: { r: 100, g: 116, b: 139, a: 255 },
  grey: { r: 100, g: 116, b: 139, a: 255 },
};

const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '01100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '\\': ['10000', '01000', '01000', '00100', '00010', '00010', '00001'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '[': ['01110', '01000', '01000', '01000', '01000', '01000', '01110'],
  ']': ['01110', '00010', '00010', '00010', '00010', '00010', '01110'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '@': ['01110', '10001', '10111', '10101', '10111', '10000', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function cleanString(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function cleanNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseColor(value: unknown, fallback: Rgba): Rgba {
  const text = cleanString(value).toLowerCase();
  if (!text) return fallback;
  if (NAMED_COLORS[text]) return NAMED_COLORS[text];
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return fallback;
  const raw = hex[1];
  if (raw.length === 3) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16),
      a: 255,
    };
  }
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
    a: 255,
  };
}

function visibleElements(whiteboard: WhiteboardDocument): any[] {
  return Array.isArray(whiteboard.scene?.elements)
    ? whiteboard.scene.elements.filter((element: any) => element && typeof element === 'object' && element.isDeleted !== true)
    : [];
}

function boundsForElement(element: any): Bounds {
  const x = cleanNumber(element?.x);
  const y = cleanNumber(element?.y);
  const width = cleanNumber(element?.width);
  const height = cleanNumber(element?.height);
  let minX = Math.min(x, x + width);
  let maxX = Math.max(x, x + width);
  let minY = Math.min(y, y + height);
  let maxY = Math.max(y, y + height);
  if (Array.isArray(element?.points)) {
    for (const point of element.points) {
      if (!Array.isArray(point)) continue;
      const px = x + cleanNumber(point[0]);
      const py = y + cleanNumber(point[1]);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }
  return { minX, minY, maxX, maxY };
}

function unionBounds(elements: any[]): Bounds {
  if (elements.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 450 };
  return elements.map(boundsForElement).reduce(
    (acc, bounds) => ({
      minX: Math.min(acc.minX, bounds.minX),
      minY: Math.min(acc.minY, bounds.minY),
      maxX: Math.max(acc.maxX, bounds.maxX),
      maxY: Math.max(acc.maxY, bounds.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function makeCanvas(width: number, height: number, background: Rgba): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background.r;
    data[i + 1] = background.g;
    data[i + 2] = background.b;
    data[i + 3] = background.a;
  }
  return data;
}

function blendPixel(data: Buffer, width: number, height: number, xRaw: number, yRaw: number, color: Rgba): void {
  const x = Math.round(xRaw);
  const y = Math.round(yRaw);
  if (x < 0 || y < 0 || x >= width || y >= height || color.a <= 0) return;
  const offset = (y * width + x) * 4;
  const alpha = color.a / 255;
  const inv = 1 - alpha;
  data[offset] = Math.round(color.r * alpha + data[offset] * inv);
  data[offset + 1] = Math.round(color.g * alpha + data[offset + 1] * inv);
  data[offset + 2] = Math.round(color.b * alpha + data[offset + 2] * inv);
  data[offset + 3] = Math.min(255, Math.round(color.a + data[offset + 3] * inv));
}

function fillRect(data: Buffer, width: number, height: number, x: number, y: number, rectWidth: number, rectHeight: number, color: Rgba): void {
  const left = Math.max(0, Math.floor(Math.min(x, x + rectWidth)));
  const right = Math.min(width, Math.ceil(Math.max(x, x + rectWidth)));
  const top = Math.max(0, Math.floor(Math.min(y, y + rectHeight)));
  const bottom = Math.min(height, Math.ceil(Math.max(y, y + rectHeight)));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      blendPixel(data, width, height, px, py, color);
    }
  }
}

function strokeRect(data: Buffer, width: number, height: number, x: number, y: number, rectWidth: number, rectHeight: number, color: Rgba, thickness: number): void {
  fillRect(data, width, height, x, y, rectWidth, thickness, color);
  fillRect(data, width, height, x, y + rectHeight - thickness, rectWidth, thickness, color);
  fillRect(data, width, height, x, y, thickness, rectHeight, color);
  fillRect(data, width, height, x + rectWidth - thickness, y, thickness, rectHeight, color);
}

function fillEllipse(data: Buffer, width: number, height: number, x: number, y: number, ellipseWidth: number, ellipseHeight: number, color: Rgba): void {
  if (color.a <= 0) return;
  const left = Math.min(x, x + ellipseWidth);
  const right = Math.max(x, x + ellipseWidth);
  const top = Math.min(y, y + ellipseHeight);
  const bottom = Math.max(y, y + ellipseHeight);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = Math.max(1, (right - left) / 2);
  const ry = Math.max(1, (bottom - top) / 2);
  for (let py = Math.floor(top); py <= Math.ceil(bottom); py += 1) {
    for (let px = Math.floor(left); px <= Math.ceil(right); px += 1) {
      const normalized = ((px - cx) * (px - cx)) / (rx * rx) + ((py - cy) * (py - cy)) / (ry * ry);
      if (normalized <= 1) blendPixel(data, width, height, px, py, color);
    }
  }
}

function strokeEllipse(data: Buffer, width: number, height: number, x: number, y: number, ellipseWidth: number, ellipseHeight: number, color: Rgba, thickness: number): void {
  const left = Math.min(x, x + ellipseWidth);
  const right = Math.max(x, x + ellipseWidth);
  const top = Math.min(y, y + ellipseHeight);
  const bottom = Math.max(y, y + ellipseHeight);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = Math.max(1, (right - left) / 2);
  const ry = Math.max(1, (bottom - top) / 2);
  const steps = Math.max(24, Math.ceil(Math.max(rx, ry) * 0.4));
  let prevX = cx + rx;
  let prevY = cy;
  for (let i = 1; i <= steps; i += 1) {
    const angle = (Math.PI * 2 * i) / steps;
    const nextX = cx + Math.cos(angle) * rx;
    const nextY = cy + Math.sin(angle) * ry;
    drawLine(data, width, height, prevX, prevY, nextX, nextY, color, thickness);
    prevX = nextX;
    prevY = nextY;
  }
}

function drawLine(data: Buffer, width: number, height: number, x1: number, y1: number, x2: number, y2: number, color: Rgba, thickness: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const radius = Math.max(0, Math.floor(thickness / 2));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (ox * ox + oy * oy <= radius * radius + 0.5) blendPixel(data, width, height, x + ox, y + oy, color);
      }
    }
  }
}

function drawArrowHead(data: Buffer, width: number, height: number, x1: number, y1: number, x2: number, y2: number, color: Rgba, thickness: number): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.max(10, thickness * 5);
  const spread = Math.PI / 7;
  const leftX = x2 - Math.cos(angle - spread) * length;
  const leftY = y2 - Math.sin(angle - spread) * length;
  const rightX = x2 - Math.cos(angle + spread) * length;
  const rightY = y2 - Math.sin(angle + spread) * length;
  drawLine(data, width, height, x2, y2, leftX, leftY, color, thickness);
  drawLine(data, width, height, x2, y2, rightX, rightY, color, thickness);
}

function fillPolygon(data: Buffer, width: number, height: number, points: Array<[number, number]>, color: Rgba): void {
  if (points.length < 3 || color.a <= 0) return;
  const minY = Math.floor(Math.min(...points.map((point) => point[1])));
  const maxY = Math.ceil(Math.max(...points.map((point) => point[1])));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        intersections.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      drawLine(data, width, height, intersections[i], y, intersections[i + 1], y, color, 1);
    }
  }
}

function strokePolygon(data: Buffer, width: number, height: number, points: Array<[number, number]>, color: Rgba, thickness: number): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    drawLine(data, width, height, a[0], a[1], b[0], b[1], color, thickness);
  }
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current.length + 1 + word.length) <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function drawGlyph(data: Buffer, width: number, height: number, char: string, x: number, y: number, scale: number, color: Rgba): void {
  const glyph = FONT[char.toUpperCase()] ?? FONT['?'];
  const pixel = Math.max(1, Math.floor(scale));
  glyph.forEach((row, rowIndex) => {
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      if (row[colIndex] !== '1') continue;
      fillRect(data, width, height, x + colIndex * pixel, y + rowIndex * pixel, pixel, pixel, color);
    }
  });
}

function drawText(data: Buffer, width: number, height: number, textRaw: unknown, x: number, y: number, boxWidth: number, boxHeight: number, color: Rgba, scale: number): void {
  const text = cleanString(textRaw);
  if (!text) return;
  const glyphScale = Math.max(2, Math.floor(scale * 2));
  const charWidth = glyphScale * 6;
  const lineHeight = glyphScale * 9;
  const maxChars = Math.max(1, Math.floor(Math.max(20, boxWidth - glyphScale * 2) / charWidth));
  const maxLines = Math.max(1, Math.floor(Math.max(16, boxHeight - glyphScale * 2) / lineHeight));
  const lines = wrapText(text, maxChars).slice(0, maxLines);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      drawGlyph(data, width, height, line[charIndex], x + glyphScale + charIndex * charWidth, y + glyphScale + lineIndex * lineHeight, glyphScale, color);
    }
  }
}

function makeTransform(bounds: Bounds, padding: number, scale: number) {
  return {
    x: (value: number) => (value - bounds.minX + padding) * scale,
    y: (value: number) => (value - bounds.minY + padding) * scale,
    length: (value: number) => value * scale,
  };
}

function renderElement(data: Buffer, width: number, height: number, element: any, transform: ReturnType<typeof makeTransform>, scale: number): void {
  const type = cleanString(element?.type).toLowerCase();
  const x = transform.x(cleanNumber(element?.x));
  const y = transform.y(cleanNumber(element?.y));
  const elementWidth = transform.length(cleanNumber(element?.width));
  const elementHeight = transform.length(cleanNumber(element?.height));
  const stroke = parseColor(element?.strokeColor, BLACK);
  const fill = parseColor(element?.backgroundColor, TRANSPARENT);
  const thickness = Math.max(1, Math.round(cleanNumber(element?.strokeWidth, 2) * scale));

  if (type === 'arrow' || type === 'line' || type === 'freedraw' || Array.isArray(element?.points)) {
    const points = Array.isArray(element?.points) ? element.points : [[0, 0], [cleanNumber(element?.width), cleanNumber(element?.height)]];
    let previous: [number, number] | null = null;
    for (const point of points) {
      if (!Array.isArray(point)) continue;
      const current: [number, number] = [x + transform.length(cleanNumber(point[0])), y + transform.length(cleanNumber(point[1]))];
      if (previous) drawLine(data, width, height, previous[0], previous[1], current[0], current[1], stroke, thickness);
      previous = current;
    }
    if (type === 'arrow' && points.length >= 2) {
      const before = points[points.length - 2];
      const end = points[points.length - 1];
      if (Array.isArray(before) && Array.isArray(end)) {
        drawArrowHead(
          data,
          width,
          height,
          x + transform.length(cleanNumber(before[0])),
          y + transform.length(cleanNumber(before[1])),
          x + transform.length(cleanNumber(end[0])),
          y + transform.length(cleanNumber(end[1])),
          stroke,
          thickness,
        );
      }
    }
    if (element?.text || element?.label) {
      drawText(data, width, height, element.text ?? element.label, x + elementWidth / 2 - 80 * scale, y + elementHeight / 2 - 18 * scale, 160 * scale, 36 * scale, stroke, scale);
    }
    return;
  }

  if (type === 'text') {
    drawText(data, width, height, element?.text ?? element?.originalText, x, y, Math.max(80 * scale, Math.abs(elementWidth)), Math.max(28 * scale, Math.abs(elementHeight)), stroke, scale);
    return;
  }

  if (type === 'ellipse') {
    if (fill.a > 0) fillEllipse(data, width, height, x, y, elementWidth, elementHeight, fill);
    strokeEllipse(data, width, height, x, y, elementWidth, elementHeight, stroke, thickness);
    if (element?.text || element?.label) {
      drawText(data, width, height, element.text ?? element.label, x + 12 * scale, y + 12 * scale, Math.abs(elementWidth) - 24 * scale, Math.abs(elementHeight) - 24 * scale, stroke, scale);
    }
    return;
  }

  if (type === 'diamond') {
    const left = Math.min(x, x + elementWidth);
    const right = Math.max(x, x + elementWidth);
    const top = Math.min(y, y + elementHeight);
    const bottom = Math.max(y, y + elementHeight);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const points: Array<[number, number]> = [[cx, top], [right, cy], [cx, bottom], [left, cy]];
    if (fill.a > 0) fillPolygon(data, width, height, points, fill);
    strokePolygon(data, width, height, points, stroke, thickness);
    if (element?.text || element?.label) {
      drawText(data, width, height, element.text ?? element.label, left + 12 * scale, top + 12 * scale, Math.abs(elementWidth) - 24 * scale, Math.abs(elementHeight) - 24 * scale, stroke, scale);
    }
    return;
  }

  if (fill.a > 0) fillRect(data, width, height, x, y, elementWidth, elementHeight, fill);
  strokeRect(data, width, height, x, y, elementWidth, elementHeight, stroke, thickness);
  if (element?.text || element?.label) {
    drawText(data, width, height, element.text ?? element.label, x + 8 * scale, y + 8 * scale, Math.abs(elementWidth) - 16 * scale, Math.abs(elementHeight) - 16 * scale, stroke, scale);
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    rgba.copy(raw, row * (stride + 1) + 1, row * stride, row * stride + stride);
  }
  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderWhiteboardPng(whiteboard: WhiteboardDocument, options: WhiteboardImageExportOptions = {}): WhiteboardImageExport {
  const elements = visibleElements(whiteboard);
  const padding = cleanPositiveInt(options.padding, DEFAULT_PADDING, 0, 400);
  const maxWidth = cleanPositiveInt(options.maxWidth, DEFAULT_MAX_WIDTH, MIN_IMAGE_SIDE, MAX_IMAGE_SIDE);
  const maxHeight = cleanPositiveInt(options.maxHeight, DEFAULT_MAX_HEIGHT, MIN_IMAGE_SIDE, MAX_IMAGE_SIDE);
  const background = parseColor(options.backgroundColor, WHITE);
  const bounds = unionBounds(elements);
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  let scale = Math.min(maxWidth / contentWidth, maxHeight / contentHeight);
  scale = Math.max(0.1, Math.min(2, scale));
  let width = Math.max(MIN_IMAGE_SIDE, Math.ceil(contentWidth * scale));
  let height = Math.max(MIN_IMAGE_SIDE, Math.ceil(contentHeight * scale));
  if (width * height > MAX_IMAGE_PIXELS) {
    const pixelScale = Math.sqrt(MAX_IMAGE_PIXELS / (width * height));
    scale *= pixelScale;
    width = Math.max(MIN_IMAGE_SIDE, Math.ceil(contentWidth * scale));
    height = Math.max(MIN_IMAGE_SIDE, Math.ceil(contentHeight * scale));
  }

  const rgba = makeCanvas(width, height, background);
  const transform = makeTransform(bounds, padding, scale);
  for (const element of elements) renderElement(rgba, width, height, element, transform, scale);
  if (elements.length === 0) drawText(rgba, width, height, 'Empty whiteboard', 24, 24, width - 48, 80, BLACK, 1);

  const png = encodePng(width, height, rgba);
  return {
    ok: true,
    whiteboardId: whiteboard.id,
    title: whiteboard.title,
    version: whiteboard.version,
    mimeType: 'image/png',
    width,
    height,
    visibleElementCount: elements.length,
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    },
    padding,
    scale,
    data: png.toString('base64'),
    byteLength: png.byteLength,
  };
}
