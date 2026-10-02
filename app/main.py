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


@app.get("/", include_in_schema=False)\ndef dashboard():\n    return FileResponse(Path(__file__).parent / "static" / "index.html")\n\n\n@app.get("/health")
def health() -> dict[str, str]:
    try:
        with db() as conn:
            conn.execute("select 1")
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="database unavailable")


class ProductCreate(BaseModel):
    product_name: str = Field(min_length=1, max_length=500)
    brand: str | None = None
    manufacturer: str | None = None
    model_number: str | None = None


class SupplierProductCreate(BaseModel):
    supplier: str = Field(min_length=1, max_length=200)
    supplier_product_id: str = Field(min_length=1, max_length=200)
    supplier_sku: str | None = None
    product_name: str = Field(min_length=1, max_length=500)
    brand: str | None = None
    manufacturer: str | None = None
    model_number: str | None = None
    color: str | None = None
    size: str | None = None
    capacity: str | None = None
    generation: str | None = None
    set_count: int | None = Field(default=None, gt=0)
    condition: str | None = None


class IdentityEvaluateRequest(BaseModel):
    supplier_product_id: UUID
    master_product_id: UUID


@app.post("/v1/products")
def create_product(body: ProductCreate) -> dict[str, Any]:
    sql = """
    insert into master_product (product_name, brand, manufacturer, model_number)
    values (%s, %s, %s, %s)
    returning id, product_name, brand, manufacturer, model_number, status, created_at, updated_at
    """
    with db() as conn:
        result = conn.execute(
            sql, (body.product_name, body.brand, body.manufacturer, body.model_number)
        )
        row = result.fetchone()
        columns = [d.name for d in result.description]
        conn.commit()
        return dict(zip(columns, row))


@app.post("/v1/supplier-products")
def create_supplier_product(body: SupplierProductCreate) -> dict[str, Any]:
    with db() as conn:
        supplier = conn.execute(
            "insert into supplier(name) values (%s) on conflict(name) do update set updated_at=now() returning id, name, status",
            (body.supplier,),
        ).fetchone()
        supplier_id = supplier[0]
        sql = """
        insert into supplier_product (
          supplier_id, supplier_product_id, supplier_sku, brand, product_name,
          manufacturer, model_number, color, size, capacity, generation, set_count, condition
        )
        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        on conflict (supplier_id, supplier_product_id) do update set
          supplier_sku=excluded.supplier_sku,
          brand=excluded.brand,
          product_name=excluded.product_name,
          manufacturer=excluded.manufacturer,
          model_number=excluded.model_number,
          color=excluded.color,
          size=excluded.size,
          capacity=excluded.capacity,
          generation=excluded.generation,
          set_count=excluded.set_count,
          condition=excluded.condition,
          last_seen_at=now()
        returning id, supplier_id, supplier_product_id, supplier_sku, product_name,
                  brand, manufacturer, model_number, color, size, capacity, generation, set_count, condition
        """
        result = conn.execute(sql, (
            supplier_id, body.supplier_product_id, body.supplier_sku, body.brand,
            body.product_name, body.manufacturer, body.model_number, body.color,
            body.size, body.capacity, body.generation, body.set_count, body.condition
        ))
        row = result.fetchone()
        columns = [d.name for d in result.description]
        conn.commit()
        return dict(zip(columns, row))


@app.post("/v1/identity/evaluate")
def evaluate_identity(body: IdentityEvaluateRequest) -> dict[str, Any]:
    master_sql = """
    select id, brand, model_number from master_product where id=%s
    """
    supplier_sql = """
    select id, brand, model_number, color, size, set_count, condition
    from supplier_product where id=%s
    """
    with db() as conn:
        master = conn.execute(master_sql, (body.master_product_id,)).fetchone()
        supplier = conn.execute(supplier_sql, (body.supplier_product_id,)).fetchone()
        if not master or not supplier:
            raise HTTPException(status_code=404, detail="product not found")

        hard_blocks: list[tuple[str, str | None, str | None]] = []
        if master[2] and supplier[2] and master[2].strip().lower() != supplier[2].strip().lower():
            hard_blocks.append(("MPN_MISMATCH", master[2], supplier[2]))

        # Variant fields are compared when both sides explicitly provide a value.
        # A missing supplier value remains UNKNOWN and is not silently treated as equal.
        checks = [
            ("color", None, supplier[3]),
            ("size", None, supplier[4]),
            ("set_count", None, supplier[5]),
            ("condition", None, supplier[6]),
        ]
        variant = conn.execute(
            "select color, size, set_count, condition from product_variant where master_product_id=%s order by updated_at desc limit 1",
            (body.master_product_id,),
        ).fetchone()
        if variant:
            checks = [
                ("color", variant[0], supplier[3]),
                ("size", variant[1], supplier[4]),
                ("set_count", variant[2], supplier[5]),
                ("condition", variant[3], supplier[6]),
            ]

        evidence = []
        for field, master_value, supplier_value in checks:
            if master_value is None or supplier_value is None:
                result = "UNKNOWN"
            elif str(master_value).strip().lower() == str(supplier_value).strip().lower():
                result = "EXACT"
            else:
                result = "MISMATCH"
                code = f"{field.upper()}_MISMATCH"
                hard_blocks.append((code, str(master_value), str(supplier_value)))
            evidence.append((field, master_value, supplier_value, result))

        critical = bool(hard_blocks)
        confidence = 0.98 if not critical else 0.40
        decision = "BLOCK" if critical else "AUTO_LINK"

        match = conn.execute(
            """
            insert into identity_match(supplier_product_id, master_product_id, confidence, decision, hard_block)
            values (%s,%s,%s,%s,%s) returning id
            """,
            (body.supplier_product_id, body.master_product_id, confidence, decision, critical),
        ).fetchone()
        match_id = match[0]

        for field, master_value, supplier_value, result in evidence:
            conn.execute(
                """
                insert into identity_match_evidence
                (identity_match_id, field_name, master_value, supplier_value, result, critical)
                values (%s,%s,%s,%s,%s,%s)
                """,
                (match_id, field, str(master_value) if master_value is not None else None,
                 str(supplier_value) if supplier_value is not None else None, result,
                 result == "MISMATCH"),
            )
        for code, master_value, supplier_value in hard_blocks:
            conn.execute(
                """
                insert into identity_hard_block(identity_match_id, reason_code, details)
                values (%s,%s,%s)
                """,
                (match_id, code, {"master": master_value, "supplier": supplier_value}),
            )
        conn.commit()

        return {
            "identity_match_id": str(match_id),
            "confidence": confidence,
            "decision": decision,
            "hard_block": critical,
            "evidence": [
                {"field": f, "master": mv, "supplier": sv, "result": r}
                for f, mv, sv, r in evidence
            ],
            "blocking_reasons": [x[0] for x in hard_blocks],
        }

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
