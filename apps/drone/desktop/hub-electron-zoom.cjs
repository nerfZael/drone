const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ZOOM_FACTOR = 1;
const ZOOM_FACTORS = Object.freeze([0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]);

function normalizeZoomFactor(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ZOOM_FACTOR;
  return ZOOM_FACTORS.includes(parsed) ? parsed : DEFAULT_ZOOM_FACTOR;
}

function stepZoomFactor(current, direction) {
  const normalized = normalizeZoomFactor(current);
  const currentIndex = ZOOM_FACTORS.indexOf(normalized);
  const offset = direction === 'out' ? -1 : 1;
  const nextIndex = Math.max(0, Math.min(ZOOM_FACTORS.length - 1, currentIndex + offset));
  return ZOOM_FACTORS[nextIndex];
}

function zoomActionForInput(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.alt) return null;
  const primaryModifier = platform === 'darwin' ? input.meta : input.control;
  if (!primaryModifier) return null;

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  if (key === '+' || key === '=' || key === 'add' || code === 'numpadadd') return 'in';
  if (key === '-' || key === '_' || key === 'subtract' || code === 'numpadsubtract') return 'out';
  if (key === '0' || code === 'numpad0') return 'reset';
  return null;
}

function zoomPreferencesPath(userDataPath) {
  return path.join(userDataPath, 'drone-hub-zoom.json');
}

function readZoomFactor(preferencesPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    return normalizeZoomFactor(parsed?.zoomFactor);
  } catch {
    return DEFAULT_ZOOM_FACTOR;
  }
}

function writeZoomFactor(preferencesPath, zoomFactor) {
  const normalized = normalizeZoomFactor(zoomFactor);
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  const temporaryPath = `${preferencesPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ zoomFactor: normalized }, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, preferencesPath);
}

module.exports = {
  DEFAULT_ZOOM_FACTOR,
  ZOOM_FACTORS,
  normalizeZoomFactor,
  readZoomFactor,
  stepZoomFactor,
  writeZoomFactor,
  zoomActionForInput,
  zoomPreferencesPath,
};
