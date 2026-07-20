import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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

  test('maps Catppuccin desktop surfaces and sidebar presentation to the mobile visual roles', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const catppuccinStart = css.indexOf(":root[data-theme='catppuccin-mocha']");
    const catppuccinEnd = css.indexOf('/* Excalidraw owns', catppuccinStart);
    const catppuccinCss = css.slice(catppuccinStart, catppuccinEnd);

    expect(catppuccinCss).toContain('--workspace: #1e1e2e');
    expect(catppuccinCss).toContain('--panel: #181825');
    expect(catppuccinCss).toContain('--panel-raised: #313244');
    expect(catppuccinCss).toContain('--border: #45475a');
    expect(catppuccinCss).toContain('--fg-strong: #f5e0dc');
    expect(catppuccinCss).toContain('--muted: #bac2de');
    expect(catppuccinCss).toContain('--user-bubble: #45475a');
    expect(catppuccinCss).toContain('--user-bubble-border: #585b70');
    expect(catppuccinCss).toContain('--chat-background: #1e1e2e');
    expect(catppuccinCss).toContain('--chat-user-message-time: #bac2de');
    expect(catppuccinCss).toContain('--chat-composer-border: #7f849c');
    expect(catppuccinCss).toContain('--chat-composer-focus-border: rgba(203, 166, 247, .42)');
    expect(catppuccinCss).toContain('--chat-composer-surface: #313244');
    expect(catppuccinCss).toContain('--chat-composer-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--chat-composer-placeholder: #bac2de');
    expect(catppuccinCss).toContain('--chat-composer-control-bg: #45475a');
    expect(catppuccinCss).toContain('--chat-composer-control-border: #7f849c');
    expect(catppuccinCss).toContain('--chat-composer-control-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--chat-composer-model-fg: #bac2de');
    expect(catppuccinCss).toContain('--chat-composer-font: system-ui, -apple-system, sans-serif');
    expect(catppuccinCss).toContain('--chat-composer-radius: .4375rem');
    expect(catppuccinCss).toContain('--chat-composer-control-radius: .3125rem');
    expect(catppuccinCss).toContain('--chat-composer-shadow: 0 .3125rem .75rem rgba(17, 17, 27, .22)');
    expect(catppuccinCss).toContain('--chat-composer-input: #313244');
    expect(catppuccinCss).toContain('--sidebar-bg: #1e1e2e');
    expect(catppuccinCss).toContain('--sidebar-section-bg: #181825');
    expect(catppuccinCss).toContain('--sidebar-brand-fg: #f5e0dc');
    expect(catppuccinCss).toContain('--sidebar-brand-size: .9375rem');
    expect(catppuccinCss).toContain('--sidebar-brand-weight: 800');
    expect(catppuccinCss).toContain('--sidebar-drone-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--sidebar-drone-active-fg: #cba6f7');
    expect(catppuccinCss).toContain('--sidebar-drone-size: .75rem');
    expect(catppuccinCss).toContain('--sidebar-drone-weight: 800');
    expect(catppuccinCss).toContain('--sidebar-row-selected-bg: #313244');
    expect(catppuccinCss).toContain('--sidebar-meta-fg: #a6adc8');
    expect(catppuccinCss).toContain('--code-bg: #313244');
    expect(catppuccinCss).toContain('--code-fg: #b4befe');
    expect(catppuccinCss).toContain('--code-block-bg: #11111b');
    expect(catppuccinCss).toContain('--code-block-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--glow-accent: none');
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
