create table if not exists purchase_review (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid null references master_product(id),
  supplier_offer_id uuid null references supplier_offer(id),
  amount bigint not null check (amount > 0),
  currency text not null default 'jpy',
  status text not null check (status in ('AUTHORIZING','AWAITING_HUMAN','APPROVED','REJECTED','EXPIRED','FAILED')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  decision_snapshot jsonb not null default '{}'::jsonb,
  rejection_reason text,
  authorized_at timestamptz,
  reviewed_at timestamptz,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_review_status_idx on purchase_review(status, created_at desc);
create index if not exists purchase_review_master_idx on purchase_review(master_product_id);
create index if not exists purchase_review_supplier_offer_idx on purchase_review(supplier_offer_id);

alter table purchase_review enable row level security;
