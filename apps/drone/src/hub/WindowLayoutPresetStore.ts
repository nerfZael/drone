import { validateWindowLayoutPreset, WINDOW_LAYOUT_SLOTS } from '@drone/hub-model';
import { droneRootPath } from '../host/paths';
import { openUsageDatabase } from './usage/helpers/openUsageDatabase';

export class WindowLayoutPresetStore {
  private readonly db: import('better-sqlite3').Database;

  constructor(file = droneRootPath('window-layout-presets.sqlite')) {
    this.db = openUsageDatabase(file);
    this.db.exec('CREATE TABLE IF NOT EXISTS window_layout_presets (slot TEXT PRIMARY KEY CHECK(slot IN (\'0\',\'1\',\'2\',\'3\',\'4\',\'5\',\'6\',\'7\',\'8\',\'9\')), layout TEXT NOT NULL)');
  }

  list(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT slot, layout FROM window_layout_presets').all() as { slot: string; layout: string }[];
    return Object.fromEntries(rows.map(row => [row.slot, JSON.parse(row.layout)]));
  }

  save(slot: string, layout: unknown): void {
    if (!(WINDOW_LAYOUT_SLOTS as readonly string[]).includes(slot)) throw new Error('Preset slot must be a single digit');
    validateWindowLayoutPreset(layout);
    this.db.prepare('INSERT INTO window_layout_presets(slot, layout) VALUES (?, ?) ON CONFLICT(slot) DO UPDATE SET layout = excluded.layout')
      .run(slot, JSON.stringify(layout));
  }

  close(): void { this.db.close(); }
}
