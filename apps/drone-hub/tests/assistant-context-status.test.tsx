import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AssistantCompactionRow,
  AssistantCompactionWorkingRow,
  AssistantContextUsageIndicator,
} from '../src/droneHub/assistant/AssistantContextStatus';

describe('assistant context status', () => {
  test('renders durable compaction details in the transcript', () => {
    const html = renderToStaticMarkup(
      <AssistantCompactionRow
        details={{
          summaryId: 'compact-1',
          trigger: 'auto',
          tokensBefore: 90_000,
          tokensAfter: 24_000,
          fallbackUsed: true,
        }}
      />,
    );

    expect(html).toContain('data-assistant-compaction="true"');
    expect(html).toContain('Context compacted');
    expect(html).toContain('90K');
    expect(html).toContain('24K tokens');
    expect(html).toContain('Automatic');
    expect(html).toContain('Fallback summary');
  });

  test('renders effective context usage as an accessible progress circle', () => {
    const html = renderToStaticMarkup(
      <AssistantContextUsageIndicator
        usage={{
          tokens: 24_000,
          contextWindow: 128_000,
          percent: 18.75,
          confidence: 'heuristic',
        }}
      />,
    );

    expect(html).toContain('data-assistant-context-usage="true"');
    expect(html).toContain('role="img"');
    expect(html).toContain('Context: 24K of 128K tokens (19%, estimated)');
    expect(html).toContain('>19<');
    expect(html).toContain('stroke-dashoffset');
  });

  test('shows a live status while compaction is running', () => {
    const html = renderToStaticMarkup(<AssistantCompactionWorkingRow />);

    expect(html).toContain('data-assistant-compaction-working="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Compacting context');
  });
});
