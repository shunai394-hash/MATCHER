import os
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="MATCHER API", version="1.0.0")


def db():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL is not configured")
    return psycopg.connect(url)


class ProductSearch(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=20, ge=1, le=100)


@app.get("/health")
def health() -> dict[str, str]:
    try:
        with db() as conn:
            conn.execute("select 1")
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="database unavailable")


@app.get("/v1/products/{product_id}")
def get_product(product_id: UUID) -> dict[str, Any]:
    sql = """
    select
      mp.id, mp.brand, mp.product_name, mp.manufacturer, mp.model_number,
      mp.status, mp.created_at, mp.updated_at,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'type', pi.identifier_type,
            'value', pi.identifier_value,
            'source', pi.source,
            'primary', pi.is_primary
          ) order by pi.identifier_type
        ) filter (where pi.id is not null),
        '[]'::jsonb
      ) as identifiers
    from master_product mp
    left join product_identifier pi on pi.master_product_id = mp.id
    where mp.id = %s
    group by mp.id
    """
    with db() as conn:
        row = conn.execute(sql, (product_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="product not found")
        columns = [d.name for d in conn.execute(sql, (product_id,)).description]
        return dict(zip(columns, row))


@app.get("/v1/products/{product_id}/offers")
def get_product_offers(product_id: UUID) -> dict[str, Any]:
    sql = """
    select
      so.id as offer_id,
      s.name as supplier,
      sp.id as supplier_product_id,
      sp.supplier_product_id as supplier_product_no,
      sp.supplier_sku,
      sp.product_name,
      sp.brand,
      sp.model_number,
      so.currency,
      so.orderability,
      snap.supplier_cost,
      snap.shipping_cost,
      snap.inventory,
      snap.shipping_confidence,
      snap.observed_at
    from supplier_offer so
    join supplier_product sp on sp.id = so.supplier_product_id
    join supplier s on s.id = sp.supplier_id
    left join lateral (
      select *
      from supplier_offer_snapshot x
      where x.supplier_offer_id = so.id
      order by x.observed_at desc
      limit 1
    ) snap on true
    join identity_match im
      on im.supplier_product_id = sp.id
     and im.master_product_id = %s
     and im.decision in ('AUTO_LINK','REVIEW')
     and im.hard_block = false
    order by s.name, sp.product_name
    """
    with db() as conn:
        rows = conn.execute(sql, (product_id,)).fetchall()
        columns = [d.name for d in conn.execute(sql, (product_id,)).description]
        return {"product_id": str(product_id), "offers": [dict(zip(columns, r)) for r in rows]}


@app.get("/v1/products/{product_id}/sellability")
def get_sellability(product_id: UUID) -> dict[str, Any]:
    sql = """
    select
      qgr.supplier_offer_id,
      qgr.status,
      qgr.checks,
      qgr.blocking_reasons,
      qgr.evaluated_at
    from quality_gate_result qgr
    join supplier_offer so on so.id = qgr.supplier_offer_id
    join supplier_product sp on sp.id = so.supplier_product_id
    where exists (
      select 1
      from identity_match im
      where im.supplier_product_id = sp.id
        and im.master_product_id = %s
        and im.hard_block = false
    )
    order by qgr.evaluated_at desc
    """
    with db() as conn:
        rows = conn.execute(sql, (product_id,)).fetchall()
        columns = [d.name for d in conn.execute(sql, (product_id,)).description]
        return {"product_id": str(product_id), "results": [dict(zip(columns, r)) for r in rows]}


@app.post("/v1/products/search")
def search_products(body: ProductSearch) -> dict[str, Any]:
    term = f"%{body.query}%"
    sql = """
    select id, brand, product_name, manufacturer, model_number, status
    from master_product
    where product_name ilike %s
       or coalesce(brand,'') ilike %s
       or coalesce(model_number,'') ilike %s
    order by product_name
    limit %s
    """
    with db() as conn:
        rows = conn.execute(sql, (term, term, term, body.limit)).fetchall()
        columns = [d.name for d in conn.execute(sql, (term, term, term, body.limit)).description]
        return {"query": body.query, "results": [dict(zip(columns, r)) for r in rows]}
