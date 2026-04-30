# Database Migrations

Hand-written, explicit SQL migrations. Applied directly to the database via
`psql $DATABASE_URL -f migrations/<file>.sql`. **Drizzle-kit's `db:push` is not
used in this project** — schema changes are deliberate, reviewed, and reversible.

## File naming

```
<NNNN>_<short_name>.sql      # forward (up) migration
<NNNN>_<short_name>.down.sql # rollback (down) migration
```

`NNNN` is a zero-padded 4-digit sequence number that increments per migration.

## Apply procedure

1. Read the up-migration file end-to-end. Confirm scope.
2. Take a baseline count of any existing table that will be touched
   (e.g. `SELECT count(*) FROM calendar_events;`).
3. Apply:
   ```bash
   psql "$DATABASE_URL" -f migrations/<file>.sql
   ```
4. Run the post-flight verification queries embedded in the comments at the
   bottom of the up-migration file.
5. Smoke-test the affected user-facing surfaces (e.g. open the unified inbox,
   open the calendar) to confirm no regression.
6. Commit any schema-file changes that match the migration.

## Rollback procedure

1. Stop application traffic if practical (or accept that any in-flight inserts
   referencing the dropped tables will fail).
2. Apply:
   ```bash
   psql "$DATABASE_URL" -f migrations/<file>.down.sql
   ```
3. Run the post-rollback verification queries embedded in the down file.
4. Revert the corresponding schema-file changes (`shared/schema.ts`).

## Index of migrations

| #    | File                              | Adds                                                                                  | Reversible |
|------|-----------------------------------|----------------------------------------------------------------------------------------|------------|
| 0001 | `0001_zoom_and_booking_links.sql` | `zoom_connections`, `booking_links`, `booking_link_recipients` + `calendar_events.booking_link_recipient_id` column | yes |
