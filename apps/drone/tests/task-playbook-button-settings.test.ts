import { describe, expect, test } from 'bun:test';
import {
  resolveTaskPlaybookButtonSettingsResponse,
  upsertStoredTaskPlaybookButtonSettings,
} from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

describe('task playbook button settings persistence', () => {
  test('returns defaults before anything is stored', async () => {
    await withTempDroneDataDir('drone-task-playbook-buttons-', async () => {
      const resolved = await resolveTaskPlaybookButtonSettingsResponse();
      expect(resolved.updatedAt).toBeNull();
      expect(resolved.taskPlaybookButtons).toEqual([]);
    });
  });

  test('round-trips task playbook button settings through registry storage', async () => {
    await withTempDroneDataDir('drone-task-playbook-buttons-', async () => {
      await upsertStoredTaskPlaybookButtonSettings([
        {
          id: 'btn-review',
          label: 'Review fix',
          playbookId: 'playbook-review',
          taskTypeIds: ['bug', 'feature'],
        },
      ]);

      const resolved = await resolveTaskPlaybookButtonSettingsResponse();
      expect(resolved.updatedAt).not.toBeNull();
      expect(resolved.taskPlaybookButtons).toEqual([
        {
          id: 'btn-review',
          label: 'Review fix',
          playbookId: 'playbook-review',
          taskTypeIds: ['bug', 'feature'],
        },
      ]);
    });
  });
});
