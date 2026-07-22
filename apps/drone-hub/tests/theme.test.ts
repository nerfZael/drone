import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_DESKTOP_THEME_ID,
  DESKTOP_THEMES,
  applyDesktopTheme,
  desktopMonacoTheme,
  desktopThemeDefinition,
  normalizeDesktopThemeId,
} from '../src/theme';

function cssCustomProperties(block: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [
      name,
      value.trim(),
    ]),
  );
}

describe('desktop themes', () => {
  test('exposes the two supported dark themes', () => {
    expect(DESKTOP_THEMES.map((theme) => theme.id)).toEqual(['monolith', 'catppuccin-mocha']);
    expect(DESKTOP_THEMES.every((theme) => theme.swatches.length === 4)).toBe(true);
    expect(DEFAULT_DESKTOP_THEME_ID).toBe('catppuccin-mocha');
  });

  test('falls back safely when a persisted theme is unknown', () => {
    expect(normalizeDesktopThemeId('catppuccin-mocha')).toBe('catppuccin-mocha');
    expect(normalizeDesktopThemeId('monolith')).toBe('monolith');
    expect(normalizeDesktopThemeId('future-light-theme')).toBe('catppuccin-mocha');
    expect(desktopThemeDefinition(null).id).toBe('catppuccin-mocha');
  });

  test('can resolve a theme when the DOM is unavailable', () => {
    expect(applyDesktopTheme('catppuccin-mocha')).toBe('catppuccin-mocha');
  });

  test('uses the official Catppuccin Mocha colors in terminal integrations', () => {
    expect(desktopThemeDefinition('catppuccin-mocha').terminal).toMatchObject({
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorAccent: '#11111b',
      selectionBackground: 'rgba(147,153,178,.25)',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#a6adc8',
      brightBlack: '#585b70',
      brightRed: '#f37799',
      brightGreen: '#89d88b',
      brightYellow: '#ebd391',
      brightBlue: '#74a8fc',
      brightMagenta: '#f2aede',
      brightCyan: '#6bd7ca',
      brightWhite: '#bac2de',
    });
  });

  test('provides app-specific Monaco themes for both desktop themes', () => {
    expect(desktopMonacoTheme('monolith').id).toBe('drone-hub-monolith');
    const catppuccin = desktopMonacoTheme('catppuccin-mocha');
    expect(catppuccin.id).toBe('drone-hub-catppuccin-mocha');
    expect(catppuccin.definition.colors).toMatchObject({
      'editor.background': '#1E1E2E',
      'editor.foreground': '#CDD6F4',
      'editorCursor.foreground': '#F5E0DC',
      'editor.selectionBackground': '#9399B240',
      'editor.lineHighlightBackground': '#CDD6F41A',
      'editorLineNumber.foreground': '#7F849C',
      'editorLineNumber.activeForeground': '#B4BEFE',
      'editorWidget.background': '#181825',
    });
    expect(catppuccin.definition.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: 'operator', foreground: '89DCEB' }),
        expect.objectContaining({ token: 'variable.parameter', foreground: 'EBA0AC' }),
        expect.objectContaining({ token: 'annotation', foreground: 'F9E2AF' }),
        expect.objectContaining({ token: 'macro', foreground: 'F5E0DC' }),
      ]),
    );
  });

  test('maps Catppuccin desktop surfaces into a quiet visual hierarchy', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const catppuccinStart = css.indexOf(":root[data-theme='catppuccin-mocha']");
    const catppuccinEnd = css.indexOf('/* Excalidraw owns', catppuccinStart);
    const catppuccinCss = css.slice(catppuccinStart, catppuccinEnd);
    const tokens = cssCustomProperties(catppuccinCss);

    expect(tokens).toMatchObject({
      '--workspace': '#1e1e2e',
      '--panel': '#181825',
      '--panel-raised': '#313244',
      '--border': 'rgba(69, 71, 90, .56)',
      '--fg-strong': '#cdd6f4',
      '--muted': '#a6adc8',
      '--muted-dim': '#7f849c',
      '--border-subtle': 'rgba(49, 50, 68, .78)',
      '--assistant-message-fg': '#bac2de',
      '--chat-list-marker': '#7f849c',
      '--user-bubble': '#313244',
      '--user-bubble-border': 'rgba(69, 71, 90, .48)',
      '--user-bubble-fg': '#cdd6f4',
      '--chat-background': '#1e1e2e',
      '--chat-user-message-time': '#a6adc8',
      '--chat-composer-border': 'rgba(69, 71, 90, .56)',
      '--chat-composer-focus-border': 'rgba(203, 166, 247, .26)',
      '--chat-composer-surface': '#313244',
      '--chat-composer-fg': '#cdd6f4',
      '--chat-composer-placeholder': '#7f849c',
      '--chat-composer-control-bg': 'rgba(69, 71, 90, .34)',
      '--chat-composer-control-border': 'transparent',
      '--chat-composer-control-fg': '#a6adc8',
      '--chat-composer-model-fg': '#9399b2',
      '--chat-composer-font': 'system-ui, -apple-system, sans-serif',
      '--chat-composer-radius': '.4375rem',
      '--chat-composer-control-radius': '.3125rem',
      '--chat-composer-shadow': '0 .25rem .875rem rgba(17, 17, 27, .18)',
      '--chat-composer-input': '#313244',
      '--app-header-bg': '#181825',
      '--app-header-border': 'rgba(69, 71, 90, .52)',
      '--workspace-header-title-fg': '#cdd6f4',
      '--sidebar-bg': '#181825',
      '--sidebar-section-bg': '#181825',
      '--sidebar-section-border': 'rgba(49, 50, 68, .78)',
      '--sidebar-tab-active-bg': 'transparent',
      '--sidebar-create-bg': 'transparent',
      '--sidebar-create-border': 'transparent',
      '--sidebar-create-hover-bg': '#313244',
      '--toolbar-control-bg': 'transparent',
      '--toolbar-control-border': 'transparent',
      '--toolbar-control-hover-border': 'rgba(69, 71, 90, .68)',
      '--sidebar-brand-fg': '#cdd6f4',
      '--sidebar-brand-size': '.875rem',
      '--sidebar-brand-weight': '700',
      '--sidebar-heading-weight': '600',
      '--sidebar-drone-fg': '#a6adc8',
      '--sidebar-drone-active-fg': '#cdd6f4',
      '--sidebar-drone-size': '.75rem',
      '--sidebar-drone-weight': '500',
      '--sidebar-row-selected-bg': 'rgba(203, 166, 247, .055)',
      '--sidebar-meta-fg': '#7f849c',
      '--selected': 'rgba(147, 153, 178, .24)',
      '--selection-highlight': 'rgba(147, 153, 178, .25)',
      '--link': '#89b4fa',
      '--link-hover': '#89dceb',
      '--cursor': '#f5e0dc',
      '--code-bg': '#313244',
      '--code-fg': '#b4befe',
      '--code-block-bg': '#292a3c',
      '--code-block-fg': '#cdd6f4',
      '--syntax-number': '#fab387',
      '--syntax-string': '#a6e3a1',
      '--syntax-operator': '#89dceb',
      '--syntax-keyword': '#cba6f7',
      '--syntax-function': '#89b4fa',
      '--syntax-type': '#f9e2af',
      '--syntax-regex': '#f5c2e7',
      '--syntax-macro': '#f5e0dc',
      '--syntax-variable': '#eba0ac',
      '--glow-accent': 'none',
    });
    const catppuccinTokenNames = Array.from(catppuccinCss.matchAll(/(--[a-z0-9-]+)\s*:/g), (match) => match[1]);
    const presentationTokenPrefixes = [
      '--body-',
      '--text-',
      '--weight-',
      '--control-height',
      '--radius-',
      '--sidebar-item-',
    ];
    const presentationTokenNames = new Set([
      '--display',
      '--sans',
      '--code',
      '--chat-text-size',
      '--chat-prose-max',
    ]);
    expect(
      catppuccinTokenNames.filter((token) =>
        presentationTokenNames.has(token) ||
        presentationTokenPrefixes.some((prefix) => token.startsWith(prefix)),
      ),
    ).toEqual([]);
  });
});
