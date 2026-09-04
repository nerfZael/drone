/**
 * Builds the small JSON projection used by hot read models.
 *
 * Detailed transcript and prompt reads retain the complete activity history in
 * their owner tables. Hot fleet reads only need activity.updatedAt, so keeping
 * this projection separately prevents every read from scanning and rebuilding
 * hundreds of megabytes of duplicated activity messages.
 */
export function compactActivityJsonSql(column: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(column)) {
    throw new Error(`Unsafe SQLite column reference: ${column}`);
  }
  return `CASE
    WHEN json_valid(${column}) = 0 THEN ${column}
    WHEN COALESCE(json_type(${column}, '$.activity'), '') != 'object' THEN ${column}
    ELSE json_set(
      json_remove(${column}, '$.activity'),
      '$.activity',
      json_object('updatedAt', json_extract(${column}, '$.activity.updatedAt'))
    )
  END`;
}

/**
 * Extends the hot-read projection with enough metadata to render a completed
 * run without transferring or parsing its full message history. Counts are
 * computed when the turn is written, not on every chat read.
 */
export function summarizeActivityJsonSql(column: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(column)) {
    throw new Error(`Unsafe SQLite column reference: ${column}`);
  }
  const compact = compactActivityJsonSql(column);
  return `CASE
    WHEN json_valid(${column}) = 0 THEN ${compact}
    WHEN json_type(${column}, '$.activity') != 'object' THEN ${compact}
    WHEN json_type(${column}, '$.activity.messages') != 'array' THEN ${compact}
    ELSE json_set(
      ${compact},
      '$.activitySummary',
      json_object(
        'available', json('true'),
        'version', json_extract(${column}, '$.activity.version'),
        'source', json_extract(${column}, '$.activity.source'),
        'updatedAt', json_extract(${column}, '$.activity.updatedAt'),
        'messageCount', COALESCE(json_array_length(${column}, '$.activity.messages'), 0),
        'toolCallCount', (
          SELECT COUNT(*)
          FROM json_each(${column}, '$.activity.messages') AS message
          JOIN json_each(
            CASE
              WHEN json_type(message.value, '$.content') = 'array'
                THEN json_extract(message.value, '$.content')
              ELSE '[]'
            END
          ) AS part
          WHERE json_extract(part.value, '$.type') = 'toolCall'
        ),
        'truncated', CASE
          WHEN json_extract(${column}, '$.activity.truncated') = 1 THEN json('true')
          ELSE json('false')
        END
      )
    )
  END`;
}
