-- 008: Record who requested a purchase authorization and the terms that were re-verified.
alter table purchase_review add column if not exists requested_by_user_id uuid;
alter table purchase_review add column if not exists requested_by_email text;
alter table purchase_review add column if not exists verified_terms jsonb not null default '{}'::jsonb;
