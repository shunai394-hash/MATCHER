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


def rows_as_dicts(conn, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    result = conn.execute(sql, params)
    columns = [d.name for d in result.description]
    return [dict(zip(columns, row)) for row in result.fetchall()]


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
        rows = rows_as_dicts(conn, sql, (product_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="product not found")
        return rows[0]


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
      snap.observed_at,
      f.price_observed_at,
      f.inventory_observed_at,
      f.shipping_observed_at
    from supplier_offer so
    join supplier_product sp on sp.id = so.supplier_product_id
    join supplier s on s.id = sp.supplier_id
    left join lateral (
      select supplier_cost, shipping_cost, inventory, observed_at
      from supplier_offer_snapshot x
      where x.supplier_offer_id = so.id
      order by x.observed_at desc
      limit 1
    ) snap on true
    left join supplier_offer_freshness f on f.supplier_offer_id = so.id
    join lateral (
      select im.*
      from identity_match im
      where im.supplier_product_id = sp.id
        and im.master_product_id = %s
      order by im.created_at desc
      limit 1
    ) im on im.decision in ('AUTO_LINK','REVIEW') and im.hard_block = false
    order by s.name, sp.product_name
    """
    with db() as conn:
        return {"product_id": str(product_id), "offers": rows_as_dicts(conn, sql, (product_id,))}


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
    join lateral (
      select im.*
      from identity_match im
      where im.supplier_product_id = sp.id
        and im.master_product_id = %s
      order by im.created_at desc
      limit 1
    ) im on im.hard_block = false
    join lateral (
      select x.*
      from quality_gate_result x
      where x.supplier_offer_id = so.id
      order by x.evaluated_at desc
      limit 1
    ) latest on latest.id = qgr.id
    order by qgr.evaluated_at desc
    """
    with db() as conn:
        return {"product_id": str(product_id), "results": rows_as_dicts(conn, sql, (product_id,))}


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
        return {
            "query": body.query,
            "results": rows_as_dicts(conn, sql, (term, term, term, body.limit)),
        }
