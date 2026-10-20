import fs from 'node:fs/promises';
import path from 'node:path';
import { droneRootPath } from '../host/paths';
import { hubChangeEvents } from './hub-change-events';
import { listChatIdentitiesFromStore, type ChatIdentityStoreListResult } from './transcript-store';

/**
 * Every agent chat has a home: a folder of its own on this device, made the first time the chat's workspaces are read
 * and granted to it beside its drone's workspace, so the user never has to create one. The folder belongs to the chat,
 * keyed by the chat's stable id (renames keep it): it stays while the chat is archived and is deleted, with everything
 * in it, once the chat is gone for good: deleted, purged from the archive, or deleted with its drone.
 */
export const CHAT_HOME_WORKSPACE_PREFIX = 'chat-home-';

const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SWEEP_DELAY_MS = 2_000;
const SWEEP_INTERVAL_MS = 30 * 60_000;

export type ChatHome = {
  chatId: string;
  droneId: string;
  chatName: string;
  root: string;
};

export function chatHomesDirectory(): string {
  return droneRootPath('chat-homes');
}

/** The id pickers, grants and the explorer use for a chat's home. */
export function chatHomeTargetId(chatId: string): string {
  return `host:${CHAT_HOME_WORKSPACE_PREFIX}${chatId}`;
}

export function chatHomeRoot(chatId: string, directory = chatHomesDirectory()): string {
  if (!CHAT_ID.test(chatId)) throw new Error(`Invalid chat id for a home workspace: ${chatId}`);
  return path.join(directory, chatId);
}

export class ChatHomes {
  private sweeping: Promise<string[]> | null = null;
  private sweepAgain = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly directory: () => string = chatHomesDirectory,
    private readonly chats: () => ChatIdentityStoreListResult = listChatIdentitiesFromStore,
  ) {}

  /** Makes the chat's home if it has none; `created` says this call made it. */
  async ensure(chatId: string): Promise<{ root: string; created: boolean }> {
    const root = chatHomeRoot(chatId, this.directory());
    await fs.mkdir(path.dirname(root), { recursive: true });
    try {
      await fs.mkdir(root);
      // Workspace lists (pickers, explorer roots, link resolution) in every open window pick it up.
      hubChangeEvents.emitUserWorkspacesChange();
      return { root, created: true };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      return { root, created: false };
    }
  }

  /** Homes whose folder is there and whose chat still exists (archived ones included). */
  async list(): Promise<ChatHome[]> {
    const folders = await this.folders();
    if (!folders.length) return [];
    const result = this.chats();
    if (!result.available) return [];
    const byId = new Map(result.chats.map((chat) => [chat.chatId, chat]));
    return folders.flatMap((chatId) => {
      const chat = byId.get(chatId);
      return chat ? [{ chatId, droneId: chat.droneId, chatName: chat.chatName, root: chatHomeRoot(chatId, this.directory()) }] : [];
    });
  }

  /**
   * Deletes the homes of chats that no longer exist, files and all. Folders are listed before chats are read, so a
   * home made meanwhile (only ever for a chat that exists) is never mistaken for an orphan. Returns the deleted ids.
   */
  sweep(): Promise<string[]> {
    if (this.sweeping) {
      this.sweepAgain = true;
      return this.sweeping;
    }
    const run = (async () => {
      const deleted: string[] = [];
      try {
        do {
          this.sweepAgain = false;
          const folders = await this.folders();
          if (!folders.length) continue;
          const result = this.chats();
          // Without the chat list nothing can be called an orphan. A Hub with no chats at all more likely lost its
          // database than its chats, so homes wait for the next sweep after a chat exists again.
          if (!result.available || !result.chats.length) continue;
          const existing = new Set(result.chats.map((chat) => chat.chatId));
          for (const chatId of folders) {
            if (existing.has(chatId)) continue;
            await fs.rm(chatHomeRoot(chatId, this.directory()), { recursive: true, force: true });
            deleted.push(chatId);
          }
        } while (this.sweepAgain);
        if (deleted.length) hubChangeEvents.emitUserWorkspacesChange();
        return deleted;
      } finally {
        this.sweeping = null;
      }
    })();
    this.sweeping = run;
    return run;
  }

  /** Sweeps shortly after chats are removed; several removals in a row sweep once. */
  scheduleSweep(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sweep().catch((error) => console.warn('[chat-homes] sweep failed', error));
    }, SWEEP_DELAY_MS);
    this.timer.unref?.();
  }

  /**
   * Sweeps now and every few minutes, catching removals made outside this process (the CLI) or while the Hub was down.
   * Returns a stop function.
   */
  startSweeping(): () => void {
    this.scheduleSweep();
    const interval = setInterval(() => this.scheduleSweep(), SWEEP_INTERVAL_MS);
    interval.unref?.();
    return () => {
      clearInterval(interval);
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    };
  }

  /** Chat ids that have a home folder. Anything else in the directory is left alone. */
  private async folders(): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(this.directory(), { withFileTypes: true });
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return entries.filter((entry) => entry.isDirectory() && CHAT_ID.test(entry.name)).map((entry) => entry.name);
  }
}

let shared: ChatHomes | null = null;
export function chatHomes(): ChatHomes {
  shared ??= new ChatHomes();
  return shared;
}
