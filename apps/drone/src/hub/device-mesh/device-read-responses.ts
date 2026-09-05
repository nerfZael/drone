import crypto from 'node:crypto';
import {
  canonicalJson,
  diffDeviceRead,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';

export class DeviceReadResponses {
  private readonly entries = new Map<string, { revision: string; value: unknown }>();
  encode(request: SignedCapabilityRequest, value: unknown): unknown {
    if (
      request.capability !== 'drone-control' ||
      request.operation !== 'chat.read' ||
      !request.payload ||
      typeof request.payload !== 'object' ||
      !Object.prototype.hasOwnProperty.call(request.payload, '__deviceReadRevision')
    )
      return value;
    const { __deviceReadRevision: requestedRevision, ...payload } = request.payload as any;
    const key = canonicalJson({ source: request.sourceDeviceId, payload });
    const previous = this.entries.get(key);
    const serialized = canonicalJson(value);
    const revision = crypto.createHash('sha256').update(serialized).digest('base64url');
    let response: unknown = { type: 'device.read', revision, value };
    if (previous && previous.revision === requestedRevision) {
      const patch = diffDeviceRead(previous.value, value);
      if (patch.length <= 20_000 && canonicalJson(patch).length < serialized.length)
        response = {
          type: 'device.read',
          base: requestedRevision,
          revision,
          patch,
        };
    }
    this.entries.delete(key);
    if (serialized.length <= 512 * 1024)
      this.entries.set(key, { revision, value: JSON.parse(serialized) });
    while (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);
    return response;
  }
  clear(): void {
    this.entries.clear();
  }
}
