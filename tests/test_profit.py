from app.services.profit import calculate_profit


def test_profit_calculates_only_when_all_costs_are_known():
    result = calculate_profit(
        sale_price=10000,
        supplier_cost=5000,
        shipping_cost=800,
        payment_fee=300,
        marketplace_fee=500,
        tax=200,
        other_cost=100,
    )
    assert result["missing_costs"] == []
    assert result["total_cost"] == 6900
    assert result["expected_profit"] == 3100


def test_profit_rejects_unknown_mandatory_cost():
    result = calculate_profit(
        sale_price=10000,
        supplier_cost=5000,
        shipping_cost=800,
        payment_fee=None,
        marketplace_fee=500,
        tax=200,
        other_cost=100,
    )
    assert result["expected_profit"] is None
    assert result["missing_costs"] == ["payment_fee"]
