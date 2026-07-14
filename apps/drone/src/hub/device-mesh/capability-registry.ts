import type { CapabilityDescriptor } from '@drone/device-protocol';
import type { CapabilityContext, CapabilityHandler } from './device-mesh-types';

const MAX_RESULT_BYTES = 220 * 1024;

export class CapabilityRegistry {
  private readonly handlers = new Map<string, CapabilityHandler>();

  register(handler: CapabilityHandler): void {
    if (this.handlers.has(handler.descriptor.id))
      throw new Error(`duplicate capability: ${handler.descriptor.id}`);
    this.handlers.set(handler.descriptor.id, handler);
  }

  list(): CapabilityDescriptor[] {
    return [...this.handlers.values()].map(({ descriptor }) => descriptor);
  }

  async close(): Promise<void> {
    await Promise.all([...this.handlers.values()].map((handler) => handler.close?.()));
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await Promise.all(
      [...this.handlers.values()].map((handler) => handler.revokeDevice?.(deviceId)),
    );
  }

  async invoke(
    capability: string,
    version: number,
    operation: string,
    payload: unknown,
    context: CapabilityContext,
  ): Promise<unknown> {
    const handler = this.handlers.get(capability);
    if (
      !handler ||
      handler.descriptor.version !== version ||
      !handler.descriptor.operations.includes(operation)
    ) {
      throw Object.assign(
        new Error(`unsupported operation: ${capability}@${version}/${operation}`),
        { code: 'UNSUPPORTED_OPERATION' },
      );
    }
    const result = await handler.invoke(operation, payload, context);
    let serialized: string;
    try {
      serialized = JSON.stringify(result);
    } catch {
      throw Object.assign(new Error('capability result is not serializable'), {
        code: 'INVALID_CAPABILITY_RESULT',
      });
    }
    if (Buffer.byteLength(serialized) > MAX_RESULT_BYTES)
      throw Object.assign(new Error('capability result is too large for the device mesh'), {
        code: 'CAPABILITY_RESULT_TOO_LARGE',
      });
    return result;
  }
}
