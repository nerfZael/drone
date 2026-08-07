import { MESH_CHAT_PAYLOAD_BYTES } from '@drone/device-protocol';

type JsonObject = Record<string, unknown>;

// Page builders primarily budget their entries, so leave room for keys and pagination metadata.
const PAGE_OVERHEAD_BYTES = 1_024;

export function fitMeshChatPayload<Metadata extends JsonObject, Page extends JsonObject>(
  metadata: Metadata,
  buildPage: (maxBytes: number) => Page,
): Metadata & Page {
  const pageBudget = Math.max(
    0,
    MESH_CHAT_PAYLOAD_BYTES - jsonBytes(metadata) - PAGE_OVERHEAD_BYTES,
  );
  const response = { ...metadata, ...buildPage(pageBudget) } as Metadata & Page;

  if (jsonBytes(response) > MESH_CHAT_PAYLOAD_BYTES)
    throw Object.assign(new Error('mesh chat response is too large'), {
      code: 'RESPONSE_TOO_LARGE',
    });
  return response;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
