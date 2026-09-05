// Synthetic JavaScript comparison; this does not measure Android rendering or network latency.
// Run: bun apps/drone-hub-mobile/scripts/benchmark-loading.ts
import {
  normalizeMobileDroneListPayload,
  resolveMobileDroneListSnapshot,
  EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
  buildMobileDroneRepoGroups,
} from '../src/drones/drone-sidebar-model';
const raw = {
  drones: Array.from({ length: 1000 }, (_, i) => ({
    id: `drone-${i}`,
    name: `Agent ${i}`,
    runtime: 'host',
    phase: 'ready',
    status: 'Ready',
    repoPath: `/work/repo-${i % 20}`,
    chats: ['default', 'review'],
    busyChats: [],
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
  })),
};
function sidebar(share: boolean) {
  let snapshot = resolveMobileDroneListSnapshot({
    current: EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
    targetId: 'hub',
    payload: normalizeMobileDroneListPayload(raw),
  });
  buildMobileDroneRepoGroups(snapshot.drones, snapshot.sidebar);
  let builds = 0;
  const start = performance.now();
  for (let i = 0; i < 20; i++) {
    const payload = normalizeMobileDroneListPayload(raw);
    const next = share
      ? resolveMobileDroneListSnapshot({ current: snapshot, targetId: 'hub', payload })
      : { ...snapshot, drones: payload.drones, sidebar: payload.sidebar };
    if (next.drones !== snapshot.drones || next.sidebar !== snapshot.sidebar) {
      buildMobileDroneRepoGroups(next.drones, next.sidebar);
      builds++;
    }
    snapshot = next;
  }
  return { ms: Math.round(performance.now() - start), treeBuilds: builds };
}
sidebar(false);
sidebar(true);
const trials = Array.from({ length: 5 }, () => ({ before: sidebar(false), after: sidebar(true) }));
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(
  JSON.stringify({
    scenario: '20 unchanged sidebar refreshes, 1000 drones, 20 repositories',
    beforeMedianMs: median(trials.map((t) => t.before.ms)),
    afterMedianMs: median(trials.map((t) => t.after.ms)),
    treeBuildsBefore: trials[0].before.treeBuilds,
    treeBuildsAfter: trials[0].after.treeBuilds,
  }),
);
const names = Array.from({ length: 10000 }, (_, i) => `file-${(i * 7919) % 10000}-Résumé.ts`);
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
const sort = (cached: boolean) => {
  const start = performance.now();
  for (let i = 0; i < 5; i++)
    [...names].sort(
      cached ? collator.compare : (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  return Math.round(performance.now() - start);
};
console.log(
  JSON.stringify({
    scenario: '5 sorts of 10000 file names',
    beforeMs: sort(false),
    afterMs: sort(true),
  }),
);
