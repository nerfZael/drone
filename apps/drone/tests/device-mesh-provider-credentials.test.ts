import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { providerCredentialEnvelopeSigningText, type MeshDevice } from '@drone/device-protocol';
import { signDeviceText, type LocalDeviceIdentity } from '../src/hub/device-mesh/device-identity';
import { createProviderCredentialsCapability } from '../src/hub/device-mesh/features/provider-credentials/provider-credentials-capability';
import {
  createProviderCredentialRequest,
  openProviderCredential,
  sealProviderCredential,
} from '../src/hub/device-mesh/features/provider-credentials/provider-credential-envelope';
import { upsertStoredProviderApiKey } from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

function identity(id: string): LocalDeviceIdentity {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    id,
    name: id,
    platform: 'desktop',
    publicKey: pair.publicKey.export({ format: 'jwk' }),
    privateKey: pair.privateKey,
  };
}

function device(id: string, administrator: boolean): MeshDevice {
  return {
    ...identity(id),
    administrator,
    grants: [],
    endpoints: [],
    revokedAt: null,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function tamperBase64Url(value: string): string {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}

describe('provider credential transfer', () => {
  test('encrypts for one recipient and rejects tampering', () => {
    const transfer = createProviderCredentialRequest();
    const sender = identity('desktop_1');
    const unsignedEnvelope = sealProviderCredential({
      request: transfer.request,
      credential: 'openai',
      plaintext: JSON.stringify({ kind: 'openai-api-key', apiKey: 'test-secret' }),
      senderDeviceId: 'desktop_1',
      recipientDeviceId: 'phone_1',
    });
    const envelope = {
      ...unsignedEnvelope,
      signature: signDeviceText(
        sender,
        providerCredentialEnvelopeSigningText(unsignedEnvelope, 'desktop_1', 'phone_1'),
      ),
    };
    expect(
      openProviderCredential({
        envelope,
        privateKey: transfer.privateKey,
        senderDeviceId: 'desktop_1',
        recipientDeviceId: 'phone_1',
        senderIdentityPublicKey: sender.publicKey,
      }),
    ).toContain('test-secret');
    expect(() =>
      openProviderCredential({
        envelope: { ...envelope, ciphertext: tamperBase64Url(envelope.ciphertext) },
        privateKey: transfer.privateKey,
        senderDeviceId: 'desktop_1',
        recipientDeviceId: 'phone_1',
        senderIdentityPublicKey: sender.publicKey,
      }),
    ).toThrow();
    expect(() =>
      openProviderCredential({
        envelope: { ...envelope, signature: tamperBase64Url(envelope.signature) },
        privateKey: transfer.privateKey,
        senderDeviceId: 'desktop_1',
        recipientDeviceId: 'phone_1',
        senderIdentityPublicKey: sender.publicKey,
      }),
    ).toThrow('signature');
  });

  test('requires the requesting device to be an administrator', async () => {
    const capability = createProviderCredentialsCapability(identity('desktop_1'));
    await expect(
      capability.invoke(
        'credentials.inspect',
        {},
        {
          sourceDevice: device('phone_1', false),
          requestId: 'request_1',
        },
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });

  test('exports an OpenRouter API key to an administrator device', async () => {
    await withTempDroneDataDir('provider-credential-openrouter-', async () => {
      await upsertStoredProviderApiKey('openrouter', 'openrouter-secret');
      const sender = identity('desktop_1');
      const recipient = identity('phone_1');
      const transfer = createProviderCredentialRequest();
      const capability = createProviderCredentialsCapability(sender);

      const envelope = await capability.invoke(
        'openrouter.export',
        transfer.request,
        {
          sourceDevice: {
            ...recipient,
            administrator: true,
            grants: [],
            endpoints: [],
            revokedAt: null,
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          requestId: 'request_1',
        },
      );
      const plaintext = openProviderCredential({
        envelope,
        privateKey: transfer.privateKey,
        senderDeviceId: sender.id,
        recipientDeviceId: recipient.id,
        senderIdentityPublicKey: sender.publicKey,
      });

      expect(JSON.parse(plaintext)).toMatchObject({
        kind: 'openrouter-api-key',
        apiKey: 'openrouter-secret',
      });
    });
  });
});
