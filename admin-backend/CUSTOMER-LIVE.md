# Customer incremental sync

Enable with `CUSTOMER_LIVE_ENABLED=true` after building and running
`node scripts/prepare-customer-live.cjs`. The script only creates five new
`customer_live_*` tables and a restricted callback configuration file. It never
modifies existing business tables. Disable the flag and restart to return to
snapshot queries; keep the new tables and snapshots for recovery.

Run one backend process (PM2 fork, one instance). The durable worker and import
loop resume committed state after restart. Do not run multiple instances of this
worker against one database. Existing full-sync checkpoints are preserved and
interrupted jobs are automatically requeued when incremental mode starts.

Initial import reads existing immutable snapshots in batches of 300. During import
queries continue using the old snapshot. Observations from imports have priority
0 and never overwrite a live observation or a deletion tombstone. Reconciliation
updates are keyed by entity credential fingerprint plus customer and employee ID.
Do not interpret relationship counts as deduplicated customer counts.
The exact active-relationship count is initialized once and then changed in the
same transaction as inserts, restorations and deletions. The entity state row
serializes these writes so repeated or concurrent notifications cannot inflate
the count. Do not update relationship rows directly without maintaining this count.

Each employee ID list is compared against saved relationships. New IDs
are fetched individually; changes exceeding both 25 records and twice the
estimated batch-page count use the employee batch endpoint with
durable page cursors. Recently active employees are due every 15 minutes, others
every 6 hours. These are eligibility intervals, not freshness guarantees: the
rate-limited, fair worker may take longer. A 01:00-06:00 Shanghai rolling employee
detail audit catches edits; a Sunday 02:00 full sync provides a further baseline.
Transient -1/network failures use the existing 5/15/45-second retries, followed
by durable exponential backoff capped at 30 minutes. Permanent permission errors
remain visible with bounded retry traffic; they do not clear saved data.

## WeCom callback setup

For each enterprise, configure its customer-contact event callback to:
`https://<production-host>/api/wecom/customer-events/<entity-id>`.
Use that entity's token and EncodingAESKey from the permission-600 server file
`data/customer-callbacks.json` (or `CUSTOMER_CALLBACK_CONFIG`). Do not commit or
log credentials. Existing callback consumers must be forwarded/integrated, not
silently replaced. HTTPS/domain setup and enterprise-admin verification are
separate prerequisites. Until real events arrive the UI explicitly reports that
callbacks are not connected; ID-list polling still works without callbacks.
When forwarding an existing encrypted notification, coordinate signing/encryption
keys with its current receiver; newly generated keys are not automatically
compatible with another system's existing callback.

Deployment on 2026-10-13 left all existing enterprise callback settings unchanged.
The server's inspected nginx configuration had no HTTPS listener or configured
domain. Polling is active; event integration remains pending coordination with the
existing callback provider. Application backup: server-local
`/opt/resource-admin/backups/customer-live-2026-10-13T05-22-50/app.tar.gz`.

GET verifies the signed encrypted challenge. POST verifies signature, timestamp,
AES padding and receiving corpid; XML DTDs/entities are forbidden. Events and
deduplicated detail tasks commit in one transaction before replying success.
Notifications trigger a re-read of current state, not blind application of a
possibly reordered add/delete event. IDs stay strings. Callback backlog survives
initial import and process restart. Event hashes are retained for 30 days.

## Verification

`npm run build`
`node --import tsx --test tests/*.test.mjs`
`CUSTOMER_LIVE_TEST_DB=true node --import tsx --test tests/customer-live.test.mjs`

The integration test refuses non-local DB hosts, uses a synthetic entity, mocks
all WeCom HTTP calls, and cleans up its own rows. Production verification should
use authenticated read-only status/snapshot requests, aggregate counts and health
checks, never dump customer payloads or tokens.
