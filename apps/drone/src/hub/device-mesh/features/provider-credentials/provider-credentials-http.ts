import type http from 'node:http';
import {
  installCodexCliAuthJsonFromTransfer,
  upsertStoredProviderApiKey,
} from '../../../hub-settings';
import type { LocalDeviceIdentity } from '../../device-identity';
import {
  deviceMeshJson,
  readDeviceMeshBody,
  type DeviceMeshHttpExtension,
} from '../../device-mesh-http';
import type { DeviceMeshRouter } from '../../device-mesh-router';
import type { DeviceMeshStore } from '../../device-mesh-store';
import {
  createProviderCredentialRequest,
  openProviderCredential,
  type ProviderCredentialEnvelope,
  type ProviderCredentialId,
} from './provider-credential-envelope';

type ImportedCredential =
  | { kind: 'openai-api-key'; apiKey: string }
  | { kind: 'groq-api-key'; apiKey: string }
  | { kind: 'codex-auth-json'; authJson: string };

export class ProviderCredentialsHttp implements DeviceMeshHttpExtension {
  constructor(
    private readonly identity: LocalDeviceIdentity,
    private readonly router: DeviceMeshRouter,
    private readonly store: DeviceMeshStore,
  ) {}

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (
      request.method !== 'POST' ||
      url.pathname !== '/api/device-mesh/provider-credentials/import'
    )
      return false;
    const body = await readDeviceMeshBody(request);
    const sourceDeviceId = String(body.sourceDeviceId ?? '').trim();
    const credential =
      body.credential === 'codex'
        ? 'codex'
        : body.credential === 'openai'
          ? 'openai'
          : body.credential === 'groq'
            ? 'groq'
            : null;
    if (!sourceDeviceId || !credential)
      throw new Error('source device and credential are required');
    const imported = await this.fetch(sourceDeviceId, credential);
    if (credential === 'codex') {
      if (imported.kind !== 'codex-auth-json')
        throw new Error('source returned an invalid Codex credential');
      await installCodexCliAuthJsonFromTransfer(imported.authJson);
    } else {
      if (
        !('apiKey' in imported) ||
        imported.kind !== `${credential}-api-key` ||
        !imported.apiKey.trim()
      )
        throw new Error(
          `source returned an invalid ${credential === 'groq' ? 'GROQ' : 'OpenAI'} credential`,
        );
      await upsertStoredProviderApiKey(credential, imported.apiKey);
    }
    deviceMeshJson(response, 200, { ok: true, sourceDeviceId, credential });
    return true;
  }

  private async fetch(
    sourceDeviceId: string,
    credential: ProviderCredentialId,
  ): Promise<ImportedCredential> {
    const { request, privateKey } = createProviderCredentialRequest();
    const sourceDevice = (await this.store.read()).devices[sourceDeviceId];
    if (!sourceDevice || sourceDevice.revokedAt) throw new Error('credential source is not active');
    const envelope = (await this.router.request(
      sourceDeviceId,
      'provider-credentials',
      `${credential}.export`,
      request,
    )) as ProviderCredentialEnvelope;
    const plaintext = openProviderCredential({
      envelope,
      privateKey,
      senderDeviceId: sourceDeviceId,
      recipientDeviceId: this.identity.id,
      senderIdentityPublicKey: sourceDevice.publicKey,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      throw new Error('source returned a malformed credential');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('source returned a malformed credential');
    return parsed as ImportedCredential;
  }
}
