import crypto from 'node:crypto';
import { renderEventNotificationPrompt } from '@drone/assistant-chat';

import { getPromptQueueRepository } from '../../host/prompt-queue-repository';
import { resolveGithubToken } from '../github-pull-requests';
import {
  githubRepositoryIdFromPullRequest,
  initialGithubRepositoryPollCursor,
  normalizeGithubPullRequestId,
  normalizeGithubRepositoryId,
  pollGithubRepository,
  validateGithubSubscriptionResource,
} from './github-subscription-poller';
import {
  type ChatResourceLocation,
  type ResourceSubscriptionBatch,
  ResourceSubscriptionRepository,
} from './resource-subscription-repository';
import { readResourceSubscriptionSettings } from './resource-subscription-settings';
import {
  RESOURCE_SUBSCRIPTION_EVENTS,
  type ResourceEvent,
  type ResourceSubscription,
  type ResourceSubscriptionEventType,
  type ResourceSubscriptionProvider,
  type ResourceSubscriptionSettings,
  type ResourceSubscriptionSubscriber,
  type ResourceSubscriptionType,
} from './resource-subscription-types';

export type ChatSubscriptionStatus = {
  idle: boolean;
  reason: string;
  latest: {
    id?: string;
    role?: string;
    status?: string;
    at?: string;
    text?: string;
    turnId?: string;
  } | null;
};

export type ResourceSubscriptionServiceDependencies = {
  repository: ResourceSubscriptionRepository;
  readChatStatus: (location: ChatResourceLocation) => Promise<ChatSubscriptionStatus>;
  authorizeDelivery?: (
    subscription: ResourceSubscription,
    subscriber: ChatResourceLocation,
  ) => Promise<boolean>;
  wakePromptQueue: (droneId: string, chatName: string) => void;
  log: (level: 'info' | 'warn', message: string, details?: Record<string, unknown>) => void;
};

