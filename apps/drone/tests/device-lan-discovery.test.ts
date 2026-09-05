import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
import {
  DeviceLanDiscovery,
  isPrivatePairingIPv4,
} from '../src/hub/device-mesh/device-lan-discovery';

function fixture(endpoint: string | null = 'https://desktop.tail.ts.net:8791') {
  const browser = Object.assign(new EventEmitter(), {
    stop: () => {
      stopped++;
    },
  });
  const service = Object.assign(new EventEmitter(), { published: true, activated: true });
  let created = 0,
    destroyed = 0,
    stopped = 0,
    goodbyes = 0;
  let advertised: any;
  let fail: (error: Error) => void = () => {};
  const discovery = new DeviceLanDiscovery(
    { id: 'hub-id', name: 'Desktop' },
    () => endpoint,
    (onError) => {
      created++;
      fail = onError;
      return {
        find: () => browser,
        publish: (config: any) => {
          advertised = config;
          return service;
        },
        unpublishAll: (done: () => void) => {
          goodbyes++;
          done();
        },
        destroy: () => {
          destroyed++;
        },
      } as any;
    },
  );
  return {
    discovery,
    browser,
    service,
    fail: (error: Error) => fail(error),
    counts: () => ({ created, destroyed, stopped, goodbyes }),
    ad: () => advertised,
  };
}
const lease = 'test-pairing-window-123';

test('LAN discovery is off until leased and publishes only public bootstrap metadata', () => {
  const f = fixture();
  try {
    expect(f.counts().created).toBe(0);
    expect(f.discovery.renew(lease, true)).toEqual({ active: true, error: '' });
    expect(f.ad()).toMatchObject({
      type: 'dronehub',
      port: 8791,
      txt: { kind: 'hub', v: '1', endpoint: 'https://desktop.tail.ts.net:8791' },
    });
    f.discovery.renew(lease, true);
    expect(f.counts().created).toBe(1);
    f.discovery.renew(lease, false);
    expect(f.counts()).toEqual({ created: 1, destroyed: 1, stopped: 1, goodbyes: 1 });
  } finally {
    f.discovery.close();
  }
});

test('multiple windows retain discovery until the last lease ends; expired windows cannot keep it alive', () => {
  const f = fixture();
  const now = Date.now;
  try {
    f.discovery.renew(lease, true);
    f.discovery.renew('another-pairing-window', true);
    f.discovery.renew(lease, false);
    expect(f.counts().destroyed).toBe(0);
    Date.now = () => now() + 46000;
    f.discovery.renew(lease, false);
    expect(f.counts().destroyed).toBe(1);
  } finally {
    Date.now = now;
    f.discovery.close();
  }
});

test('LAN phones must advertise the fixed bootstrap port and private canonical addresses', () => {
  const f = fixture();
  try {
    f.discovery.renew(lease, true);
    const phone = {
      fqdn: 'phone.local',
      name: 'Phone',
      txt: { v: '1', kind: 'phone' },
      port: 8792,
      addresses: ['127.0.0.1', '8.8.8.8', '192.168.1.5'],
    };
    f.browser.emit('up', { ...phone, port: 80 });
    expect(f.discovery.phonePeers()).toEqual([]);
    f.browser.emit('up', phone);
    expect(f.discovery.phonePeers()).toEqual([{ name: 'Phone', ips: ['192.168.1.5'] }]);
    f.browser.emit('down', phone);
    expect(f.discovery.phonePeers()).toEqual([]);
    f.discovery.close();
    f.browser.emit('up', phone);
    expect(f.discovery.phonePeers()).toEqual([]);
  } finally {
    f.discovery.close();
  }
});

test('discovery errors stop networking and become retryable status instead of crashing', () => {
  const f = fixture();
  try {
    f.discovery.renew(lease, true);
    f.fail(new Error('UDP access denied'));
    expect(f.discovery.renew(lease, true)).toEqual({
      active: false,
      error: 'Local-network discovery unavailable: UDP access denied',
    });
    expect(f.counts().destroyed).toBe(1);
  } finally {
    f.discovery.close();
  }
  for (const endpoint of [
    null,
    'http://localhost:8791',
    'https://user:secret@hub.local',
    'https://hub.local/path',
  ]) {
    const invalid = fixture(endpoint);
    try {
      expect(invalid.discovery.renew(lease, true).active).toBe(false);
      expect(invalid.counts().created).toBe(0);
    } finally {
      invalid.discovery.close();
    }
  }
});

test('private LAN addresses exclude loopback, public, tailnet, malformed and non-canonical addresses', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.0.2', '169.254.2.3'])
    expect(isPrivatePairingIPv4(ip)).toBe(true);
  for (const ip of [
    '127.0.0.1',
    '0.0.0.0',
    '8.8.8.8',
    '100.64.0.1',
    '172.32.0.1',
    '192.168.01.2',
    '10.0.0.256',
    '::1',
    '10.1.2',
  ])
    expect(isPrivatePairingIPv4(ip)).toBe(false);
});
