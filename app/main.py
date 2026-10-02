import os
from typing import Any
from uuid import UUID
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
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


@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


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


class ProductCreate(BaseModel):
    product_name: str = Field(min_length=1, max_length=500)
    brand: str | None = None
    manufacturer: str | None = None
    model_number: str | None = None
    identifiers: list[dict[str, str]] = Field(default_factory=list)


class SupplierProductCreate(BaseModel):
    supplier: str = Field(min_length=1, max_length=200)
    identifiers: list[dict[str, str]] = Field(default_factory=list)
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


class OfferCreate(BaseModel):
    supplier_product_id: UUID
    currency: str = Field(default="JPY", min_length=3, max_length=3)
    orderability: str = Field(default="UNKNOWN")


class OfferObservationCreate(BaseModel):
    observation_type: str
    supplier_cost: float | None = Field(default=None, ge=0)
    shipping_cost: float | None = Field(default=None, ge=0)
    inventory: int | None = None
    observed_at: str | None = None


class ProfitCreate(BaseModel):
    supplier_offer_id: UUID
    sale_price: float = Field(ge=0)
    supplier_cost: float | None = Field(default=None, ge=0)
    shipping_cost: float | None = Field(default=None, ge=0)
    payment_fee: float | None = Field(default=None, ge=0)
    marketplace_fee: float | None = Field(default=None, ge=0)
    tax: float | None = Field(default=None, ge=0)
    other_cost: float | None = Field(default=None, ge=0)


@app.post("/v1/supplier-offers")
def create_supplier_offer(body: OfferCreate) -> dict[str, Any]:
    if body.orderability not in {"ORDERABLE", "OUT_OF_STOCK", "UNKNOWN", "BLOCKED"}:
        raise HTTPException(status_code=400, detail="invalid orderability")
    with db() as conn:
        exists = conn.execute(
            "select id from supplier_product where id=%s", (body.supplier_product_id,)
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="supplier product not found")
        result = conn.execute(
            """
            insert into supplier_offer(supplier_product_id,currency,orderability)
            values (%s,%s,%s)
            on conflict (supplier_product_id) do update set
              currency=excluded.currency,
              orderability=excluded.orderability,
              updated_at=now()
            returning id,supplier_product_id,currency,orderability,created_at,updated_at
            """,
            (body.supplier_product_id, body.currency.upper(), body.orderability),
        )
        row=result.fetchone()
        columns=[d.name for d in result.description]
        conn.execute(
            """
            insert into supplier_offer_freshness(supplier_offer_id)
            values (%s)
            on conflict (supplier_offer_id) do nothing
            """,
            (row[0],),
        )
        conn.commit()
        return dict(zip(columns,row))


@app.post("/v1/supplier-offers/{offer_id}/observations")
def add_offer_observation(offer_id: UUID, body: OfferObservationCreate) -> dict[str, Any]:
    if body.observation_type not in {"PRICE", "INVENTORY", "SHIPPING"}:
        raise HTTPException(status_code=400, detail="invalid observation_type")
    if body.observation_type == "PRICE" and body.supplier_cost is None:
        raise HTTPException(status_code=400, detail="supplier_cost is required for PRICE")
    if body.observation_type == "INVENTORY" and body.inventory is None:
        raise HTTPException(status_code=400, detail="inventory is required for INVENTORY")
    if body.observation_type == "SHIPPING" and body.shipping_cost is None:
        raise HTTPException(status_code=400, detail="shipping_cost is required for SHIPPING")
    with db() as conn:
        offer=conn.execute("select id from supplier_offer where id=%s",(offer_id,)).fetchone()
        if not offer:
            raise HTTPException(status_code=404, detail="offer not found")
        previous = conn.execute(
            """
            select supplier_cost, shipping_cost, inventory
            from supplier_offer_snapshot
            where supplier_offer_id=%s
            order by observed_at desc
            limit 1
            """,
            (offer_id,),
        ).fetchone()
        result=conn.execute(
            """
            insert into supplier_offer_observation
              (supplier_offer_id,observation_type,price,inventory,shipping_cost,observed_at)
            values (%s,%s,%s,%s,%s,coalesce(%s::timestamptz,now()))
            returning id,supplier_offer_id,observation_type,price,inventory,shipping_cost,observed_at
            """,
            (offer_id,body.observation_type,body.supplier_cost,body.inventory,
             body.shipping_cost,body.observed_at),
        )
        row=result.fetchone()
        columns=[d.name for d in result.description]
        supplier_cost = body.supplier_cost if body.supplier_cost is not None else (previous[0] if previous else None)
        shipping_cost = body.shipping_cost if body.shipping_cost is not None else (previous[1] if previous else None)
        inventory = body.inventory if body.inventory is not None else (previous[2] if previous else None)
        conn.execute(
            """
            insert into supplier_offer_snapshot
              (supplier_offer_id,supplier_cost,shipping_cost,inventory,observed_at)
            values (%s,%s,%s,%s,%s)
            """,
            (offer_id,supplier_cost,shipping_cost,inventory,row[6]),
        )
        freshness_column={
            "PRICE":"price_observed_at",
            "INVENTORY":"inventory_observed_at",
            "SHIPPING":"shipping_observed_at",
        }[body.observation_type]
        conn.execute(
            f"""
            insert into supplier_offer_freshness(supplier_offer_id,{freshness_column})
            values (%s,%s)
            on conflict (supplier_offer_id) do update set
              {freshness_column}=greatest(coalesce(supplier_offer_freshness.{freshness_column}, excluded.{freshness_column}), excluded.{freshness_column}),
              updated_at=now()
            """,
            (offer_id,row[6]),
        )
        conn.commit()
        return dict(zip(columns,row))