export class ResourceSubscriptionService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastGithubPollAt = 0;
  private lastOrphanCleanupAt = 0;
  private lastCleanupAt = 0;
  private settingsCache: { value: ResourceSubscriptionSettings; expiresAt: number } | null = null;

  constructor(private readonly deps: ResourceSubscriptionServiceDependencies) {}

  async start(): Promise<void> {
    if (this.timer) return;
    if (!getPromptQueueRepository()) {
      throw new Error('resource subscriptions require the prompt queue');
    }
    await this.deps.repository.recoverInterruptedBatches();
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(subscriberChatId: string, includeInactive = false): ResourceSubscription[] {
    return this.deps.repository.list(subscriberChatId, includeInactive);
  }

  get(id: string, subscriberChatId: string): ResourceSubscription | null {
    return this.deps.repository.get(id, subscriberChatId);
  }

  resolveChatResource(resourceId: string): ChatResourceLocation | null {
    return this.deps.repository.resolveChatResource(resourceId);
  }

  async subscribe(input: {
    subscriber: ResourceSubscriptionSubscriber;
    provider: ResourceSubscriptionProvider;
    resourceType: ResourceSubscriptionType;
    resourceId: string;
    events: ResourceSubscriptionEventType[];
    intent?: string;
  }): Promise<{ created: boolean; subscription: ResourceSubscription }> {
    const subscriber = normalizeSubscriber(input.subscriber);
    const resource = normalizeResource(input.provider, input.resourceType, input.resourceId);
    const events = normalizeEvents(resource.provider, resource.resourceType, input.events);
    if (resource.provider === 'github' && resource.resourceType !== 'chat') {
      await validateGithubSubscriptionResource(resource.resourceType, resource.resourceId);
    }
    const intent = String(input.intent ?? '')
      .trim()
      .slice(0, 2_000);
    const settings = await this.settings();
    const githubRepositoryId =
      resource.provider === 'github'
        ? resource.resourceType === 'repository'
          ? resource.resourceId
          : githubRepositoryIdFromPullRequest(resource.resourceId)
        : null;
    const existing = this.deps.repository
      .list(subscriber.chatId, true)
      .find(
        (item) =>
          item.provider === resource.provider &&
          item.resourceType === resource.resourceType &&
          item.resourceId === resource.resourceId,
      );
    let cursor =
      existing?.status === 'active' || existing?.status === 'paused' ? existing.cursor : undefined;
    if (resource.provider === 'drone-hub') {
      const location = this.deps.repository.resolveChatResource(resource.resourceId);
      if (!location) throw new Error(`unknown DroneHub chat resource: ${resource.resourceId}`);
      if (location.chatId === subscriber.chatId) {
        throw new Error('a conversation cannot subscribe to its own chat events');
      }
      if (!cursor) {
        const status = await this.deps.readChatStatus(location);
        cursor = chatCursor(location, status);
      }
    }
    return await this.deps.repository.upsert({
      subscriber,
      ...resource,
      events,
      intent,
      cursor,
      ...(githubRepositoryId
        ? {
            initialPollCursor: {
              provider: 'github' as const,
              resourceType: 'repository' as const,
              resourceId: githubRepositoryId,
              cursor: initialGithubRepositoryPollCursor(),
            },
          }
        : {}),
      maxActive: settings.maxActiveSubscriptionsPerConversation,
    });
  }

  async update(input: {
    id: string;
    subscriberChatId: string;
    events?: ResourceSubscriptionEventType[];
    intent?: string;
  }): Promise<ResourceSubscription | null> {
    const current = this.deps.repository.get(input.id, input.subscriberChatId);
    if (!current) return null;
    const events = input.events
      ? normalizeEvents(current.provider, current.resourceType, input.events)
      : undefined;
    return await this.deps.repository.update({
      id: input.id,
      subscriberChatId: input.subscriberChatId,
      events,
      ...(input.intent !== undefined
        ? { intent: String(input.intent).trim().slice(0, 2_000) }
        : {}),
    });
  }

  async cancel(id: string, subscriberChatId: string): Promise<ResourceSubscription | null> {
    return await this.deps.repository.cancel(id, subscriberChatId);
  }

  async pauseForDrone(droneId: string, chatIds: string[]): Promise<ResourceSubscription[]> {
    return await this.deps.repository.pauseForDrone(droneId, chatIds);
  }

  async resumeForChat(chatId: string): Promise<ResourceSubscription[]> {
    await this.resetResumeCursors(this.deps.repository.resumeCandidatesForChat(chatId));
    return await this.deps.repository.resumeForChat(chatId);
  }

  async resumeForDrone(droneId: string, chatIds: string[]): Promise<ResourceSubscription[]> {
    await this.resetResumeCursors(this.deps.repository.resumeCandidatesForDrone(droneId, chatIds));
    return await this.deps.repository.resumeForDrone(droneId, chatIds);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.settings();
      if (!settings.enabled) return;
      if (Date.now() - this.lastOrphanCleanupAt >= 60_000) {
        this.lastOrphanCleanupAt = Date.now();
        await cancelOrphanedResourceSubscriptions(this.deps.repository, this.deps.log);
      }
      await this.pollChats();
      if (Date.now() - this.lastGithubPollAt >= settings.githubPollingIntervalMs) {
        this.lastGithubPollAt = Date.now();
        await this.pollGithub();
      }
      for (let index = 0; index < 10; index += 1) {
        const batch = await this.deps.repository.claimBatch(settings);
        if (!batch) break;
        await this.deliver(batch, settings);
      }
      if (Date.now() - this.lastCleanupAt >= 24 * 60 * 60 * 1000) {
        this.lastCleanupAt = Date.now();
        await this.deps.repository.cleanup(settings);
      }
    } catch (error) {
      this.deps.log('warn', 'resource subscription tick failed', {
        error: errorMessage(error),
      });
    } finally {
      this.running = false;
    }
  }

  private async settings(): Promise<ResourceSubscriptionSettings> {
    if (this.settingsCache && this.settingsCache.expiresAt > Date.now()) {
      return this.settingsCache.value;
    }
    const value = await readResourceSubscriptionSettings();
    this.settingsCache = { value, expiresAt: Date.now() + 5_000 };
    return value;
  }

  private async resetResumeCursors(subscriptions: ResourceSubscription[]): Promise<void> {
    for (const subscription of subscriptions) {
      if (subscription.provider === 'github') continue;
      const location = this.deps.repository.resolveChatResource(subscription.resourceId);
      if (!location) {
        await this.deps.repository.cancel(subscription.id, subscription.subscriber.chatId);
        continue;
      }
      try {
        const status = await this.deps.readChatStatus(location);
        await this.deps.repository.updateSubscriptionCursor(
          subscription.id,
          chatCursor(location, status),
        );
      } catch (error) {
        await this.deps.repository.updateSubscriptionCursor(subscription.id, {
          ...subscription.cursor,
          targetDroneId: location.droneId,
          targetChatName: location.chatName,
          needsBaseline: true,
          idleArmed: false,
          idleCauseId: '',
        });
        this.deps.log('warn', 'chat subscription resume baseline deferred', {
          subscriptionId: subscription.id,
          resourceId: subscription.resourceId,
          error: errorMessage(error),
        });
      }
    }
  }

  private async pollChats(): Promise<void> {
    const subscriptions = this.deps.repository.listActive('drone-hub');
    for (const subscription of subscriptions) {
      try {
        const location = this.deps.repository.resolveChatResource(subscription.resourceId);
        if (!location) {
          await this.deps.repository.cancelActive(
            subscription.id,
            subscription.subscriber.chatId,
          );
          continue;
        }
        const status = await this.deps.readChatStatus(location);
        const { cursor, events } = detectChatSubscriptionChanges(subscription, location, status);
        for (const event of events) await this.deps.repository.appendEvent(event);
        if (JSON.stringify(cursor) !== JSON.stringify(subscription.cursor)) {
          await this.deps.repository.updateSubscriptionCursor(subscription.id, cursor);
        }
      } catch (error) {
        this.deps.log('warn', 'chat subscription poll failed', {
          subscriptionId: subscription.id,
          resourceId: subscription.resourceId,
          error: errorMessage(error),
        });
      }
    }
  }

  private async pollGithub(): Promise<void> {
    const subscriptions = this.deps.repository.listActive('github');
    const repositoryIds = new Set(
      subscriptions.map((subscription) =>
        subscription.resourceType === 'repository'
          ? subscription.resourceId
          : githubRepositoryIdFromPullRequest(subscription.resourceId),
      ),
    );
    if (repositoryIds.size === 0) return;
    const token = await resolveGithubToken();
    for (const resourceId of repositoryIds) {
      const cursor = this.deps.repository.pollCursor('github', 'repository', resourceId);
      try {
        const result = await pollGithubRepository(resourceId, cursor, new Date(), { token });
        for (const event of result.events) await this.deps.repository.appendEvent(event);
        await this.deps.repository.setPollCursor({
          provider: 'github',
          resourceType: 'repository',
          resourceId,
          cursor: result.cursor,
        });
      } catch (error) {
        await this.deps.repository.setPollCursor({
          provider: 'github',
          resourceType: 'repository',
          resourceId,
          cursor: cursor ?? {},
          error: errorMessage(error),
        });
        this.deps.log('warn', 'GitHub subscription poll failed', {
          resourceId,
          error: errorMessage(error),
        });
      }
    }
  }

  private async deliver(
    batch: ResourceSubscriptionBatch,
    settings: ResourceSubscriptionSettings,
  ): Promise<void> {
    try {
      const currentSubscriber = this.deps.repository.resolveChatResource(batch.subscriber.chatId);
      if (!currentSubscriber) {
        for (const subscriptionId of new Set(batch.items.map((item) => item.subscription.id))) {
          await this.deps.repository.cancel(subscriptionId, batch.subscriber.chatId);
        }
        throw new Error('subscribing conversation no longer exists');
      }
      const deliverableItems: ResourceSubscriptionBatch['items'] = [];
      const rejected: Array<{ deliveryId: string; error: string; permanent: boolean }> = [];
      const currentSubscriptions = new Map<string, ResourceSubscription | null>();
      const authorizationResults = new Map<string, Promise<boolean>>();
      for (const item of batch.items) {
        if (!currentSubscriptions.has(item.subscription.id)) {
          currentSubscriptions.set(
            item.subscription.id,
            this.deps.repository.get(item.subscription.id, currentSubscriber.chatId),
          );
        }
        const current = currentSubscriptions.get(item.subscription.id) ?? null;
        if (!current || current.status === 'cancelled') {
          rejected.push({
            deliveryId: item.deliveryId,
            error: 'subscription is no longer active',
            permanent: true,
          });
          continue;
        }
        if (current.status !== 'active' && current.status !== 'completed') {
          rejected.push({
            deliveryId: item.deliveryId,
            error: `subscription is ${current.status}`,
            permanent: false,
          });
          continue;
        }
        if (!current.events.includes(item.event.eventType)) {
          rejected.push({
            deliveryId: item.deliveryId,
            error: 'event is no longer selected by the subscription',
            permanent: true,
          });
          continue;
        }
        try {
          if (!authorizationResults.has(current.id)) {
            authorizationResults.set(
              current.id,
              this.deps.authorizeDelivery
                ? this.deps.authorizeDelivery(current, currentSubscriber)
                : Promise.resolve(true),
            );
          }
          const authorized = await authorizationResults.get(current.id)!;
          if (!authorized) {
            rejected.push({
              deliveryId: item.deliveryId,
              error: 'subscriber no longer has access to the resource',
              permanent: false,
            });
            continue;
          }
        } catch (error) {
          rejected.push({
            deliveryId: item.deliveryId,
            error: `resource authorization failed: ${errorMessage(error)}`,
            permanent: false,
          });
          continue;
        }
        const refreshed = this.deps.repository.get(current.id, currentSubscriber.chatId);
        if (!refreshed || (refreshed.status !== 'active' && refreshed.status !== 'completed')) {
          rejected.push({
            deliveryId: item.deliveryId,
            error: 'subscription changed while delivery authorization was checked',
            permanent: refreshed?.status === 'cancelled',
          });
          continue;
        }
        if (!refreshed.events.includes(item.event.eventType)) {
          rejected.push({
            deliveryId: item.deliveryId,
            error: 'event is no longer selected by the subscription',
            permanent: true,
          });
          continue;
        }
        deliverableItems.push({ ...item, subscription: refreshed });
      }
      if (rejected.length > 0) {
        await this.deps.repository.releaseRejectedBatchItems({
          batchId: batch.id,
          rejected,
          remainingDeliveryIds: deliverableItems.map((item) => item.deliveryId),
          retryLimit: settings.deliveryRetryLimit,
        });
      }
      if (deliverableItems.length === 0) {
        this.deps.log('warn', 'resource subscription batch had no deliverable events', {
          batchId: batch.id,
          subscriberChatId: currentSubscriber.chatId,
          rejectedEventCount: rejected.length,
        });
        return;
      }
      const deliverableBatch = { ...batch, items: deliverableItems };
      await this.deps.repository.updateSubscriberLocation(batch.id, currentSubscriber);
      if (!this.deps.repository.isBatchProcessing(batch.id)) {
        this.deps.log('info', 'resource subscription batch stopped before prompt enqueue', {
          batchId: batch.id,
          subscriberChatId: currentSubscriber.chatId,
        });
        return;
      }
      const queue = getPromptQueueRepository();
      if (!queue) throw new Error('prompt queue is unavailable');
      const prompt = renderSubscriptionPrompt(deliverableBatch);
      await queue.enqueue({
        droneId: currentSubscriber.droneId,
        chatName: currentSubscriber.chatName,
        idempotencyKey: `subscription-batch:${batch.id}`,
        prompt: {
          id: batch.promptId,
          at: new Date().toISOString(),
          prompt,
          deliveryMode: 'queue',
          state: 'queued',
        },
      });
      await this.deps.repository.completeBatch(batch.id);
      this.deps.wakePromptQueue(currentSubscriber.droneId, currentSubscriber.chatName);
      this.deps.log('info', 'resource subscription batch queued', {
        batchId: batch.id,
        subscriberChatId: currentSubscriber.chatId,
        eventCount: deliverableItems.length,
      });
    } catch (error) {
      await this.deps.repository.failBatch(
        batch.id,
        errorMessage(error),
        settings.deliveryRetryLimit,
      );
    }
  }
}

