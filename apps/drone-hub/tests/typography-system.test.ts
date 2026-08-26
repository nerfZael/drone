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
    expect(styles).toContain('--chat-text-size: .875rem;');
    expect(styles).toContain('--chat-question-size: .9375rem;');
    expect(styles).toContain('--document-text-size: .9375rem;');
    expect(styles).toContain('--document-prose-max: 76ch;');
    expect(styles).toContain('--chat-interactive-max: 48rem;');
    expect(styles).toContain('--weight-semibold: var(--weight-emphasis);');
    expect(styles).toContain('--weight-bold: var(--weight-strong);');
    expect(styles).toContain('--text-10-5: var(--type-caption);');
    expect(styles).toContain('--text-11-5: var(--type-compact);');
    expect(styles).toContain('--text-12-5: var(--type-ui);');
  });

  test('gives full documents a quieter, bounded reading measure', () => {
    const styles = readSource('../src/styles.css');

    expect(styles).toContain('max-width: calc(var(--document-prose-max) + 3.5rem);');
    expect(styles).toContain('font-size: var(--document-text-size);');
    expect(styles).toContain('line-height: 1.65;');
    expect(styles).toContain('.dh-markdown.dh-markdown--document a {');
    expect(styles).toContain('color: color-mix(in srgb, var(--link) 72%, var(--fg-secondary));');
  });

  test('offers a semantic comfortable reading scale without theme overrides', () => {
    const styles = readSource('../src/styles.css');
    const settings = readSource('../src/droneHub/app/GeneralSettingsTab.tsx');

    expect(styles).toContain(":root[data-reading-density='comfortable'] {");
    expect(styles).toContain('--chat-text-size: .9375rem;');
    expect(styles).toContain('--document-text-size: 1rem;');
    expect(settings).toContain('label="Reading density"');
    expect(settings).toContain("{ value: 'comfortable', label: 'Comfortable' }");
  });

  test('keeps shared primitives on reusable semantic roles', () => {
    const button = readSource('../src/ui/components/Button.tsx');
    const field = readSource('../src/ui/components/FormControls.tsx');
    const panel = readSource('../src/ui/components/Panel.tsx');
    const dropdown = readSource('../src/ui/dropdown.ts');
    const componentLibrary = readSource('../src/droneHub/app/ComponentLibraryPreview.tsx');

    expect(button).toContain('dh-type-control');
    expect(button).not.toContain("fontFamily: 'var(--display)'");
    expect(field).toContain('dh-type-label');
    expect(field).toContain('dh-type-supporting');
    expect(panel).toContain('dh-type-heading');
    expect(dropdown).toContain('dh-type-menu-item');
    expect(componentLibrary).toContain('Readable content hierarchy');
    for (const role of ['primary', 'secondary', 'supporting', 'disabled']) {
      expect(componentLibrary).toContain(`dh-tone-${role}`);
    }
  });

  test('reuses one API key card instead of duplicating provider controls', () => {
    const settings = readSource('../src/droneHub/app/GeneralSettingsTab.tsx');

    expect(settings.match(/<ApiKeySettingsCard/g)?.length).toBe(3);
    expect(settings).toContain('<UiSegmentedControl');
    expect(settings).toContain('name="openai-api-key"');
  });
});
