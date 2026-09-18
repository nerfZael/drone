import { expect, test } from 'bun:test';
import { companionAttachmentText, isCompanionTextAttachment, zoomedView } from '../src/droneHub/companion/CompanionAttachmentDialog';

test('zooming keeps the point under the pointer fixed and snaps back to fit', () => {
  const fit = { scale: 1, x: 0, y: 0 };
  const zoomed = zoomedView(fit, 2, 100, -40);
  // An image point drawn at p = t + s*q stays put: q = (100, -40) at scale 1 must still land on (100, -40).
  expect(zoomed).toEqual({ scale: 2, x: -100, y: 40 });
  expect(zoomed.x + zoomed.scale * 100).toBe(100);
  expect(zoomedView(zoomed, 0.1, 5, 5)).toEqual(fit);
  expect(zoomedView(fit, 1000, 0, 0).scale).toBe(12);
});

test('text attachments decode as UTF-8 and only text/plain counts as text', () => {
  expect(companionAttachmentText({ dataBase64: Buffer.from('héllo ✓').toString('base64') })).toBe('héllo ✓');
  expect(isCompanionTextAttachment({ mime: 'text/plain' })).toBe(true);
  expect(isCompanionTextAttachment({ mime: 'image/png' })).toBe(false);
});