@app.post("/v1/products/{product_id}/profit")
def create_profit(product_id: UUID, body: ProfitCreate) -> dict[str, Any]:
    from app.services.profit import calculate_profit
    with db() as conn:
        offer=conn.execute(
            """
            select so.id
            from supplier_offer so
            join supplier_product sp on sp.id=so.supplier_product_id
            join lateral (
              select im.*
              from identity_match im
              where im.supplier_product_id=sp.id and im.master_product_id=%s
              order by im.created_at desc limit 1
            ) im on im.hard_block=false and im.decision in ('AUTO_LINK','REVIEW')
            where so.id=%s
            """,
            (product_id,body.supplier_offer_id),
        ).fetchone()
        if not offer:
            raise HTTPException(status_code=404, detail="offer is not linked to product")
        result=calculate_profit(
            sale_price=body.sale_price,
            supplier_cost=body.supplier_cost,
            shipping_cost=body.shipping_cost,
            payment_fee=body.payment_fee,
            marketplace_fee=body.marketplace_fee,
            tax=body.tax,
            other_cost=body.other_cost,
        )
        if result["missing_costs"]:
            raise HTTPException(status_code=422, detail={
                "code":"PROFIT_COST_UNKNOWN",
                "missing_costs":result["missing_costs"]
            })
        result_cursor=conn.execute(
            """
            insert into profit_snapshot
              (supplier_offer_id,sale_price,supplier_cost,shipping_cost,payment_fee,
               marketplace_fee,tax,other_cost,expected_profit)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            returning id,supplier_offer_id,sale_price,supplier_cost,shipping_cost,
                      payment_fee,marketplace_fee,tax,other_cost,expected_profit,calculated_at
            """,
            (body.supplier_offer_id,body.sale_price,body.supplier_cost,body.shipping_cost,
             body.payment_fee,body.marketplace_fee,body.tax,body.other_cost,
             result["expected_profit"]),
        )
        row=result_cursor.fetchone()
        out=dict(zip([d.name for d in result_cursor.description], row))
        conn.commit()
        return out


