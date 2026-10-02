import os
from pathlib import Path

import psycopg


def test_schema_bootstrap():
    database_url = os.environ["DATABASE_URL"]
    schema = Path("db/schema.sql").read_text(encoding="utf-8")
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(schema)
        assert conn.execute("select count(*) from freshness_policy").fetchone()[0] == 3
        assert conn.execute("select to_regclass('public.supplier_product')").fetchone()[0] == "supplier_product"
        assert conn.execute("select to_regclass('public.quality_gate_result')").fetchone()[0] == "quality_gate_result"
