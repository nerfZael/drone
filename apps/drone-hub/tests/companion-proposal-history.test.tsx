import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompanionProposalHistory } from '../src/droneHub/companion/CompanionProposalHistory';

describe('Companion proposal history', () => {
  test('renders every executed operation with auto-approve and failure outcomes', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalHistory
        entries={[
          {
            id: 'history-one',
            proposal: {
              version: 1,
              title: 'Create reviewer',
              operations: [
                {
                  id: 'create',
                  type: 'create_drone',
                  name: 'Reviewer',
                  prompt: 'Review the change.',
                },
                {
                  id: 'message',
                  type: 'send_message',
                  droneId: '$create',
                  message: 'Run the tests.',
                },
              ],
            },
            execution: {
              ok: false,
              operations: [
                {
                  id: 'create',
                  type: 'create_drone',
                  status: 'completed',
                  result: { droneId: 'drone-created' },
                },
                {
                  id: 'message',
                  type: 'send_message',
                  status: 'failed',
                  error: 'Chat is unavailable',
                },
              ],
            },
            defaultRepoPath: '/workspace/repo',
            droneNames: {},
            startedAt: 1_000,
            completedAt: 2_000,
            autoApproved: true,
          },
        ]}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('Execution history');
    expect(html).toContain('1 proposal this session');
    expect(html).toContain('Partially applied');
    expect(html).toContain('Auto');
    expect(html).toContain('Create drone “Reviewer”');
    expect(html).toContain('Queue message to Reviewer / default');
    expect(html).toContain('Chat is unavailable');
    expect(html).toContain('drone-created');
  });
});