@app.get("/v1/products/{product_id}/profit")
def get_profit(product_id: UUID) -> dict[str, Any]:
    with db() as conn:
        rows=rows_as_dicts(conn,
            """
            select ps.*
            from profit_snapshot ps
            join supplier_offer so on so.id=ps.supplier_offer_id
            join supplier_product sp on sp.id=so.supplier_product_id
            join lateral (
              select im.*
              from identity_match im
              where im.supplier_product_id=sp.id and im.master_product_id=%s
              order by im.created_at desc limit 1
            ) im on im.hard_block=false
            order by ps.calculated_at desc
            """,(product_id,))
        return {"product_id":str(product_id),"results":rows}


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
        product_id = row[0]
        for item in body.identifiers:
            identifier_type = item.get("type")
            identifier_value = item.get("value")
            if identifier_type not in {"JAN", "EAN", "UPC", "MPN", "SKU"} or not identifier_value:
                raise HTTPException(status_code=400, detail="invalid product identifier")
            existing = conn.execute(
                """
                select master_product_id
                from product_identifier
                where identifier_type=%s and identifier_value=%s
                """,
                (identifier_type, identifier_value),
            ).fetchone()
            if existing and existing[0] != product_id:
                raise HTTPException(status_code=409, detail="product identifier already belongs to another master product")
            conn.execute(
                """
                insert into product_identifier(master_product_id, identifier_type, identifier_value)
                values (%s,%s,%s)
                on conflict (identifier_type, identifier_value) do nothing
                """,
                (product_id, identifier_type, identifier_value),
            )
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
        supplier_product_uuid = row[0]
        for item in body.identifiers:
            identifier_type = item.get("type")
            identifier_value = item.get("value")
            if identifier_type not in {"JAN", "EAN", "UPC", "MPN", "SKU"} or not identifier_value:
                raise HTTPException(status_code=400, detail="invalid supplier product identifier")
            conn.execute(
                """
                insert into supplier_product_identifier(supplier_product_id, identifier_type, identifier_value)
                values (%s,%s,%s)
                on conflict (supplier_product_id, identifier_type, identifier_value) do nothing
                """,
                (supplier_product_uuid, identifier_type, identifier_value),
            )
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

        identifier_sql = """
        select pi.identifier_type, pi.identifier_value
        from product_identifier pi
        where pi.master_product_id=%s
        """
        supplier_identifier_sql = """
        select identifier_type, identifier_value
        from supplier_product_identifier
        where supplier_product_id=%s
        """
        master_ids = {(r[0], r[1].strip()) for r in conn.execute(identifier_sql, (body.master_product_id,)).fetchall()}
        supplier_ids = {(r[0], r[1].strip()) for r in conn.execute(supplier_identifier_sql, (body.supplier_product_id,)).fetchall()}
        identifier_matches = sorted(master_ids & supplier_ids)

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
                (match_id, code, Jsonb({"master": master_value, "supplier": supplier_value})),
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
            "identifier_matches": [
                {"type": identifier_type, "value": value}
                for identifier_type, value in identifier_matches
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


@app.post("/v1/products/{product_id}/sellability/evaluate")
def evaluate_product_sellability(product_id: UUID) -> dict[str, Any]:
    from app.services.sellability import SellabilityInput, evaluate_sellability
    sql = """
    select
      so.id as supplier_offer_id,
      so.orderability,
      s.status as supplier_status,
      snap.supplier_cost,
      snap.shipping_cost,
      extract(epoch from (now() - f.price_observed_at))::bigint as price_age_seconds,
      extract(epoch from (now() - f.inventory_observed_at))::bigint as inventory_age_seconds,
      extract(epoch from (now() - f.shipping_observed_at))::bigint as shipping_age_seconds,
      pp.max_price_age,
      pp.max_inventory_age,
      pp.max_shipping_age,
      im.confidence,
      im.hard_block,
      coalesce(blocks.reason_codes, '[]'::jsonb) as reason_codes
    from supplier_offer so
    join supplier_product sp on sp.id=so.supplier_product_id
    join supplier s on s.id=sp.supplier_id
    left join lateral (
      select supplier_cost, shipping_cost, inventory
      from supplier_offer_snapshot x
      where x.supplier_offer_id=so.id
      order by x.observed_at desc
      limit 1
    ) snap on true
    left join supplier_offer_freshness f on f.supplier_offer_id=so.id
    left join lateral (
      select
        max(case when data_type='PRICE' then max_age_seconds end) as max_price_age,
        max(case when data_type='INVENTORY' then max_age_seconds end) as max_inventory_age,
        max(case when data_type='SHIPPING' then max_age_seconds end) as max_shipping_age
      from freshness_policy
    ) pp on true
    left join lateral (
      select im.*
      from identity_match im
      where im.supplier_product_id=sp.id
        and im.master_product_id=%s
      order by im.created_at desc
      limit 1
    ) im on true
    left join lateral (
      select jsonb_agg(ihb.reason_code order by ihb.reason_code) as reason_codes
      from identity_hard_block ihb
      where ihb.identity_match_id=im.id
    ) blocks on true
    where im.id is not null
    order by so.updated_at desc
    """
    with db() as conn:
        row = conn.execute(sql, (product_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="no supplier offer found for product")
        columns=[d.name for d in conn.execute(sql, (product_id,)).description]
        data=dict(zip(columns,row))
        reasons=set(data["reason_codes"] or [])
        x=SellabilityInput(
            identity_hard_block=bool(data["hard_block"]) if data["hard_block"] is not None else True,
            identity_confidence=float(data["confidence"]) if data["confidence"] is not None else 0.0,
            mpn_mismatch="MPN_MISMATCH" in reasons,
            set_count_mismatch="SET_COUNT_MISMATCH" in reasons,
            color_mismatch="COLOR_MISMATCH" in reasons,
            size_mismatch="SIZE_MISMATCH" in reasons,
            condition_mismatch="CONDITION_MISMATCH" in reasons,
            price_age_seconds=int(data["price_age_seconds"]) if data["price_age_seconds"] is not None else None,
            inventory_age_seconds=int(data["inventory_age_seconds"]) if data["inventory_age_seconds"] is not None else None,
            shipping_age_seconds=int(data["shipping_age_seconds"]) if data["shipping_age_seconds"] is not None else None,
            price_max_age_seconds=int(data["max_price_age"]),
            inventory_max_age_seconds=int(data["max_inventory_age"]),
            shipping_max_age_seconds=int(data["max_shipping_age"]),
            orderable=data["orderability"] == "ORDERABLE",
            supplier_active=data["supplier_status"] == "ACTIVE",
            supplier_cost=float(data["supplier_cost"]) if data["supplier_cost"] is not None else None,
            shipping_cost=float(data["shipping_cost"]) if data["shipping_cost"] is not None else None,
        )
        status, blocking_reasons=evaluate_sellability(x)
        checks={
            "identity_confidence": x.identity_confidence,
            "identity_hard_block": x.identity_hard_block,
            "orderability": data["orderability"],
            "supplier_status": data["supplier_status"],
            "price_age_seconds": x.price_age_seconds,
            "inventory_age_seconds": x.inventory_age_seconds,
            "shipping_age_seconds": x.shipping_age_seconds,
        }
        result=conn.execute(
            """
            insert into quality_gate_result(supplier_offer_id,status,checks,blocking_reasons)
            values (%s,%s,%s,%s)
            returning id,supplier_offer_id,status,checks,blocking_reasons,evaluated_at
            """,
            (data["supplier_offer_id"],status,Jsonb(checks),Jsonb(blocking_reasons)),
        )
        row=result.fetchone()
        out=dict(zip([d.name for d in result.description],row))
        conn.commit()
        return out


class RepairCreate(BaseModel):
    action: str = Field(min_length=1, max_length=500)
    result: str = Field(min_length=1, max_length=100)


class RetestCreate(BaseModel):
    passed: bool
    details: dict[str, Any] = Field(default_factory=dict)


@app.post("/v1/quality/patrol")
def run_quality_patrol() -> dict[str, Any]:
    from app.services.sellability import SellabilityInput, evaluate_sellability
    with db() as conn:
        patrol=conn.execute(
            "insert into quality_patrol_run(status) values ('RUNNING') returning id"
        ).fetchone()
        patrol_id=patrol[0]
        rows=conn.execute(
            """
            select
              so.id,
              so.orderability,
              s.status,
              snap.supplier_cost,
              snap.shipping_cost,
              ident.confidence,
              ident.hard_block,
              ident.reason_codes,
              extract(epoch from (now()-f.price_observed_at))::bigint,
              extract(epoch from (now()-f.inventory_observed_at))::bigint,
              extract(epoch from (now()-f.shipping_observed_at))::bigint,
              max(case when fp.data_type='PRICE' then fp.max_age_seconds end),
              max(case when fp.data_type='INVENTORY' then fp.max_age_seconds end),
              max(case when fp.data_type='SHIPPING' then fp.max_age_seconds end)
            from supplier_offer so
            join supplier_product sp on sp.id=so.supplier_product_id
            join supplier s on s.id=sp.supplier_id
            left join lateral (
              select supplier_cost,shipping_cost,inventory
              from supplier_offer_snapshot x
              where x.supplier_offer_id=so.id
              order by x.observed_at desc limit 1
            ) snap on true
            left join supplier_offer_freshness f on f.supplier_offer_id=so.id
            left join lateral (
              select
                im.confidence,
                im.hard_block,
                coalesce(
                  (select array_agg(ihb.reason_code)
                   from identity_hard_block ihb
                   where ihb.identity_match_id=im.id),
                  '{}'::text[]
                ) as reason_codes
              from identity_match im
              where im.supplier_product_id=sp.id
              order by im.created_at desc
              limit 1
            ) ident on true
            cross join freshness_policy fp
            group by so.id,s.status,snap.supplier_cost,snap.shipping_cost,
                     ident.confidence,ident.hard_block,ident.reason_codes,
                     f.price_observed_at,f.inventory_observed_at,f.shipping_observed_at
            """
        ).fetchall()
        blocked=0
        diagnosis_count=0
        for row in rows:
            x=SellabilityInput(
                identity_hard_block=bool(row[5]) if row[5] is not None else True,
                identity_confidence=float(row[4]) if row[4] is not None else 0.0,
                mpn_mismatch="MPN_MISMATCH" in (row[6] or []),
                set_count_mismatch="SET_COUNT_MISMATCH" in (row[6] or []),
                color_mismatch="COLOR_MISMATCH" in (row[6] or []),
                size_mismatch="SIZE_MISMATCH" in (row[6] or []),
                condition_mismatch="CONDITION_MISMATCH" in (row[6] or []),
                price_age_seconds=int(row[7]) if row[7] is not None else None,
                inventory_age_seconds=int(row[8]) if row[8] is not None else None,
                shipping_age_seconds=int(row[9]) if row[9] is not None else None,
                price_max_age_seconds=int(row[10]),
                inventory_max_age_seconds=int(row[11]),
                shipping_max_age_seconds=int(row[12]),
                orderable=row[1] == "ORDERABLE",
                supplier_active=row[2] == "ACTIVE",
                supplier_cost=float(row[3]) if row[3] is not None else None,
                shipping_cost=float(row[4]) if row[4] is not None else None,
            )
            status,reasons=evaluate_sellability(x)
            if status == "BLOCKED":
                blocked += 1
                for reason in reasons:
                    conn.execute(
                        """
                        insert into quality_diagnosis
                          (patrol_run_id,supplier_offer_id,severity,code,details)
                        values (%s,%s,'ERROR',%s,%s)
                        """,
                        (patrol_id,row[0],reason,Jsonb({"source":"quality_patrol"})),
                    )
                    diagnosis_count += 1
            conn.execute(
                """
                insert into quality_gate_result(supplier_offer_id,status,checks,blocking_reasons)
                values (%s,%s,%s,%s)
                """,
                (row[0],status,Jsonb({"source":"quality_patrol"}),Jsonb(reasons)),
            )
        final_status="PASSED" if blocked == 0 else "FAILED"
        conn.execute(
            """
            update quality_patrol_run
            set status=%s,finished_at=now(),
                summary=%s
            where id=%s
            """,
            (final_status,Jsonb({"offers_checked":len(rows),"blocked_offers":blocked,"diagnoses":diagnosis_count}),patrol_id),
        )
        conn.commit()
        return {
            "patrol_run_id":str(patrol_id),
            "status":final_status,
            "offers_checked":len(rows),
            "blocked_offers":blocked,
            "diagnoses":diagnosis_count,
        }


@app.post("/v1/quality/diagnoses/{diagnosis_id}/repair")
def record_quality_repair(diagnosis_id: UUID, body: RepairCreate) -> dict[str, Any]:
    with db() as conn:
        diagnosis=conn.execute("select id from quality_diagnosis where id=%s",(diagnosis_id,)).fetchone()
        if not diagnosis:
            raise HTTPException(status_code=404, detail="diagnosis not found")
        result=conn.execute(
            """
            insert into quality_repair(diagnosis_id,action,result)
            values (%s,%s,%s)
            returning id,diagnosis_id,action,result,details,repaired_at
            """,
            (diagnosis_id,body.action,body.result),
        )
        row=result.fetchone()
        out=dict(zip([d.name for d in result.description],row))
        conn.commit()
        return out


@app.post("/v1/quality/diagnoses/{diagnosis_id}/retest")
def record_quality_retest(diagnosis_id: UUID, body: RetestCreate) -> dict[str, Any]:
    with db() as conn:
        diagnosis=conn.execute("select id from quality_diagnosis where id=%s",(diagnosis_id,)).fetchone()
        if not diagnosis:
            raise HTTPException(status_code=404, detail="diagnosis not found")
        result=conn.execute(
            """
            insert into quality_retest(diagnosis_id,passed,details)
            values (%s,%s,%s)
            returning id,diagnosis_id,passed,details,tested_at
            """,
            (diagnosis_id,body.passed,Jsonb(body.details)),
        )
        row=result.fetchone()
        out=dict(zip([d.name for d in result.description],row))
        conn.commit()
        return out


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
