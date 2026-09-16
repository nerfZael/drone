import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const html = readFileSync(new URL('../../drone/desktop/hub-notification.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../drone/desktop/hub-notification-renderer.js', import.meta.url), 'utf8');

test('card renders untrusted message text safely and wires dismissal, navigation, and hover pause', async () => {
  const window = new Window();
  const actions: string[] = [];
  const payload = { title: 'Reviewer failed', name: '<img src=x onerror=alert(1)>', kind: 'failed', body: '<script>attack()</script>' };
  Object.assign(window, { notificationCard: { read: async () => payload, action: (value: string) => actions.push(value) } });
  window.document.write(html.replace(/<script src=.*?<\/script>/, ''));
  try {
    new Function('window', 'document', script)(window, window.document);
    await Promise.resolve(); await Promise.resolve();
    expect(window.document.getElementById('name')!.textContent).toBe(payload.name);
    expect(window.document.querySelector('img')).toBeNull();
    expect(window.document.querySelector('.card.failed')).not.toBeNull();
    expect(window.document.getElementById('body')!.textContent).toBe(payload.body);
    expect(actions).toEqual(['ready']);
    window.document.body.dispatchEvent(new window.MouseEvent('mouseenter'));
    window.document.body.dispatchEvent(new window.MouseEvent('mouseleave'));
    window.document.getElementById('close')!.click();
    window.document.getElementById('open')!.click();
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(actions).toEqual(['ready', 'pause', 'resume', 'dismiss', 'open', 'dismiss']);
  } finally { await window.happyDOM.close(); }
});
