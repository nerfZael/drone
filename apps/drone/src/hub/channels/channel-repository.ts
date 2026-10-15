import crypto from 'node:crypto';

import {
  applyHubDatabaseMigrations,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from '../../host/hub-database';
import type {
  Channel,
  ChannelChatLocation,
  ChannelMemberRecord,
  ChannelMessageAuthor,
  ChannelMessageMention,
  ChannelMessageRecord,
} from './channel-model';

export const CHANNEL_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'channels',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE channels (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_seq INTEGER NOT NULL DEFAULT 0,
          last_message_at TEXT,
          user_last_read_seq INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE channel_members (
          channel_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          drone_name TEXT NOT NULL,
          can_read INTEGER NOT NULL DEFAULT 1,
          can_send INTEGER NOT NULL DEFAULT 1,
          added_by_chat_id TEXT,
          added_at TEXT NOT NULL,
          PRIMARY KEY (channel_id, chat_id),
          FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_channel_members_chat ON channel_members (chat_id);

        CREATE TABLE channel_messages (
          id TEXT NOT NULL PRIMARY KEY,
          channel_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'chat')),
          author_chat_id TEXT,
          author_drone_id TEXT,
          author_chat_name TEXT,
          author_drone_name TEXT,
          text TEXT NOT NULL,
          reply_to_id TEXT,
          mentions_json TEXT NOT NULL DEFAULT '[]',
          mentions_user INTEGER NOT NULL DEFAULT 0,
          UNIQUE (channel_id, seq),
          FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_channel_messages_author_time ON channel_messages (author_chat_id, created_at);
      `);
    },
  },
];

type ChannelRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  last_seq: number;
  last_message_at: string | null;
  user_last_read_seq: number;
};

type MemberRow = {
  channel_id: string;
  chat_id: string;
  drone_id: string;
  chat_name: string;
  drone_name: string;
  can_read: number;
  can_send: number;
  added_by_chat_id: string | null;
  added_at: string;
};

type MessageRow = {
  id: string;
  channel_id: string;
  seq: number;
  created_at: string;
  author_kind: 'user' | 'chat';
  author_chat_id: string | null;
  author_drone_id: string | null;
  author_chat_name: string | null;
  author_drone_name: string | null;
  text: string;
  reply_to_id: string | null;
  mentions_json: string;
  mentions_user: number;
};

export type ChannelSummaryRecord = Channel & {
  memberCount: number;
  unreadCount: number;
  mentionCount: number;
};

export type NewChannelMessage = {
  channelId: string;
  author: ChannelMessageAuthor;
  text: string;
  replyToId: string | null;
  mentions: ChannelMessageMention[];
  mentionsUser: boolean;
};

export class ChannelRepository {
  constructor(private readonly database: HubDatabase) {
    this.database.read((connection) => applyHubDatabaseMigrations(connection, CHANNEL_MIGRATIONS, 'channels'));
  }

  listChannels(): ChannelSummaryRecord[] {
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `
          SELECT c.*,
            (SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = c.id) AS member_count,
            (SELECT COUNT(*) FROM channel_messages x
              WHERE x.channel_id = c.id AND x.seq > c.user_last_read_seq AND x.author_kind != 'user') AS unread_count,
            (SELECT COUNT(*) FROM channel_messages x
              WHERE x.channel_id = c.id AND x.seq > c.user_last_read_seq AND x.mentions_user = 1) AS mention_count
          FROM channels c
          ORDER BY lower(c.name), c.created_at
        `,
        )
        .all() as Array<ChannelRow & { member_count: number; unread_count: number; mention_count: number }>;
      return rows.map((row) => ({
        ...channelFromRow(row),
        memberCount: Number(row.member_count),
        unreadCount: Number(row.unread_count),
        mentionCount: Number(row.mention_count),
      }));
    });
  }

  getChannel(id: string): Channel | null {
    return this.database.read((connection) => {
      const row = connection.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
      return row ? channelFromRow(row) : null;
    });
  }

  channelNames(ids: readonly string[]): Map<string, string> {
    if (!ids.length) return new Map();
    return this.database.read((connection) => {
      const rows = connection
        .prepare(`SELECT id, name FROM channels WHERE id IN (${ids.map(() => '?').join(', ')})`)
        .all(...ids) as Array<{ id: string; name: string }>;
      return new Map(rows.map((row) => [row.id, row.name]));
    });
  }

  async createChannel(name: string): Promise<Channel> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    return await this.database.writeTransaction('create channel', (connection) => {
      connection
        .prepare('INSERT INTO channels (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, name, now, now);
      return channelFromRow(connection.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow);
    });
  }

  async renameChannel(id: string, name: string): Promise<Channel | null> {
    return await this.database.writeTransaction('rename channel', (connection) => {
      connection
        .prepare('UPDATE channels SET name = ?, updated_at = ? WHERE id = ?')
        .run(name, new Date().toISOString(), id);
      const row = connection.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
      return row ? channelFromRow(row) : null;
    });
  }

  async deleteChannel(id: string): Promise<boolean> {
    return await this.database.writeTransaction('delete channel', (connection) => {
      connection.prepare('DELETE FROM channel_messages WHERE channel_id = ?').run(id);
      connection.prepare('DELETE FROM channel_members WHERE channel_id = ?').run(id);
      return Number(connection.prepare('DELETE FROM channels WHERE id = ?').run(id).changes ?? 0) > 0;
    });
  }

  async markUserRead(id: string, seq: number): Promise<void> {
    await this.database.writeTransaction('mark channel read', (connection) => {
      connection
        .prepare(
          'UPDATE channels SET user_last_read_seq = MAX(user_last_read_seq, MIN(?, last_seq)) WHERE id = ?',
        )
        .run(Math.max(0, Math.floor(seq)), id);
    });
  }

  listMembers(channelId: string): ChannelMemberRecord[] {
    return this.database.read((connection) => {
      const rows = connection
        .prepare('SELECT * FROM channel_members WHERE channel_id = ? ORDER BY added_at, chat_id')
        .all(channelId) as MemberRow[];
      return rows.map(memberFromRow);
    });
  }

  getMember(channelId: string, chatId: string): ChannelMemberRecord | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare('SELECT * FROM channel_members WHERE channel_id = ? AND chat_id = ?')
        .get(channelId, chatId) as MemberRow | undefined;
      return row ? memberFromRow(row) : null;
    });
  }

  /** The channels a chat is a member of, with its membership. */
  membershipsForChat(chatId: string): Array<{ channel: Channel; member: ChannelMemberRecord }> {
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `
          SELECT c.*, m.channel_id AS m_channel_id, m.chat_id AS m_chat_id, m.drone_id AS m_drone_id,
            m.chat_name AS m_chat_name, m.drone_name AS m_drone_name, m.can_read AS m_can_read,
            m.can_send AS m_can_send, m.added_by_chat_id AS m_added_by_chat_id, m.added_at AS m_added_at
          FROM channel_members m
          INNER JOIN channels c ON c.id = m.channel_id
          WHERE m.chat_id = ?
          ORDER BY lower(c.name), c.created_at
        `,
        )
        .all(chatId) as Array<ChannelRow & Record<string, any>>;
      return rows.map((row) => ({
        channel: channelFromRow(row),
        member: memberFromRow({
          channel_id: row.m_channel_id,
          chat_id: row.m_chat_id,
          drone_id: row.m_drone_id,
          chat_name: row.m_chat_name,
          drone_name: row.m_drone_name,
          can_read: row.m_can_read,
          can_send: row.m_can_send,
          added_by_chat_id: row.m_added_by_chat_id,
          added_at: row.m_added_at,
        }),
      }));
    });
  }

  /** Adds chats that are not members yet; returns the ones added. */
  async addMembers(
    channelId: string,
    chats: readonly ChannelChatLocation[],
    addedByChatId: string | null,
    maxMembers: number,
  ): Promise<ChannelMemberRecord[]> {
    const now = new Date().toISOString();
    return await this.database.writeTransaction('add channel members', (connection) => {
      if (!connection.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId)) {
        throw new Error('channel not found');
      }
      const count = (connection
        .prepare('SELECT COUNT(*) AS count FROM channel_members WHERE channel_id = ?')
        .get(channelId) as { count: number }).count;
      const insert = connection.prepare(`
        INSERT OR IGNORE INTO channel_members (
          channel_id, chat_id, drone_id, chat_name, drone_name, can_read, can_send, added_by_chat_id, added_at
        ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      `);
      const isMember = connection.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND chat_id = ?');
      const added: ChannelMemberRecord[] = [];
      for (const chat of chats) {
        if (isMember.get(channelId, chat.chatId)) continue;
        if (Number(count) + added.length >= maxMembers) {
          throw new Error(`a channel can have at most ${maxMembers} member chats`);
        }
        const result = insert.run(
          channelId,
          chat.chatId,
          chat.droneId,
          chat.chatName,
          chat.droneName || chat.droneId,
          addedByChatId,
          now,
        );
        if (Number(result.changes ?? 0) !== 1) continue;
        added.push(
          memberFromRow(
            connection
              .prepare('SELECT * FROM channel_members WHERE channel_id = ? AND chat_id = ?')
              .get(channelId, chat.chatId) as MemberRow,
          ),
        );
      }
      if (added.length) {
        connection.prepare('UPDATE channels SET updated_at = ? WHERE id = ?').run(now, channelId);
      }
      return added;
    });
  }

  async removeMember(channelId: string, chatId: string): Promise<boolean> {
    return await this.database.writeTransaction('remove channel member', (connection) => {
      const removed = connection
        .prepare('DELETE FROM channel_members WHERE channel_id = ? AND chat_id = ?')
        .run(channelId, chatId);
      return Number(removed.changes ?? 0) > 0;
    });
  }

  async setMemberPermissions(
    channelId: string,
    chatId: string,
    permissions: { canRead?: boolean; canSend?: boolean },
  ): Promise<ChannelMemberRecord | null> {
    return await this.database.writeTransaction('update channel member', (connection) => {
      const row = connection
        .prepare('SELECT * FROM channel_members WHERE channel_id = ? AND chat_id = ?')
        .get(channelId, chatId) as MemberRow | undefined;
      if (!row) return null;
      connection
        .prepare('UPDATE channel_members SET can_read = ?, can_send = ? WHERE channel_id = ? AND chat_id = ?')
        .run(
          (permissions.canRead ?? Boolean(row.can_read)) ? 1 : 0,
          (permissions.canSend ?? Boolean(row.can_send)) ? 1 : 0,
          channelId,
          chatId,
        );
      return memberFromRow(
        connection
          .prepare('SELECT * FROM channel_members WHERE channel_id = ? AND chat_id = ?')
          .get(channelId, chatId) as MemberRow,
      );
    });
  }

  /** Keeps the remembered names of member chats current, so a later archive or delete still shows them. */
  async refreshMemberLocations(locations: readonly ChannelChatLocation[]): Promise<void> {
    if (!locations.length) return;
    await this.database.writeTransaction('refresh channel member names', (connection) => {
      const update = connection.prepare(`
        UPDATE channel_members SET drone_id = ?, chat_name = ?, drone_name = ?
        WHERE chat_id = ? AND (drone_id != ? OR chat_name != ? OR drone_name != ?)
      `);
      for (const location of locations) {
        const droneName = location.droneName || location.droneId;
        update.run(
          location.droneId,
          location.chatName,
          droneName,
          location.chatId,
          location.droneId,
          location.chatName,
          droneName,
        );
      }
    });
  }

  /**
   * Stores a message with the next sequence number. `alsoInTransaction` records the message's
   * subscription events in the same transaction, so a message is never stored without them.
   */
  async appendMessage(
    input: NewChannelMessage,
    alsoInTransaction?: (connection: HubDatabaseConnection, message: ChannelMessageRecord) => void,
  ): Promise<ChannelMessageRecord> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    return await this.database.writeTransaction('append channel message', (connection) => {
      const channel = connection.prepare('SELECT * FROM channels WHERE id = ?').get(input.channelId) as
        | ChannelRow
        | undefined;
      if (!channel) throw new Error('channel not found');
      const seq = Number(channel.last_seq) + 1;
      const author = input.author;
      connection
        .prepare(
          `
          INSERT INTO channel_messages (
            id, channel_id, seq, created_at, author_kind, author_chat_id, author_drone_id,
            author_chat_name, author_drone_name, text, reply_to_id, mentions_json, mentions_user
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id,
          input.channelId,
          seq,
          now,
          author.kind,
          author.kind === 'chat' ? author.chatId : null,
          author.kind === 'chat' ? author.droneId : null,
          author.kind === 'chat' ? author.chatName : null,
          author.kind === 'chat' ? author.droneName : null,
          input.text,
          input.replyToId,
          JSON.stringify(input.mentions),
          input.mentionsUser ? 1 : 0,
        );
      // The user has read everything up to their own message.
      connection
        .prepare(
          `UPDATE channels SET last_seq = ?, last_message_at = ?, updated_at = ?${author.kind === 'user' ? ', user_last_read_seq = ?' : ''} WHERE id = ?`,
        )
        .run(...[seq, now, now, ...(author.kind === 'user' ? [seq] : []), input.channelId]);
      const message = messageFromRow(
        connection.prepare('SELECT * FROM channel_messages WHERE id = ?').get(id) as MessageRow,
      );
      alsoInTransaction?.(connection, message);
      return message;
    });
  }

  getMessage(channelId: string, id: string): ChannelMessageRecord | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare('SELECT * FROM channel_messages WHERE channel_id = ? AND id = ?')
        .get(channelId, id) as MessageRow | undefined;
      return row ? messageFromRow(row) : null;
    });
  }

  getMessages(channelId: string, ids: readonly string[]): Map<string, ChannelMessageRecord> {
    if (!ids.length) return new Map();
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `SELECT * FROM channel_messages WHERE channel_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
        )
        .all(channelId, ...ids) as MessageRow[];
      return new Map(rows.map((row) => [row.id, messageFromRow(row)]));
    });
  }

  /**
   * A page of messages in order. Without bounds it is the newest page; `beforeSeq` pages back
   * and `afterSeq` reads forward from a position.
   */
  listMessages(
    channelId: string,
    input: { beforeSeq?: number; afterSeq?: number; limit: number },
  ): { messages: ChannelMessageRecord[]; hasMore: boolean } {
    return this.database.read((connection) => {
      const limit = Math.max(1, Math.floor(input.limit));
      const forward = input.afterSeq !== undefined;
      const rows = connection
        .prepare(
          forward
            ? 'SELECT * FROM channel_messages WHERE channel_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?'
            : 'SELECT * FROM channel_messages WHERE channel_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?',
        )
        .all(
          channelId,
          forward ? input.afterSeq : (input.beforeSeq ?? Number.MAX_SAFE_INTEGER),
          limit + 1,
        ) as MessageRow[];
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map(messageFromRow);
      return { messages: forward ? page : page.reverse(), hasMore };
    });
  }

  countChatMessagesSince(chatId: string, sinceIso: string): number {
    return this.database.read((connection) =>
      Number(
        (connection
          .prepare(
            'SELECT COUNT(*) AS count FROM channel_messages WHERE author_chat_id = ? AND created_at >= ?',
          )
          .get(chatId, sinceIso) as { count: number }).count,
      ),
    );
  }

  /**
   * A chat by drone (ID or name) and chat name, among chats the Hub knows. Archived chats are
   * not found: they cannot join a channel until they are restored.
   */
  findChat(droneRef: string, chatName: string): ChannelChatLocation | null {
    return this.database.read((connection) => {
      type Row = { chat_id: string | null; drone_id: string; chat_name: string; drone_name?: string | null };
      let rows: Row[];
      try {
        rows = connection
          .prepare(
            `
            SELECT json_extract(c.metadata_json, '$.id') AS chat_id, c.drone_id, c.chat_name, d.name AS drone_name
            FROM canonical_chats c
            LEFT JOIN hub_canonical_drones d ON d.drone_id = c.drone_id
            WHERE (c.drone_id = ? OR d.name = ?) AND c.chat_name = ?
          `,
          )
          .all(droneRef, droneRef, chatName) as Row[];
      } catch {
        // Stores without the drone read model can still be addressed by drone ID.
        rows = connection
          .prepare(
            `
            SELECT json_extract(metadata_json, '$.id') AS chat_id, drone_id, chat_name
            FROM canonical_chats WHERE drone_id = ? AND chat_name = ?
          `,
          )
          .all(droneRef, chatName) as Row[];
      }
      const exact = rows.find((row) => row.drone_id === droneRef) ?? (rows.length === 1 ? rows[0] : undefined);
      if (!exact?.chat_id) return null;
      return {
        chatId: String(exact.chat_id),
        droneId: exact.drone_id,
        chatName: exact.chat_name,
        ...(exact.drone_name ? { droneName: exact.drone_name } : {}),
      };
    });
  }
}

function channelFromRow(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeq: Number(row.last_seq),
    lastMessageAt: row.last_message_at,
    userLastReadSeq: Number(row.user_last_read_seq),
  };
}

function memberFromRow(row: MemberRow): ChannelMemberRecord {
  return {
    channelId: row.channel_id,
    chatId: row.chat_id,
    droneId: row.drone_id,
    chatName: row.chat_name,
    droneName: row.drone_name,
    canRead: Boolean(row.can_read),
    canSend: Boolean(row.can_send),
    addedByChatId: row.added_by_chat_id,
    addedAt: row.added_at,
  };
}

function messageFromRow(row: MessageRow): ChannelMessageRecord {
  let mentions: ChannelMessageMention[] = [];
  try {
    const parsed = JSON.parse(row.mentions_json);
    if (Array.isArray(parsed)) mentions = parsed;
  } catch {
    mentions = [];
  }
  return {
    id: row.id,
    channelId: row.channel_id,
    seq: Number(row.seq),
    createdAt: row.created_at,
    author:
      row.author_kind === 'chat'
        ? {
            kind: 'chat',
            chatId: row.author_chat_id ?? '',
            droneId: row.author_drone_id ?? '',
            chatName: row.author_chat_name ?? '',
            droneName: row.author_drone_name ?? '',
          }
        : { kind: 'user' },
    text: row.text,
    replyToId: row.reply_to_id,
    mentions,
    mentionsUser: Boolean(row.mentions_user),
  };
}
