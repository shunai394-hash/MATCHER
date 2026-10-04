-- MATCHER one-product trace (READ ONLY). Shows every pipeline stage for one supplier product.
--   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -v supplier_key=netsea -v supplier_product_id=NS-1001 -f db/ops/trace_supplier_product.sql
begin transaction read only;
\echo '== 1 supplier_product'
select sp.id, s.supplier_key, sp.supplier_product_id, sp.product_name, sp.brand, sp.model_number, sp.first_seen_at, sp.last_seen_at
from supplier_product sp join suppliers s on s.id = sp.supplier_id
where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id';
\echo '== 1b supplier_product_identifier'
select spi.identifier_type, spi.identifier_value from supplier_product_identifier spi
join supplier_product sp on sp.id = spi.supplier_product_id join suppliers s on s.id = sp.supplier_id
where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id';
\echo '== 2 supplier_offer (expect exactly one per currency)'
select so.id, so.currency, so.orderability, so.updated_at from supplier_offer so
join supplier_product sp on sp.id = so.supplier_product_id join suppliers s on s.id = sp.supplier_id
where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id';
\echo '== 3 latest supplier_offer_snapshot'
select distinct on (so.id) so.id as offer_id, ss.supplier_cost, ss.shipping_cost, ss.inventory, ss.shipping_confidence, ss.observed_at
from supplier_offer so join supplier_offer_snapshot ss on ss.supplier_offer_id = so.id
join supplier_product sp on sp.id = so.supplier_product_id join suppliers s on s.id = sp.supplier_id
where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id'
order by so.id, ss.observed_at desc;
\echo '== 4 supplier_offer_freshness'
select f.supplier_offer_id, f.price_observed_at, f.inventory_observed_at, f.shipping_observed_at, f.updated_at
from supplier_offer_freshness f join supplier_offer so on so.id = f.supplier_offer_id
join supplier_product sp on sp.id = so.supplier_product_id join suppliers s on s.id = sp.supplier_id
where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id';
\echo '== 5+6 identity_match history (newest first) and linked master_product'
select im.created_at, im.decision, im.hard_block, im.confidence, mp.id as master_product_id, mp.product_name, mp.status, mp.approval_status, mp.origin
from identity_match im join supplier_product sp on sp.id = im.supplier_product_id join suppliers s on s.id = sp.supplier_id
left join master_product mp on mp.id = im.master_product_id
where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id'
order by im.created_at desc;
\echo '== 7 latest market_price_observation for the linked master (product level)'
select mpo.source, mpo.sale_price, mpo.payment_fee, mpo.marketplace_fee, mpo.tax, mpo.other_cost, mpo.observed_at
from market_price_observation mpo
where mpo.product_variant_id is null and mpo.master_product_id = (
  select im.master_product_id from identity_match im join supplier_product sp on sp.id = im.supplier_product_id join suppliers s on s.id = sp.supplier_id
  where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id' order by im.created_at desc limit 1)
order by mpo.observed_at desc limit 1;
\echo '== 8 latest profit_snapshot'
select distinct on (p.supplier_offer_id) p.supplier_offer_id, p.sale_price, p.supplier_cost, p.shipping_cost, p.payment_fee, p.marketplace_fee, p.tax, p.other_cost, p.expected_profit, p.cost_complete, p.calculated_at
from profit_snapshot p join supplier_offer so on so.id = p.supplier_offer_id
join supplier_product sp on sp.id = so.supplier_product_id join suppliers s on s.id = sp.supplier_id
where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id'
order by p.supplier_offer_id, p.calculated_at desc;
\echo '== 9 latest quality_gate_result'
select distinct on (g.supplier_offer_id) g.supplier_offer_id, g.status, g.blocking_reasons, g.evaluated_at
from quality_gate_result g join supplier_offer so on so.id = g.supplier_offer_id
join supplier_product sp on sp.id = so.supplier_product_id join suppliers s on s.id = sp.supplier_id
where s.supplier_key = :'supplier_key' and sp.supplier_product_id = :'supplier_product_id'
order by g.supplier_offer_id, g.evaluated_at desc;
\echo '== 10 opportunity: check GET /api/opportunities for this supplierOfferId (the API re-checks everything live)'
rollback;
