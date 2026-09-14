# resolved_model additive migration receipt (2026-09-14)

- Snapshot: `p1a-pre-resolvedmodel-20260914035539.db`
- sha256: `33210a1fd1d88558aefd423738755cac2b27a1433186fe7dab9147ff922e29d4`
- Snapshot rows=3662 (VACUUM INTO, WAL-aware)
- Migration: verdicts additive column `resolved_model TEXT` (old rows NULL, not backfilled)
- Rows after=3662 | integrity_check={"integrity_check":"ok"}
- Rationale: dual-chain observability (declared model vs factual resolved_model). Precedent: batch 0.5 model/run_id additive migration on same table
- Rollback: `cp .scratch/backup/p1a-pre-resolvedmodel-20260914035539.db p1a-terminal/data/p1a.db` (stop 8787 first)
