import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeaderActionButton } from '../src/droneHub/app/HeaderActionButton';

describe('HeaderActionButton', () => {
  test('shares the flat, visible header action treatment', () => {
    const html = renderToStaticMarkup(<HeaderActionButton>SSH</HeaderActionButton>);

    expect(html).toContain('dh-type-header-action');
    expect(html).toContain('h-7');
    expect(html).toContain('px-2.5');
    expect(html).toContain('border-transparent');
    expect(html).toContain('bg-transparent');
    expect(html).toContain('text-[var(--fg-secondary)]');
    expect(html).toContain('SSH');
    expect(html).not.toContain('data-unavailable');
  });

  test('keeps unavailable styling and behavior in sync', () => {
    const html = renderToStaticMarkup(
      <HeaderActionButton disabled aria-label="Opening SSH">
        SSH
      </HeaderActionButton>,
    );

    expect(html).toContain('data-unavailable="true"');
    expect(html).toContain('disabled=""');
  });
});
