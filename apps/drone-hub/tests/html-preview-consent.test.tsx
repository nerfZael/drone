import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { IsolatedHtmlPreview } from '../src/droneHub/files/IsolatedHtmlPreview';
import { appDialogQueue } from '../src/ui/AppConfirmDialog';
import { HTML_PREVIEW_LINK_MESSAGE } from '../src/droneHub/files/html-preview-security';

test('external resources need consent, can be revoked, and do not carry to a new preview', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const detach = appDialogQueue.attachHost();
  const render = async (fileName = 'one.html', source = '<h1>Hello</h1>') => {
    await act(async () => root.render(<IsolatedHtmlPreview source={source} fileName={fileName} />));
  };
  const click = async () => { await act(async () => host.querySelector('button')!.click()); };
  const settle = async (answer: boolean) => { await act(async () => appDialogQueue.settle(answer)); };
  const isolated = () => expect(host.querySelector('iframe')!.getAttribute('srcdoc')).toContain("connect-src 'none'");
  try {
    await render();
    isolated();
    await click();
    expect(appDialogQueue.current()?.message).toContain('send this file’s contents');
    isolated();
    await settle(false);
    isolated();
    await click();
    await settle(true);
    const enabledFrame = host.querySelector('iframe')!;
    expect(enabledFrame.getAttribute('srcdoc')).toContain('connect-src http: https: ws: wss:');
    expect(enabledFrame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(enabledFrame.hasAttribute('credentialless')).toBe(true);
    await click();
    isolated();
    expect(host.querySelector('iframe')).not.toBe(enabledFrame);
    await click();
    await settle(true);
    await render('two.html');
    isolated();
    await click();
    await render('three.html');
    await settle(true);
    isolated();
    await click();
    await settle(true);
    await render('three.html', '<h1>Changed</h1>');
    isolated();
  } finally {
    await act(async () => root.unmount());
    detach();
    await dom.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});

test('links clicked in the preview are handed to the Hub, from its own frame only', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const opened: string[] = [];
  const post = (source: unknown, data: unknown) => dom.dispatchEvent(new dom.MessageEvent('message', { data, source: source as any }));
  try {
    await act(async () => root.render(<IsolatedHtmlPreview source={'<a href="menus/round-2.html">Menus</a>'} fileName="index.html" onOpenLink={href => opened.push(href)} />));
    const frame = host.querySelector('iframe')!;
    expect(frame.getAttribute('srcdoc')).toContain(`type: '${HTML_PREVIEW_LINK_MESSAGE}', href: rawHref`);
    post(frame.contentWindow, { type: HTML_PREVIEW_LINK_MESSAGE, href: 'menus/round-2.html' });
    post(dom, { type: HTML_PREVIEW_LINK_MESSAGE, href: '/etc/passwd' });
    post(frame.contentWindow, { type: 'other', href: 'nope.html' });
    expect(opened).toEqual(['menus/round-2.html']);
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
