import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TailscaleSetupAlert } from '../src/droneHub/app/DeviceMeshIngressPanel';

test('HTTPS setup errors offer DNS settings, retry, and collapsed escaped details', () => {
  const html = renderToStaticMarkup(
    <TailscaleSetupAlert
      busy={false}
      onRetry={() => {}}
      error={{
        code: 'TAILSCALE_HTTPS_REQUIRED',
        message: 'Enable HTTPS in Tailscale first',
        details: '<command output>',
      }}
    />,
  );
  expect(html).toContain('https://login.tailscale.com/admin/dns');
  expect(html).toContain('Open Tailscale DNS settings');
  expect(html).toContain('Retry');
  expect(html).toContain('<details>');
  expect(html).toContain('&lt;command output&gt;');
});

test('other errors do not suggest HTTPS is disabled and retry is disabled while busy', () => {
  const html = renderToStaticMarkup(
    <TailscaleSetupAlert
      busy
      onRetry={() => {}}
      error={{
        code: 'TAILSCALE_TIMEOUT',
        message: 'Tailscale setup timed out',
        details: '',
      }}
    />,
  );
  expect(html).not.toContain('admin/dns');
  expect(html).not.toContain('<details>');
  expect(html).toContain('disabled');
});
