import {
  PROVIDER_CREDENTIALS_CAPABILITY,
  providerCredentialEnvelopeSigningText,
} from '@drone/device-protocol';
import {
  readCodexCliAuthJsonForTransfer,
  resolveEffectiveProviderApiKeySettings,
} from '../../../hub-settings';
import { signDeviceText, type LocalDeviceIdentity } from '../../device-identity';
import type { CapabilityContext, CapabilityHandler } from '../../device-mesh-types';
import {
  sealProviderCredential,
  type ProviderCredentialId,
  type ProviderCredentialRequest,
} from './provider-credential-envelope';

function requireAdministrator(context: CapabilityContext): void {
  if (!context.sourceDevice.administrator)
    throw Object.assign(new Error('only an administrator device may copy provider credentials'), {
      code: 'ADMIN_REQUIRED',
    });
}

export function createProviderCredentialsCapability(
  identity: LocalDeviceIdentity,
): CapabilityHandler {
  return {
    descriptor: PROVIDER_CREDENTIALS_CAPABILITY,
    async invoke(operation, payload, context) {
      requireAdministrator(context);
      if (operation === 'credentials.inspect') {
        const [openai, codexAuthJson] = await Promise.all([
          resolveEffectiveProviderApiKeySettings('openai'),
          readCodexCliAuthJsonForTransfer(),
        ]);
        return {
          credentials: [
            { id: 'openai', available: Boolean(openai.apiKey), source: openai.source },
            { id: 'codex', available: Boolean(codexAuthJson), source: 'codex-cli' },
          ],
        };
      }
      const credential: ProviderCredentialId = operation === 'codex.export' ? 'codex' : 'openai';
      if (operation !== 'openai.export' && operation !== 'codex.export')
        throw Object.assign(new Error(`unsupported provider credential operation: ${operation}`), {
          code: 'UNSUPPORTED_OPERATION',
        });
      const plaintext =
        credential === 'openai'
          ? await openAiCredentialPlaintext()
          : await codexCredentialPlaintext();
      const envelope = sealProviderCredential({
        request: payload as ProviderCredentialRequest,
        credential,
        plaintext,
        senderDeviceId: identity.id,
        recipientDeviceId: context.sourceDevice.id,
      });
      return {
        ...envelope,
        signature: signDeviceText(
          identity,
          providerCredentialEnvelopeSigningText(envelope, identity.id, context.sourceDevice.id),
        ),
      };
    },
  };
}

async function openAiCredentialPlaintext(): Promise<string> {
  const settings = await resolveEffectiveProviderApiKeySettings('openai');
  if (!settings.apiKey)
    throw Object.assign(new Error('this device has no OpenAI API key to copy'), {
      code: 'CREDENTIAL_NOT_FOUND',
    });
  return JSON.stringify({
    kind: 'openai-api-key',
    apiKey: settings.apiKey,
    source: settings.source,
    exportedAt: new Date().toISOString(),
  });
}

async function codexCredentialPlaintext(): Promise<string> {
  const authJson = await readCodexCliAuthJsonForTransfer();
  if (!authJson)
    throw Object.assign(new Error('this device has no file-based Codex login to copy'), {
      code: 'CREDENTIAL_NOT_FOUND',
    });
  return JSON.stringify({
    kind: 'codex-auth-json',
    authJson,
    exportedAt: new Date().toISOString(),
  });
}
