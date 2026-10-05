-- Pass 12: cover foreign keys used by identity, media, profit and quality cascades.
do $migration$
begin
  if to_regclass('public.identity_match_evidence') is not null then
    create index if not exists idx_identity_match_evidence_match
      on public.identity_match_evidence(identity_match_id);
  end if;
  if to_regclass('public.product_media') is not null then
    create index if not exists idx_product_media_master
      on public.product_media(master_product_id);
    create index if not exists idx_product_media_variant
      on public.product_media(product_variant_id);
  end if;
  if to_regclass('public.profit_snapshot') is not null then
    create index if not exists idx_profit_snapshot_offer
      on public.profit_snapshot(supplier_offer_id);
  end if;
  if to_regclass('public.quality_diagnosis') is not null then
    create index if not exists idx_quality_diagnosis_offer
      on public.quality_diagnosis(supplier_offer_id);
  end if;
  if to_regclass('public.quality_repair') is not null then
    create index if not exists idx_quality_repair_diagnosis
      on public.quality_repair(diagnosis_id);
  end if;
  if to_regclass('public.quality_retest') is not null then
    create index if not exists idx_quality_retest_diagnosis
      on public.quality_retest(diagnosis_id);
  end if;
end
$migration$;

drop index if exists public.idx_supplier_offer_snapshot_offer;
