import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DroneHubDiscoveryStatus } from '../src/droneHub/app/DeviceMeshIngressPanel';

test('discovery reports progress, empty results, and result counts accessibly', () => {
  const render = (state: Parameters<typeof DroneHubDiscoveryStatus>[0]['state']) =>
    renderToStaticMarkup(<DroneHubDiscoveryStatus state={state} />);
  expect(render({ phase: 'idle' })).toBe('');
  expect(render({ phase: 'scanning' })).toContain('Looking for DroneHubs');
  const empty = render({ phase: 'done', count: 0 });
  expect(empty).toContain('No computers found.');
  expect(empty).toContain('Check Tailscale access');
  expect(empty).toContain('role="status"');
  expect(render({ phase: 'done', count: 1 })).toContain('Found 1 DroneHub.');
  expect(render({ phase: 'done', count: 2 })).toContain('Found 2 DroneHubs.');
  const failure = render({ phase: 'failed', message: 'Tailscale is not connected' });
  expect(failure).toContain('Tailscale is not connected');
  expect(failure).not.toContain('No computers found.');
});