export async function cancelOrphanedResourceSubscriptions(
  repository: Pick<
    ResourceSubscriptionRepository,
    'listActive' | 'resolveChatResource' | 'cancelActive'
  >,
  log: ResourceSubscriptionServiceDependencies['log'],
): Promise<void> {
  const subscriptions = repository.listActive();
  const subscriberExists = new Map<string, boolean>();
  for (const subscription of subscriptions) {
    const chatId = subscription.subscriber.chatId;
    if (!subscriberExists.has(chatId)) {
      subscriberExists.set(chatId, Boolean(repository.resolveChatResource(chatId)));
    }
    if (subscriberExists.get(chatId)) continue;
    const cancelled = await repository.cancelActive(subscription.id, chatId);
    if (cancelled?.status === 'cancelled') {
      log('info', 'cancelled resource subscription for deleted conversation', {
        subscriptionId: subscription.id,
        subscriberChatId: chatId,
      });
    }
  }
}

function normalizeSubscriber(
  input: ResourceSubscriptionSubscriber,
): ResourceSubscriptionSubscriber {
  const chatId = String(input.chatId ?? '').trim();
  const droneId = String(input.droneId ?? '').trim();
  const chatName = String(input.chatName ?? '').trim() || 'default';
  if (!chatId || !droneId)
    throw new Error('subscriptions require a DroneHub conversation identity');
  return { chatId, droneId, chatName };
}

