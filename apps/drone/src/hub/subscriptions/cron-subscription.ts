import crypto from 'node:crypto';

import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';

import type { ResourceEvent } from './resource-subscription-types';

export type CronSubscriptionConfig = {
  expression: string;
  timeZone: string;
  description: string;
};

export type CronSubscriptionResource = {
  resourceId: string;
  resourceConfig: CronSubscriptionConfig;
  nextEventAt: string;
};

export type DueCronOccurrence = {
  scheduledAt: string;
  nextEventAt: string;
  coalescedMissedOccurrences: boolean;
};

export function normalizeCronSubscription(
  expressionRaw: unknown,
  timeZoneRaw: unknown,
  now = new Date(),
): CronSubscriptionResource {
  const expression = String(expressionRaw ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  if (!expression) throw new Error('cron expression is required');
  if (expression.length > 200) throw new Error('cron expression is too long');
  if (expression.split(' ').length !== 5) {
    throw new Error('cron expression must contain exactly five fields; seconds are not supported');
  }

  const timeZone = canonicalTimeZone(timeZoneRaw);
  const resourceId = cronResourceId(expression, timeZone);
  const parser = parseCron(expression, timeZone, resourceId, now);
  const nextEventAt = requiredIso(parser.next().toDate(), 'cron expression has no next occurrence');
  return {
    resourceId,
    resourceConfig: {
      expression,
      timeZone,
      description: describeCronExpression(expression),
    },
    nextEventAt,
  };
}

export function cronSubscriptionConfig(raw: Record<string, unknown>): CronSubscriptionConfig {
  const expression = String(raw?.expression ?? '').trim();
  const timeZone = String(raw?.timeZone ?? '').trim();
  if (!expression || !timeZone) throw new Error('cron subscription configuration is invalid');
  const description = String(raw?.description ?? '').trim() || describeCronExpression(expression);
  return { expression, timeZone, description };
}

export function describeCronExpression(expression: string): string {
  try {
    return cronstrue
      .toString(expression, { throwExceptionOnParseError: true })
      .trim()
      .replace(/\.$/, '')
      .slice(0, 500);
  } catch {
    return `Cron schedule (${expression})`;
  }
}

export function dueCronOccurrence(
  config: CronSubscriptionConfig,
  resourceId: string,
  nextEventAtRaw: string,
  now = new Date(),
): DueCronOccurrence | null {
  const nextEventAtMs = Date.parse(nextEventAtRaw);
  if (!Number.isFinite(nextEventAtMs)) throw new Error('cron subscription next event is invalid');
  if (nextEventAtMs > now.getTime()) return null;

  const latestParser = parseCron(
    config.expression,
    config.timeZone,
    resourceId,
    new Date(now.getTime() + 1),
  );
  const latestAt = latestParser.prev().toDate();
  const scheduledAt = new Date(Math.max(nextEventAtMs, latestAt.getTime())).toISOString();
  const nextParser = parseCron(config.expression, config.timeZone, resourceId, now);
  const followingEventAt = requiredIso(
    nextParser.next().toDate(),
    'cron expression has no future occurrence',
  );
  return {
    scheduledAt,
    nextEventAt: followingEventAt,
    coalescedMissedOccurrences: Date.parse(scheduledAt) > nextEventAtMs,
  };
}

export function cronOccurrenceEvent(input: {
  resourceId: string;
  config: CronSubscriptionConfig;
  occurrence: DueCronOccurrence;
  observedAt: string;
}): ResourceEvent {
  return {
    id: crypto.randomUUID(),
    providerEventId: `drone-hub:cron:${input.resourceId}:${input.occurrence.scheduledAt}`,
    provider: 'drone-hub',
    resourceType: 'cron',
    resourceId: input.resourceId,
    parentResourceId: null,
    eventType: 'cron.triggered',
    occurredAt: input.occurrence.scheduledAt,
    summary: `${input.config.description} (${input.config.timeZone}) triggered.`,
    providerContent: {
      expression: input.config.expression,
      timeZone: input.config.timeZone,
      description: input.config.description,
      scheduledAt: input.occurrence.scheduledAt,
      observedAt: input.observedAt,
      coalescedMissedOccurrences: input.occurrence.coalescedMissedOccurrences,
    },
  };
}

function canonicalTimeZone(raw: unknown): string {
  const requested = String(raw ?? '').trim() || 'UTC';
  if (requested.length > 100) throw new Error('cron time zone is too long');
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: requested }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`invalid cron time zone: ${requested}`);
  }
}

function cronResourceId(expression: string, timeZone: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(expression)
    .update('\0')
    .update(timeZone)
    .digest('hex');
  return `v1:${digest}`;
}

function parseCron(expression: string, timeZone: string, resourceId: string, currentDate: Date) {
  try {
    return CronExpressionParser.parse(expression, {
      currentDate,
      tz: timeZone,
      hashSeed: resourceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid cron expression: ${message}`);
  }
}

function requiredIso(value: Date, message: string): string {
  if (!Number.isFinite(value.getTime())) throw new Error(message);
  return value.toISOString();
}
