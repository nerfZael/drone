import {
  PROVIDER_CREDENTIALS_CAPABILITY,
  providerCredentialEnvelopeSigningText,
} from '@drone/device-protocol';
import {
  readCodexCliAuthJsonForTransfer,
  resolveEffectiveProviderApiKeySettings,
  resolveGroqApiKeySettings,
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
        const [openai, codexAuthJson, openrouter, groq] = await Promise.all([
          resolveEffectiveProviderApiKeySettings('openai'),
          readCodexCliAuthJsonForTransfer(),
          resolveEffectiveProviderApiKeySettings('openrouter'),
          resolveGroqApiKeySettings(),
        ]);
        return {
          credentials: [
            { id: 'openai', available: Boolean(openai.apiKey), source: openai.source },
            { id: 'codex', available: Boolean(codexAuthJson), source: 'codex-cli' },
            { id: 'openrouter', available: Boolean(openrouter.apiKey), source: openrouter.source },
            { id: 'groq', available: Boolean(groq.apiKey), source: groq.source },
          ],
        };
      }
      const credential: ProviderCredentialId =
        operation === 'codex.export'
          ? 'codex'
          : operation === 'openrouter.export'
            ? 'openrouter'
          : operation === 'groq.export'
            ? 'groq'
            : 'openai';
      if (
        operation !== 'openai.export' &&
        operation !== 'codex.export' &&
        operation !== 'openrouter.export' &&
        operation !== 'groq.export'
      )
        throw Object.assign(new Error(`unsupported provider credential operation: ${operation}`), {
          code: 'UNSUPPORTED_OPERATION',
        });
      const plaintext =
        credential === 'codex'
          ? await codexCredentialPlaintext()
          : await apiKeyCredentialPlaintext(credential);
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

async function apiKeyCredentialPlaintext(credential: 'openai' | 'openrouter' | 'groq'): Promise<string> {
  const settings =
    credential === 'openai'
      ? await resolveEffectiveProviderApiKeySettings('openai')
      : credential === 'openrouter'
        ? await resolveEffectiveProviderApiKeySettings('openrouter')
      : await resolveGroqApiKeySettings();
  if (!settings.apiKey)
    throw Object.assign(
      new Error(
        `this device has no ${credential === 'groq' ? 'GROQ' : credential === 'openrouter' ? 'OpenRouter' : 'OpenAI'} API key to copy`,
      ),
      { code: 'CREDENTIAL_NOT_FOUND' },
    );
  return JSON.stringify({
    kind: `${credential}-api-key`,
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
