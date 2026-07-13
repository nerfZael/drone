import type { CapabilityDescriptor } from '@drone/device-protocol';
import type { CapabilityContext, CapabilityHandler } from './device-mesh-types';

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
    return await handler.invoke(operation, payload, context);
  }
}
