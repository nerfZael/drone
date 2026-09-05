import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeviceCard } from '../src/droneHub/app/DeviceMeshSettingsTab';
import { PhoneDiscoveryPanel } from '../src/droneHub/app/PhoneDiscoveryPanel';

test('device rows keep permissions and destructive actions inside a closed disclosure', () => {
  const markup = renderToStaticMarkup(
    <DeviceCard
      device={{
        id: 'phone',
        name: 'My phone',
        platform: 'android',
        administrator: false,
        grants: [],
        endpoints: [],
        revokedAt: null,
      }}
      selfDeviceId="desktop"
      connected={true}
      capabilities={[{ id: 'test', version: 1, operations: ['read'] }]}
      busy={false}
      onSave={() => {}}
      onRevoke={() => {}}
    />,
  );
  expect(markup).toContain('My phone');
  expect(markup).toContain('Permissions &amp; settings');
  expect(markup).not.toMatch(/<details[^>]*\bopen/);
  const disclosure = markup.slice(markup.indexOf('<details'), markup.indexOf('</details>'));
  expect(disclosure).toContain('Administrator');
  expect(disclosure).toContain('Save device');
  expect(disclosure).toContain('Revoke');
  expect(disclosure).toContain('test');
});

test('phone discovery retains controls without repeating a setup tutorial', () => {
  const markup = renderToStaticMarkup(
    <PhoneDiscoveryPanel
      requestJson={async () => {
        throw new Error('No requests during render');
      }}
    />,
  );
  expect(markup).toContain('Phones');
  expect(markup).toContain('Find phones');
  expect(markup).toContain('aria-label="Stop nearby discovery"');
  expect(markup).not.toContain('Phone discovery uses');
  expect(markup).not.toContain('Network &amp; pairing');
});
