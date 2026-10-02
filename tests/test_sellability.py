from app.services.sellability import SellabilityInput, evaluate_sellability


def base() -> SellabilityInput:
    return SellabilityInput(
        identity_hard_block=False,
        identity_confidence=0.98,
        mpn_mismatch=False,
        set_count_mismatch=False,
        color_mismatch=False,
        size_mismatch=False,
        condition_mismatch=False,
        price_age_seconds=60,
        inventory_age_seconds=60,
        shipping_age_seconds=60,
        price_max_age_seconds=3600,
        inventory_max_age_seconds=3600,
        shipping_max_age_seconds=86400,
        orderable=True,
        supplier_active=True,
        supplier_cost=1000,
        shipping_cost=300,
    )


def test_sellable_when_all_gates_pass():
    status, reasons = evaluate_sellability(base())
    assert status == "SELLABLE"
    assert reasons == []


def test_jan_match_does_not_override_variant_hard_block():
    x = base()
    x = x.__class__(**{**x.__dict__, "identity_hard_block": True, "set_count_mismatch": True})
    status, reasons = evaluate_sellability(x)
    assert status == "BLOCKED"
    assert "IDENTITY_HARD_BLOCK" in reasons
    assert "SET_COUNT_MISMATCH" in reasons


def test_mpn_mismatch_blocks():
    x = base()
    x = x.__class__(**{**x.__dict__, "mpn_mismatch": True})
    status, reasons = evaluate_sellability(x)
    assert status == "BLOCKED"
    assert "MPN_MISMATCH" in reasons


def test_stale_inventory_blocks():
    x = base()
    x = x.__class__(**{**x.__dict__, "inventory_age_seconds": 99999})
    status, reasons = evaluate_sellability(x)
    assert status == "BLOCKED"
    assert "INVENTORY_STALE" in reasons


def test_variant_mismatches_each_block():
    fields = [
        ("color_mismatch", "COLOR_MISMATCH"),
        ("size_mismatch", "SIZE_MISMATCH"),
        ("condition_mismatch", "CONDITION_MISMATCH"),
    ]
    for attr, reason in fields:
        x = base()
        x = x.__class__(**{**x.__dict__, attr: True})
        status, reasons = evaluate_sellability(x)
        assert status == "BLOCKED"
        assert reason in reasons


def test_stale_price_and_shipping_block():
    x = base()
    x = x.__class__(**{**x.__dict__, "price_age_seconds": 99999, "shipping_age_seconds": 99999})
    status, reasons = evaluate_sellability(x)
    assert status == "BLOCKED"
    assert "PRICE_STALE" in reasons
    assert "SHIPPING_STALE" in reasons
