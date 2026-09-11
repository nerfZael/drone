import { getHubSettingsRepository } from '../../host/hub-settings-repository';

export async function readCompanionAutoApproveSettings(): Promise<{ enabled: boolean }> {
  const record = (await getHubSettingsRepository()).get<{ enabled?: unknown }>('companion-auto-approve');
  return { enabled: record?.value?.enabled === true };
}

export async function writeCompanionAutoApproveSettings(value: unknown): Promise<{ enabled: boolean }> {
  if (!value || typeof value !== 'object' || typeof (value as { enabled?: unknown }).enabled !== 'boolean') {
    throw new Error('Auto-approve proposals enabled must be a boolean.');
  }
  const settings = { enabled: (value as { enabled: boolean }).enabled };
  await (await getHubSettingsRepository()).put('companion-auto-approve', settings);
  return settings;
}
