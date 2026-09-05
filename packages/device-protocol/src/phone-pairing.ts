import { canonicalJson } from './canonical-json';
import type { DevicePublicIdentity } from './types';

export const PHONE_PAIRING_PORT = 8792;
export const PHONE_PAIRING_PATH = '/.well-known/dronehub-phone';
export type PhonePairingPresence = {
  type: 'dronehub.phone.presence';
  version: 1;
  session: string;
  expiresAt: string;
  device: DevicePublicIdentity;
};
export type PhonePairingOffer = {
  type: 'dronehub.phone.offer';
  version: 1;
  session: string;
  phoneDeviceId: string;
  hub: DevicePublicIdentity;
  endpoint: string;
  nonce: string;
  expiresAt: string;
};
export function phonePairingSigningText(value: PhonePairingPresence | PhonePairingOffer): string {
  return `dronehub-phone-pairing-v1\n${canonicalJson(value)}`;
}
export function phonePairingCodeText(offer: PhonePairingOffer): string {
  return `dronehub-phone-confirm-v1\n${canonicalJson(offer)}`;
}
export function phonePairingCode(digestHex: string): string {
  // Offers are public before confirmation: a six-digit code permits cheap offline grinding.
  if (!/^[a-f0-9]{64}$/i.test(digestHex)) throw new Error('Invalid pairing digest');
  return digestHex.slice(0, 16).toUpperCase().match(/.{4}/g)!.join('-');
}
export function validPhonePairingWindow(expiresAt: string, now = Date.now()): boolean {
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires > now && expires <= now + 125_000;
}
