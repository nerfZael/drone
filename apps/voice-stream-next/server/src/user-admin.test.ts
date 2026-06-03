import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { VoiceStreamNextDb } from './db.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', 'data', 'tests');
  return new VoiceStreamNextDb(path.join(dir, `${name}-${crypto.randomUUID()}.sqlite`));
}

describe('user admin bootstrap', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
  });

  test('makes the first user admin', () => {
    const db = tempDb('first-admin');
    dbs.push(db);

    const user = db.upsertUser({
      clerkUserId: 'clerk_first',
      displayName: 'First User',
      email: 'first@example.local',
      admin: false,
    });

    expect(user.admin).toBe(true);
  });

  test('keeps later users non-admin unless explicitly granted', () => {
    const db = tempDb('later-admin');
    dbs.push(db);

    db.upsertUser({
      clerkUserId: 'clerk_first',
      displayName: 'First User',
      email: 'first@example.local',
      admin: false,
    });
    const second = db.upsertUser({
      clerkUserId: 'clerk_second',
      displayName: 'Second User',
      email: 'second@example.local',
      admin: false,
    });
    const third = db.upsertUser({
      clerkUserId: 'clerk_third',
      displayName: 'Third User',
      email: 'third@example.local',
      admin: true,
    });

    expect(second.admin).toBe(false);
    expect(third.admin).toBe(true);
  });

  test('tracks admin credit grants in user billing summaries', () => {
    const db = tempDb('credit-grants');
    dbs.push(db);

    const admin = db.upsertUser({
      clerkUserId: 'clerk_admin',
      displayName: 'Admin User',
      email: 'admin@example.local',
      admin: true,
    });
    const user = db.upsertUser({
      clerkUserId: 'clerk_credit_user',
      displayName: 'Credit User',
      email: 'credit@example.local',
      admin: false,
    });

    const grant = db.grantCredits(admin.id, user.id, {
      amountMicrocredits: 12_500_000,
      reason: 'Trial credits',
    });

    expect(grant.kind).toBe('grant');
    expect(grant.balanceAfterMicrocredits).toBe(12_500_000);
    expect(db.creditBalanceMicrocredits(user.id)).toBe(12_500_000);

    const summary = db.adminUserBillingSummary(user.id);
    expect(summary?.creditBalanceMicrocredits).toBe(12_500_000);
    expect(summary?.creditsGrantedMicrocredits).toBe(12_500_000);
    expect(summary?.creditsSpentMicrocredits).toBe(0);
  });

  test('tracks billable usage debits in user billing summaries', () => {
    const db = tempDb('usage-debits');
    dbs.push(db);

    const admin = db.upsertUser({
      clerkUserId: 'clerk_usage_admin',
      displayName: 'Usage Admin',
      email: 'usage-admin@example.local',
      admin: true,
    });
    const user = db.upsertUser({
      clerkUserId: 'clerk_usage_user',
      displayName: 'Usage User',
      email: 'usage@example.local',
      admin: false,
    });
    db.grantCredits(admin.id, user.id, {
      amountMicrocredits: 10_000_000,
      reason: 'Trial credits',
    });

    const usage = db.recordBillableUsage({
      userId: user.id,
      service: 'exa',
      provider: 'exa',
      credentialSource: 'platform_exa_key',
      operation: 'web_search',
      vendorCostMicros: 7_000,
      chargedMicrocredits: 700_000,
    });

    expect(usage.ledgerId).toBeTruthy();
    expect(db.creditBalanceMicrocredits(user.id)).toBe(9_300_000);
    const summary = db.adminUserBillingSummary(user.id);
    expect(summary?.creditsSpentMicrocredits).toBe(700_000);
    expect(summary?.creditBalanceMicrocredits).toBe(9_300_000);
    expect(db.userCreditSummary(user.id)).toMatchObject({
      balanceMicrocredits: 9_300_000,
      grantedMicrocredits: 10_000_000,
      purchasedMicrocredits: 0,
      spentMicrocredits: 700_000,
    });
    expect(db.listBillableUsageEvents(user.id)).toHaveLength(1);
  });
});

describe('data directory defaults', () => {
  afterEach(() => {
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
  });

  test('uses the Railway volume mount path when no explicit data directory is set', () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.RAILWAY_VOLUME_MOUNT_PATH = dataDir;

    const db = new VoiceStreamNextDb();
    try {
      expect(db.path).toBe(path.join(dataDir, 'voice-stream-next.sqlite'));
    } finally {
      db.db.close();
    }
  });
});
