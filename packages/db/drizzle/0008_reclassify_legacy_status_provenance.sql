-- Conservative correction for databases that already ran the original 0003 migration.
-- Old status rows had no event-level raw evidence; copying the parent initiative source
-- was not sufficient to call them official source history.
UPDATE "status_events"
   SET "source" = 'legacy-unattributed',
       "source_url" = NULL,
       "evidence_type" = 'LEGACY_UNATTRIBUTED'
 WHERE "evidence_type" = 'SOURCE_HISTORY'
   AND "raw" IS NULL;
