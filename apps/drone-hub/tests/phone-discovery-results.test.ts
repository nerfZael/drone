import { expect, test } from 'bun:test';
import {
  mergeDiscoveredPhones,
  type DiscoveredPhone,
} from '../src/droneHub/app/phone-discovery-results';

const now = Date.now();
const phone = (id: string, expiry = now + 10000): DiscoveredPhone => ({
  deviceId: id,
  name: id,
  machineName: id,
  expiresAt: new Date(expiry).toISOString(),
});
test('empty Wi-Fi results do not erase phones found over Tailscale', () => {
  const tail = phone('cellular');
  expect(mergeDiscoveredPhones([tail], [], now)).toEqual([tail]);
  expect(mergeDiscoveredPhones([tail], [phone('wifi')], now)).toHaveLength(2);
});
test('results deduplicate by identity, prefer fresh sessions and remove expired entries', () => {
  const old = phone('same', now + 1000);
  const fresh = phone('same');
  expect(mergeDiscoveredPhones([fresh], [old], now)).toEqual([fresh]);
  expect(mergeDiscoveredPhones([old], [fresh], now)).toEqual([fresh]);
  expect(
    mergeDiscoveredPhones([phone('expired', now)], [{ ...fresh, expiresAt: 'invalid' }], now),
  ).toEqual([]);
});
