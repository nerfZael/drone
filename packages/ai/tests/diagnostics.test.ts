import { describe, expect, test } from 'vitest';
import { extractDiagnosticError } from '../src/utils/diagnostics.js';

describe('assistant diagnostics', () => {
  test('preserves a bounded nested transport cause', () => {
    const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const error = new TypeError('fetch failed', { cause });

    expect(extractDiagnosticError(error)).toMatchObject({
      name: 'TypeError',
      message: 'fetch failed',
      cause: {
        name: 'Error',
        message: 'socket hang up',
        code: 'ECONNRESET',
      },
    });
  });
});