function normalizeResource(
  provider: ResourceSubscriptionProvider,
  resourceType: ResourceSubscriptionType,
  resourceId: string,
): {
  provider: ResourceSubscriptionProvider;
  resourceType: ResourceSubscriptionType;
  resourceId: string;
} {
  if (provider === 'drone-hub' && resourceType === 'chat') {
    const id = String(resourceId ?? '').trim();
    if (!id) throw new Error('DroneHub chat resource ID is required');
    return { provider, resourceType, resourceId: id };
  }
  if (provider === 'github' && resourceType === 'repository') {
    return { provider, resourceType, resourceId: normalizeGithubRepositoryId(resourceId) };
  }
  if (provider === 'github' && resourceType === 'pull_request') {
    return { provider, resourceType, resourceId: normalizeGithubPullRequestId(resourceId) };
  }
  throw new Error(`unsupported subscription resource: ${provider}/${resourceType}`);
}

function normalizeEvents(
  provider: ResourceSubscriptionProvider,
  resourceType: ResourceSubscriptionType,
  raw: ResourceSubscriptionEventType[],
): ResourceSubscriptionEventType[] {
  const supported = new Set<ResourceSubscriptionEventType>(
    provider === 'drone-hub'
      ? ['chat.idle', 'chat.failed']
      : resourceType === 'repository'
        ? [
            'pull_request.opened',
            'pull_request.comment.created',
            'pull_request.merged',
            'pull_request.closed',
          ]
        : ['pull_request.comment.created', 'pull_request.merged', 'pull_request.closed'],
  );
  const events = [...new Set((raw ?? []).map(String))].filter(
    (event): event is ResourceSubscriptionEventType =>
      RESOURCE_SUBSCRIPTION_EVENTS.includes(event as ResourceSubscriptionEventType) &&
      supported.has(event as ResourceSubscriptionEventType),
  );
  if (events.length === 0) {
    throw new Error(`at least one supported event is required: ${[...supported].join(', ')}`);
  }
  if (events.length !== new Set(raw ?? []).size) {
    const unsupported = [...new Set(raw ?? [])].filter((event) => !supported.has(event));
    if (unsupported.length > 0) throw new Error(`unsupported events: ${unsupported.join(', ')}`);
  }
  return events;
}

