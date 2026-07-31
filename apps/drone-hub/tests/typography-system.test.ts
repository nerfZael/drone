import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('desktop typography system', () => {
  test('separates native UI chrome, prose, brand, and code faces', () => {
    const styles = readSource('../src/styles.css');

    expect(styles).toContain("--ui: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;");
    expect(styles).toContain("--prose: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;");
    expect(styles).toContain("--brand-display: 'Chakra Petch', system-ui, sans-serif;");
    expect(styles).toContain('--display: var(--ui);');
    expect(styles).toContain('--sans: var(--ui);');
    expect(styles).toContain('font: var(--chat-text-size)/1.65 var(--prose);');
    expect(styles).toContain('font-family: var(--brand-display);');
  });

  test('collapses legacy fractional sizes onto a crisp semantic scale', () => {
    const styles = readSource('../src/styles.css');

    expect(styles).toContain('--type-micro: 10px;');
    expect(styles).toContain('--type-caption: 11px;');
    expect(styles).toContain('--type-compact: 12px;');
    expect(styles).toContain('--type-ui: 13px;');
    expect(styles).toContain('--type-prose: 14px;');
    expect(styles).toContain('--weight-ui: 400;');
    expect(styles).toContain('--weight-emphasis: 500;');
    expect(styles).toContain('--weight-semibold: var(--weight-ui);');
    expect(styles).toContain('--text-10-5: var(--type-caption);');
    expect(styles).toContain('--text-11-5: var(--type-compact);');
    expect(styles).toContain('--text-12-5: var(--type-ui);');
  });

  test('keeps shared primitives on reusable semantic roles', () => {
    const button = readSource('../src/ui/components/Button.tsx');
    const field = readSource('../src/ui/components/FormControls.tsx');
    const panel = readSource('../src/ui/components/Panel.tsx');
    const dropdown = readSource('../src/ui/dropdown.ts');

    expect(button).toContain('dh-type-control');
    expect(button).not.toContain("fontFamily: 'var(--display)'");
    expect(field).toContain('dh-type-label');
    expect(field).toContain('dh-type-supporting');
    expect(panel).toContain('dh-type-heading');
    expect(dropdown).toContain('dh-type-menu-item');
  });

  test('reuses one API key card instead of duplicating provider controls', () => {
    const settings = readSource('../src/droneHub/app/GeneralSettingsTab.tsx');

    expect(settings.match(/<ApiKeySettingsCard/g)?.length).toBe(3);
    expect(settings).toContain('<UiSegmentedControl');
    expect(settings).toContain('name="openai-api-key"');
  });
});
