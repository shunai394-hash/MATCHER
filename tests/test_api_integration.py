import os
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    database_url = os.environ["DATABASE_URL"]
    schema = Path("db/schema.sql").read_text(encoding="utf-8")
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(schema)
        conn.execute("""
            truncate quality_gate_result, quality_retest, quality_repair,
                     quality_diagnosis, quality_patrol_run, profit_snapshot,
                     identity_hard_block, identity_match_evidence, identity_match,
                     supplier_offer_observation, supplier_offer_snapshot,
                     supplier_offer_freshness, supplier_offer,
                     supplier_product_identifier, supplier_product,
                     supplier, product_variant, product_identifier, master_product
                     cascade
        """)
    with TestClient(app) as c:
        yield c


def test_product_to_offer_identity_and_sellability_flow(client):
    product = client.post("/v1/products", json={
        "product_name": "MATCHER TEST",
        "brand": "TEST",
        "model_number": "M-100",
        "identifiers": [{"type": "JAN", "value": "4900000000011"}],
    })
    assert product.status_code == 200, product.text
    product_id = product.json()["id"]

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        variant_id = conn.execute(
            """
            insert into product_variant(master_product_id,color,set_count,condition)
            values (%s,'Black',2,'NEW') returning id
            """,
            (product_id,),
        ).fetchone()[0]
        conn.commit()

    supplier_product = client.post("/v1/supplier-products", json={
        "supplier": "TEST SUPPLIER",
        "supplier_product_id": "SP-100",
        "product_name": "MATCHER TEST",
        "brand": "TEST",
        "model_number": "M-100",
        "color": "Black",
        "set_count": 2,
        "condition": "NEW",
        "identifiers": [{"type": "JAN", "value": "4900000000011"}],
    })
    assert supplier_product.status_code == 200, supplier_product.text
    supplier_product_id = supplier_product.json()["id"]

    offer = client.post("/v1/supplier-offers", json={
        "supplier_product_id": supplier_product_id,
        "currency": "JPY",
        "orderability": "ORDERABLE",
    })
    assert offer.status_code == 200, offer.text
    offer_id = offer.json()["id"]

    for observation in [
        {"observation_type": "PRICE", "supplier_cost": 5000},
        {"observation_type": "INVENTORY", "inventory": 10},
        {"observation_type": "SHIPPING", "shipping_cost": 800},
    ]:
        response = client.post(f"/v1/supplier-offers/{offer_id}/observations", json=observation)
        assert response.status_code == 200, response.text

    identity = client.post("/v1/identity/evaluate", json={
        "supplier_product_id": supplier_product_id,
        "master_product_id": product_id,
    })
    assert identity.status_code == 200, identity.text
    assert identity.json()["decision"] == "AUTO_LINK"
    assert identity.json()["identifier_matches"] == [{"type": "JAN", "value": "4900000000011"}]

    gate = client.post(f"/v1/products/{product_id}/sellability/evaluate")
    assert gate.status_code == 200, gate.text
    assert gate.json()["status"] == "SELLABLE"

    profit = client.post(f"/v1/products/{product_id}/profit", json={
        "supplier_offer_id": offer_id,
        "sale_price": 10000,
        "supplier_cost": 5000,
        "shipping_cost": 800,
        "payment_fee": 300,
        "marketplace_fee": 500,
        "tax": 200,
        "other_cost": 100,
    })
    assert profit.status_code == 200, profit.text
    assert float(profit.json()["expected_profit"]) == 3100.0

    patrol = client.post("/v1/quality/patrol")
    assert patrol.status_code == 200, patrol.text
    assert patrol.json()["status"] == "PASSED"
