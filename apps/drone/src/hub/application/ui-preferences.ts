import {
  UiPreferencesSettingsConflictError,
  UiPreferencesSettingsValidationError,
  resolveUiPreferencesSettingsResponse,
  upsertStoredUiPreferencesSettings,
} from '../hub-settings';
import { DomainConflictError, InvalidRequestError } from '../domain-errors';
import type { HubApplicationEvents } from './hub-application-events';

export type UiPreferencesSnapshot = {
  ok?: true;
  uiPreferences: Record<string, unknown>;
  updatedAt?: string | null;
  version: number | null;
} & Record<string, unknown>;

export type UiPreferencesDependencies = {
  read(): Promise<UiPreferencesSnapshot>;
  write(uiPreferences: unknown, expectedVersion?: number | null): Promise<void>;
};

const defaultDependencies: UiPreferencesDependencies = {
  read: resolveUiPreferencesSettingsResponse,
  write: upsertStoredUiPreferencesSettings,
};

export class UiPreferencesService {
  constructor(
    private readonly events: HubApplicationEvents,
    private readonly dependencies: UiPreferencesDependencies = defaultDependencies,
  ) {}

  read(): Promise<UiPreferencesSnapshot> {
    return this.dependencies.read();
  }

  async update(input: {
    uiPreferences: unknown;
    expectedVersion?: number | null;
    notificationMode?: 'default' | 'sidebar-snapshot';
  }): Promise<UiPreferencesSnapshot> {
    try {
      await this.dependencies.write(input.uiPreferences, input.expectedVersion);
    } catch (error) {
      if (error instanceof UiPreferencesSettingsConflictError) {
        throw new DomainConflictError(error.message, {
          uiPreferences: error.uiPreferences,
          updatedAt: error.updatedAt,
          version: error.version,
        });
      }
      if (error instanceof UiPreferencesSettingsValidationError) {
        throw new InvalidRequestError(error.message);
      }
      throw error;
    }
    await this.events.emit({
      type: 'ui-preferences.changed',
      notificationMode: input.notificationMode ?? 'default',
    });
    return await this.dependencies.read();
  }
}