function chatCursor(
  location: ChatResourceLocation,
  status: ChatSubscriptionStatus,
): Record<string, any> {
  return {
    targetDroneId: location.droneId,
    targetChatName: location.chatName,
    lastIdle: status.idle,
    idleArmed: !status.idle,
    lastLatestId: String(status.latest?.id ?? '').trim(),
    idleCauseId: status.idle
      ? ''
      : String(status.latest?.id ?? '').trim() ||
        validIso(status.latest?.at, '') ||
        `cycle-${crypto.randomUUID()}`,
    lastFailureId:
      status.latest?.role === 'user' && status.latest?.status === 'failed'
        ? String(status.latest?.id ?? '').trim()
        : '',
  };
}

function normalizeChatCursor(
  raw: Record<string, unknown>,
  location: ChatResourceLocation,
  status: ChatSubscriptionStatus,
): Record<string, any> {
  if (typeof raw?.idleArmed !== 'boolean') return chatCursor(location, status);
  return {
    ...raw,
    targetDroneId: location.droneId,
    targetChatName: location.chatName,
    idleArmed: raw.idleArmed === true,
    lastIdle: raw.lastIdle === true,
    lastLatestId: String(raw.lastLatestId ?? '').trim(),
    idleCauseId: String(raw.idleCauseId ?? '').trim(),
    lastFailureId: String(raw.lastFailureId ?? '').trim(),
  };
}

