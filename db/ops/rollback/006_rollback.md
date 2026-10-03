# Rollback of 006

006 is idempotent and, on a database already in the reported production shape, changes nothing
except what `db/ops/preflight.sql` reported as missing. There is no generic rollback SQL because the
correct inverse depends on what was missing before. Use the preflight log taken in step 2:

| Preflight said missing before 006 | Inverse (only if the object is still empty / unused) |
|---|---|
| `supplier_product.<col>` (product_name, manufacturer, color, size, capacity, generation, set_count, condition, first_seen_at, last_seen_at) | `alter table supplier_product drop column <col>;` |
| `supplier_offer.updated_at` / `supplier_offer_freshness.updated_at` | `alter table … drop column updated_at;` |
| table `supplier_offer_snapshot`, `identity_match`, `quality_patrol_run`, `quality_diagnosis` | `drop table …;` only if it has 0 rows |
| constraint `supplier_product_set_count_check` | `alter table supplier_product drop constraint supplier_product_set_count_check;` |
| index `idx_supplier_product_last_seen`, `idx_supplier_offer_snapshot_offer`, `idx_identity_match_*`, `idx_gate_evaluated` | `drop index …;` |
| trigger `identity_match_hard_block_guard` | `drop trigger identity_match_hard_block_guard on identity_match;` |
| function `prevent_auto_link_hard_block` (definition printed by preflight) | re-run the saved `CREATE OR REPLACE FUNCTION …` text |
| RLS was OFF on a table | `alter table … disable row level security;` |

006 never drops a column that holds data (it stops instead), so no data has to be restored.
If 006 renamed `match_result` → `identity_match` (only when identity_match did not exist):
`alter table identity_match rename to match_result;`
