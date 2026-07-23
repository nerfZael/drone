import { EventEmitter } from 'node:events';

import type { WorkflowEvent } from './workflow-types';

export class WorkflowEventBus {
  private readonly emitter = new EventEmitter();

  publish(event: WorkflowEvent): void {
    this.emitter.emit(event.droneId, event);
  }

  subscribe(droneId: string, listener: (event: WorkflowEvent) => void): () => void {
    this.emitter.on(droneId, listener);
    return () => this.emitter.off(droneId, listener);
  }
}
