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

  test('maps Catppuccin desktop surfaces into a quiet visual hierarchy', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const catppuccinStart = css.indexOf(":root[data-theme='catppuccin-mocha']");
    const catppuccinEnd = css.indexOf('/* Excalidraw owns', catppuccinStart);
    const catppuccinCss = css.slice(catppuccinStart, catppuccinEnd);

    expect(catppuccinCss).toContain('--workspace: #1e1e2e');
    expect(catppuccinCss).toContain('--panel: #181825');
    expect(catppuccinCss).toContain('--panel-raised: #313244');
    expect(catppuccinCss).toContain('--border: rgba(69, 71, 90, .56)');
    expect(catppuccinCss).toContain('--fg-strong: #cdd6f4');
    expect(catppuccinCss).toContain('--muted: #a6adc8');
    expect(catppuccinCss).toContain('--muted-dim: #7f849c');
    expect(catppuccinCss).toContain('--border-subtle: rgba(49, 50, 68, .78)');
    expect(catppuccinCss).toContain('--assistant-message-fg: #bac2de');
    expect(catppuccinCss).toContain('--chat-list-marker: #7f849c');
    expect(catppuccinCss).toContain('--user-bubble: #313244');
    expect(catppuccinCss).toContain('--user-bubble-border: rgba(69, 71, 90, .48)');
    expect(catppuccinCss).toContain('--user-bubble-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--chat-background: #1e1e2e');
    expect(catppuccinCss).toContain('--chat-user-message-time: #a6adc8');
    expect(catppuccinCss).toContain('--chat-composer-border: rgba(69, 71, 90, .56)');
    expect(catppuccinCss).toContain('--chat-composer-focus-border: rgba(203, 166, 247, .26)');
    expect(catppuccinCss).toContain('--chat-composer-surface: #313244');
    expect(catppuccinCss).toContain('--chat-composer-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--chat-composer-placeholder: #7f849c');
    expect(catppuccinCss).toContain('--chat-composer-control-bg: rgba(69, 71, 90, .34)');
    expect(catppuccinCss).toContain('--chat-composer-control-border: transparent');
    expect(catppuccinCss).toContain('--chat-composer-control-fg: #a6adc8');
    expect(catppuccinCss).toContain('--chat-composer-model-fg: #9399b2');
    expect(catppuccinCss).toContain('--chat-composer-font: system-ui, -apple-system, sans-serif');
    expect(catppuccinCss).toContain('--chat-composer-radius: .4375rem');
    expect(catppuccinCss).toContain('--chat-composer-control-radius: .3125rem');
    expect(catppuccinCss).toContain('--chat-composer-shadow: 0 .25rem .875rem rgba(17, 17, 27, .18)');
    expect(catppuccinCss).toContain('--chat-composer-input: #313244');
    expect(catppuccinCss).toContain('--app-header-bg: #181825');
    expect(catppuccinCss).toContain('--app-header-border: rgba(69, 71, 90, .52)');
    expect(catppuccinCss).toContain('--workspace-header-title-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--sidebar-bg: #181825');
    expect(catppuccinCss).toContain('--sidebar-section-bg: #181825');
    expect(catppuccinCss).toContain('--sidebar-section-border: rgba(49, 50, 68, .78)');
    expect(catppuccinCss).toContain('--sidebar-tab-active-bg: transparent');
    expect(catppuccinCss).toContain('--sidebar-create-bg: transparent');
    expect(catppuccinCss).toContain('--sidebar-create-border: transparent');
    expect(catppuccinCss).toContain('--sidebar-create-hover-bg: #313244');
    expect(catppuccinCss).toContain('--toolbar-control-bg: transparent');
    expect(catppuccinCss).toContain('--toolbar-control-border: transparent');
    expect(catppuccinCss).toContain('--toolbar-control-hover-border: rgba(69, 71, 90, .68)');
    expect(catppuccinCss).toContain('--sidebar-brand-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--sidebar-brand-size: .9375rem');
    expect(catppuccinCss).toContain('--sidebar-brand-weight: 700');
    expect(catppuccinCss).toContain('--sidebar-heading-weight: 600');
    expect(catppuccinCss).toContain('--sidebar-drone-fg: #a6adc8');
    expect(catppuccinCss).toContain('--sidebar-drone-active-fg: #cdd6f4');
    expect(catppuccinCss).toContain('--sidebar-drone-size: .75rem');
    expect(catppuccinCss).toContain('--sidebar-drone-weight: 500');
    expect(catppuccinCss).toContain('--sidebar-row-selected-bg: rgba(49, 50, 68, .44)');
    expect(catppuccinCss).toContain('--sidebar-meta-fg: #7f849c');
    expect(catppuccinCss).toContain('--selected: rgba(69, 71, 90, .34)');
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
