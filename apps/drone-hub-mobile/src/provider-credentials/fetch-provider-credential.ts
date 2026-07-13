import {
  createProviderCredentialRequest,
  openProviderCredential,
  type ProviderCredentialId,
} from './provider-credential-crypto';

type MeshRequest = (
  targetDeviceId: string,
  capability: string,
  operation: string,
  payload?: unknown,
) => Promise<any>;

export async function fetchProviderCredential(input: {
  sourceDeviceId: string;
  recipientDeviceId: string;
  sourceIdentityPublicKey: JsonWebKey;
  credential: ProviderCredentialId;
  request: MeshRequest;
}): Promise<Record<string, unknown>> {
  const transfer = await createProviderCredentialRequest();
  try {
    const envelope = await input.request(
      input.sourceDeviceId,
      'provider-credentials',
      `${input.credential}.export`,
      transfer.request,
    );
    const plaintext = await openProviderCredential({
      envelope,
      privateKey: transfer.privateKey,
      transferId: transfer.request.transferId,
      credential: input.credential,
      senderDeviceId: input.sourceDeviceId,
      recipientDeviceId: input.recipientDeviceId,
      senderIdentityPublicKey: input.sourceIdentityPublicKey,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      throw new Error('source returned a malformed credential');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('source returned a malformed credential');
    return parsed as Record<string, unknown>;
  } finally {
    transfer.privateKey.fill(0);
  }
}
