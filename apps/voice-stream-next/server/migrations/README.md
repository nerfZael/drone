# Voice Stream Next Database Migrations

Migration files live in this directory and run automatically when the server starts.

## File Names

Use a UTC timestamp prefix:

```text
YYYYMMDDHHMMSS_short_name.sql
```

Example:

```text
20260525190000_add_user_avatar_url.sql
```

The timestamp prefix is the migration version. Keep names lowercase and use underscores.

## Adding A Migration

1. Create a new `.sql` file with the current UTC timestamp prefix.
2. Put only the schema/data change for that migration in the file.
3. Do not edit older migration files after they have been committed.
4. Run the migration tests:

```bash
bun test server/src/db-migrations.test.ts
```

5. Run the server tests or typecheck if the schema change affects app code:

```bash
bun test server/src/*.test.ts
bun run --filter voice-stream-next typecheck
```

## Rules

- Migrations are forward-only.
- Each migration runs in a transaction.
- Checksums are stored in `schema_migrations`; changing an applied migration causes startup to fail.
- If a database has app tables but no migration history, startup fails with a clear error. Delete the local data file or migrate it manually.
- Back up the Railway volume before any destructive production migration.
