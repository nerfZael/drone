import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompanionProposalHistory } from '../src/droneHub/companion/CompanionProposalHistory';

describe('Companion proposal history', () => {
  test('renders completed proposals as openable history entries without a count', () => {
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
    expect(html).toContain('Completed proposals from this session');
    expect(html).not.toContain('1 proposal this session');
    expect(html).toContain('Partially applied');
    expect(html).toContain('Auto');
    expect(html).toContain('Open execution details for Create reviewer');
    expect(html).not.toContain('Chat is unavailable');
  });
});
