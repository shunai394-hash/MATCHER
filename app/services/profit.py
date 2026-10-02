from decimal import Decimal


REQUIRED_COST_FIELDS = (
    "supplier_cost",
    "shipping_cost",
    "payment_fee",
    "marketplace_fee",
    "tax",
    "other_cost",
)


def calculate_profit(
    *,
    sale_price: float,
    supplier_cost: float | None,
    shipping_cost: float | None,
    payment_fee: float | None,
    marketplace_fee: float | None,
    tax: float | None,
    other_cost: float | None,
) -> dict:
    values = {
        "supplier_cost": supplier_cost,
        "shipping_cost": shipping_cost,
        "payment_fee": payment_fee,
        "marketplace_fee": marketplace_fee,
        "tax": tax,
        "other_cost": other_cost,
    }
    missing = [name for name in REQUIRED_COST_FIELDS if values[name] is None]
    if missing:
        return {"expected_profit": None, "missing_costs": missing}

    total_cost = sum(Decimal(str(values[name])) for name in REQUIRED_COST_FIELDS)
    profit = Decimal(str(sale_price)) - total_cost
    return {
        "expected_profit": float(profit),
        "missing_costs": [],
        "total_cost": float(total_cost),
    }
