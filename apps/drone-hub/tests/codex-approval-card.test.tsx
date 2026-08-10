import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CodexApprovalCard } from '../src/droneHub/assistant/CodexApprovalCard';

test('Codex approval card exposes one-shot, session, deny, and cancel decisions', () => {
  const html = renderToStaticMarkup(
    <CodexApprovalCard
      approval={{
        id: 'approval-1',
        promptId: 'prompt-1',
        method: 'item/commandExecution/requestApproval',
        kind: 'command_execution',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'command-1',
        command: 'bun test',
        cwd: '/workspace',
        reason: 'Run focused tests',
        availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
        createdAt: '2026-08-10T10:00:00.000Z',
        status: 'pending',
      }}
      busy={false}
      onDecision={() => undefined}
    />,
  );

  expect(html).toContain('Run command');
  expect(html).toContain('bun test');
  expect(html).toContain('/workspace');
  expect(html).toContain('Approve once');
  expect(html).toContain('Approve for session');
  expect(html).toContain('Deny');
  expect(html).toContain('Cancel');
});

test('Codex approval card does not render commands as markdown or approve truncated details', () => {
  const html = renderToStaticMarkup(
    <CodexApprovalCard
      approval={{
        id: 'approval-2',
        promptId: 'prompt-2',
        method: 'item/commandExecution/requestApproval',
        kind: 'command_execution',
        threadId: 'thread-2',
        turnId: 'turn-2',
        itemId: 'command-2',
        command: 'echo hi\n```\n# still command text',
        detailsTruncated: true,
        availableDecisions: ['accept', 'decline'],
        createdAt: '2026-08-10T10:00:00.000Z',
        status: 'pending',
      }}
      busy={false}
      onDecision={() => undefined}
    />,
  );

  expect(html).toContain('```');
  expect(html).not.toContain('dh-markdown');
  expect(html).toContain('Some request details are unavailable');
  expect(html).toContain('disabled=""');
});
