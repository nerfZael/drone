import { describe, expect, test } from 'bun:test';
import { parseLsOutput, parsePortsOutput } from '../src/host/dvm';

describe('drone host regression behavior', () => {
  test('parses dvm ls output into stable unique drone names', () => {
    const text = [
      'Name: auth-api',
      '  Image: node:20',
      'Name: billing-worker',
      '  Status: running',
      'Name: auth-api',
      'noise line',
    ].join('\n');

    expect(parseLsOutput(text)).toEqual(['auth-api', 'billing-worker']);
  });

  test('parses host/container ports and ignores noisy lines', () => {
    const text = [
      '3001:3000',
      'not-a-port-line',
      '  8080:80 ',
      '',
      'abc:123',
    ].join('\n');

    expect(parsePortsOutput(text)).toEqual([
      { hostPort: 3001, containerPort: 3000 },
      { hostPort: 8080, containerPort: 80 },
    ]);
  });
});