export function detectChatSubscriptionChanges(
  subscription: ResourceSubscription,
  location: ChatResourceLocation,
  status: ChatSubscriptionStatus,
): { cursor: Record<string, any>; events: ResourceEvent[] } {
  if (subscription.cursor.needsBaseline === true) {
    return { cursor: chatCursor(location, status), events: [] };
  }
  const cursor = normalizeChatCursor(subscription.cursor, location, status);
  const events: ResourceEvent[] = [];
  const latestId = String(status.latest?.id ?? '').trim();
  const latestFailed =
    status.latest?.role === 'user' && status.latest?.status === 'failed' && latestId;
  if (
    latestFailed &&
    cursor.lastFailureId !== latestId &&
    subscription.events.includes('chat.failed')
  ) {
    events.push(chatEvent(subscription, location, status, 'chat.failed', latestId));
    cursor.lastFailureId = latestId;
  }

  if (!status.idle) {
    cursor.idleArmed = true;
    cursor.idleCauseId =
      latestId ||
      validIso(status.latest?.at, '') ||
      cursor.idleCauseId ||
      `cycle-${crypto.randomUUID()}`;
  }
  if (
    status.idle &&
    cursor.idleArmed &&
    status.reason !== 'latest_user_failed' &&
    subscription.events.includes('chat.idle')
  ) {
    events.push(
      chatEvent(
        subscription,
        location,
        status,
        'chat.idle',
        cursor.idleCauseId || latestId || `cycle-${subscription.id}`,
      ),
    );
    cursor.idleArmed = false;
    cursor.idleCauseId = '';
  }
  cursor.lastIdle = status.idle;
  cursor.lastLatestId = latestId;
  return { cursor, events };
}

function chatEvent(
  subscription: ResourceSubscription,
  location: ChatResourceLocation,
  status: ChatSubscriptionStatus,
  eventType: 'chat.idle' | 'chat.failed',
  causeId: string,
): ResourceEvent {
  const occurredAt = validIso(status.latest?.at, new Date().toISOString());
  const chatLabel = `${location.droneId}/${location.chatName}`;
  return {
    id: crypto.randomUUID(),
    providerEventId: `drone-hub:${subscription.resourceId}:${eventType}:${causeId}`,
    provider: 'drone-hub',
    resourceType: 'chat',
    resourceId: subscription.resourceId,
    parentResourceId: null,
    eventType,
    occurredAt,
    summary:
      eventType === 'chat.idle'
        ? `${chatLabel} became idle.`
        : `${chatLabel} failed its latest run.`,
    providerContent: {
      latestMessage: String(status.latest?.text ?? '').slice(0, 8_000),
      latestMessageId: String(status.latest?.id ?? '').trim() || null,
      reason: status.reason,
    },
  };
}

export function renderSubscriptionPrompt(batch: ResourceSubscriptionBatch): string {
  return renderEventNotificationPrompt({
    events: batch.items.map((item) => ({
      provider: item.event.provider,
      resourceType: item.event.resourceType,
      resourceId: item.event.resourceId,
      eventType: item.event.eventType,
      occurredAt: item.event.occurredAt,
      intent: item.subscription.intent,
      summary: item.event.summary,
      providerContent: item.event.providerContent,
    })),
  });
}

function validIso(raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim();
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
