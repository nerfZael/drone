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
