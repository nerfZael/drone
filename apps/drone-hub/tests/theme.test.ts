import { describe, expect, test } from 'bun:test';
import {
  DESKTOP_THEMES,
  applyDesktopTheme,
  desktopMonacoTheme,
  desktopThemeDefinition,
  normalizeDesktopThemeId,
} from '../src/theme';

describe('desktop themes', () => {
  test('exposes the two supported dark themes', () => {
    expect(DESKTOP_THEMES.map((theme) => theme.id)).toEqual(['monolith', 'catppuccin-mocha']);
    expect(DESKTOP_THEMES.every((theme) => theme.swatches.length === 4)).toBe(true);
  });

  test('falls back safely when a persisted theme is unknown', () => {
    expect(normalizeDesktopThemeId('catppuccin-mocha')).toBe('catppuccin-mocha');
    expect(normalizeDesktopThemeId('future-light-theme')).toBe('monolith');
    expect(desktopThemeDefinition(null).id).toBe('monolith');
  });

  test('can resolve a theme when the DOM is unavailable', () => {
    expect(applyDesktopTheme('catppuccin-mocha')).toBe('catppuccin-mocha');
  });

  test('uses the official Catppuccin Mocha colors in terminal integrations', () => {
    expect(desktopThemeDefinition('catppuccin-mocha').terminal).toMatchObject({
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#cba6f7',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#cba6f7',
      cyan: '#94e2d5',
      brightRed: '#eba0ac',
      brightGreen: '#94e2d5',
      brightYellow: '#fab387',
      brightBlue: '#74c7ec',
      brightMagenta: '#f5c2e7',
      brightCyan: '#89dceb',
      brightWhite: '#cdd6f4',
    });
  });

  test('provides app-specific Monaco themes for both desktop themes', () => {
    expect(desktopMonacoTheme('monolith').id).toBe('drone-hub-monolith');
    const catppuccin = desktopMonacoTheme('catppuccin-mocha');
    expect(catppuccin.id).toBe('drone-hub-catppuccin-mocha');
    expect(catppuccin.definition.colors).toMatchObject({
      'editor.background': '#1E1E2E',
      'editor.foreground': '#CDD6F4',
      'editorCursor.foreground': '#CBA6F7',
      'editorWidget.background': '#181825',
    });
  });
});
