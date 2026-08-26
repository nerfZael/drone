import type { ReadingDensityMode } from './droneHub/app/settings-types';

export function normalizeReadingDensityMode(value: unknown): ReadingDensityMode {
  return value === 'comfortable' ? 'comfortable' : 'default';
}

export function applyReadingDensity(value: unknown): ReadingDensityMode {
  const density = normalizeReadingDensityMode(value);
  if (typeof document === 'undefined') return density;
  document.documentElement.dataset.readingDensity = density;
  return density;
}
