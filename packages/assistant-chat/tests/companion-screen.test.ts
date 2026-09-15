import { describe, expect, test } from 'bun:test';
import { CompanionScreen } from '../src/CompanionScreen';

describe('Companion screen fit transactions', () => {
  test('inspects constraints and validates before rendering', () => {
    const screen = new CompanionScreen();
    expect(screen.execute({ action: 'inspect' })).toMatchObject({ constraints: { width: 0, maxCharacters: 8000 } });
    expect(screen.execute({ markdown: 'Hello' })).toMatchObject({ error: expect.stringContaining('SCREEN_UNAVAILABLE') });
    for (const markdown of ['<script>x</script>', '![image](url)', '```js\nx\n```', '| a | b |', 'x'.repeat(8001), '']) {
      expect(screen.execute({ markdown })).toMatchObject({ displayed: false, error: expect.any(String) });
    }
  });
  test('accepts exact fit and preserves it on overflow; allows correction', async () => {
    const screen = new CompanionScreen(); screen.resize(300, 100);
    const first = screen.execute({ markdown: '**Ready**' }); screen.measured(1, 300, 100);
    expect(await first).toMatchObject({ displayed: true });
    const second = screen.execute({ markdown: 'Too much' }); screen.measured(2, 300, 101);
    expect(await second).toMatchObject({ displayed: false, overflow: { height: 1 } });
    expect(screen.getSnapshot().markdown).toBe('**Ready**');
    const third = screen.execute({ markdown: 'Done' }); screen.measured(3, 300, 22);
    expect(await third).toMatchObject({ displayed: true });
  });
  test('resize, dismiss and unmount resolve pending work and ignore stale measurements', async () => {
    const screen = new CompanionScreen(); screen.resize(300, 100);
    const pending = screen.execute({ markdown: 'Hello' });
    expect(screen.execute({ markdown: 'Other' })).toMatchObject({ error: expect.stringContaining('DISPLAY_BUSY') });
    screen.resize(200, 50); screen.measured(1, 10, 10);
    expect(await pending).toMatchObject({ error: 'SCREEN_CHANGED' });
    expect(screen.getSnapshot().markdown).toBe('');
    const next = screen.execute({ markdown: 'Next' }); screen.execute({ action: 'clear' });
    expect(await next).toMatchObject({ error: 'DISPLAY_DISMISSED' });
    screen.detach(); expect(screen.constraints().width).toBe(0);
  });
});


test('changes to typography invalidate a fit even when pixel bounds do not change', async () => {
  const screen = new CompanionScreen(); screen.resize(300, 100, 'normal');
  const result = screen.execute({ markdown: 'Hello' }); screen.measured(1, 300, 22);
  expect(await result).toMatchObject({ displayed: true });
  screen.resize(300, 100, 'large');
  expect(screen.getSnapshot().markdown).toBe('');
  expect(screen.constraints().typography).toBe('large');
});

test('a missing layout callback times out and allows a new request', async () => {
  const screen = new CompanionScreen(); screen.resize(300, 100);
  expect(await screen.execute({ markdown: 'Hidden' })).toMatchObject({ error: expect.stringContaining('MEASUREMENT_TIMEOUT') });
  expect(screen.getSnapshot().candidate).toBeNull();
  const retry = screen.execute({ markdown: 'Visible' }); screen.measured(2, 300, 22);
  expect(await retry).toMatchObject({ displayed: true });
}, 7000);
