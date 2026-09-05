import {
  phonePairingSigningText,
  validPhonePairingWindow,
  type PhonePairingOffer,
} from '@drone/device-protocol';
import { verifyP256Signature } from '../security/p256-signature';
import { hubDiscoveryEndpoints } from './discover-hub';

export async function verifyPhoneOffer(
  input: any,
  session: string,
  phoneId: string,
  keyId: (key: JsonWebKey) => Promise<string>,
): Promise<PhonePairingOffer> {
  const { signature, ...offer } = input;
  if (
    offer.type !== 'dronehub.phone.offer' ||
    offer.version !== 1 ||
    offer.session !== session ||
    offer.phoneDeviceId !== phoneId ||
    !validPhonePairingWindow(offer.expiresAt) ||
    !/^[a-zA-Z0-9_-]{20,128}$/.test(offer.nonce) ||
    typeof offer.hub?.name !== 'string' ||
    offer.hub.name.length > 80 ||
    (await keyId(offer.hub.publicKey)) !== offer.hub.id ||
    !verifyP256Signature(offer.hub.publicKey, phonePairingSigningText(offer), signature) ||
    hubDiscoveryEndpoints(offer.endpoint)[0] !== offer.endpoint ||
    !offer.endpoint.startsWith('https://')
  )
    throw new Error('Invalid phone pairing offer');
  return offer;
}
