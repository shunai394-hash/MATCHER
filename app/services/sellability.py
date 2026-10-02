from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class SellabilityInput:
    identity_hard_block: bool
    identity_confidence: float
    mpn_mismatch: bool
    set_count_mismatch: bool
    color_mismatch: bool
    size_mismatch: bool
    condition_mismatch: bool
    price_age_seconds: int | None
    inventory_age_seconds: int | None
    shipping_age_seconds: int | None
    price_max_age_seconds: int
    inventory_max_age_seconds: int
    shipping_max_age_seconds: int
    orderable: bool
    supplier_active: bool
    supplier_cost: float | None
    shipping_cost: float | None


def evaluate_sellability(x: SellabilityInput) -> tuple[str, list[str]]:
    reasons: list[str] = []

    if x.identity_hard_block:
        reasons.append("IDENTITY_HARD_BLOCK")
    if x.identity_confidence < 0.70:
        reasons.append("LOW_IDENTITY_CONFIDENCE")
    if x.mpn_mismatch:
        reasons.append("MPN_MISMATCH")
    if x.set_count_mismatch:
        reasons.append("SET_COUNT_MISMATCH")
    if x.color_mismatch:
        reasons.append("COLOR_MISMATCH")
    if x.size_mismatch:
        reasons.append("SIZE_MISMATCH")
    if x.condition_mismatch:
        reasons.append("CONDITION_MISMATCH")
    if x.price_age_seconds is None or x.price_age_seconds > x.price_max_age_seconds:
        reasons.append("PRICE_STALE")
    if x.inventory_age_seconds is None or x.inventory_age_seconds > x.inventory_max_age_seconds:
        reasons.append("INVENTORY_STALE")
    if x.shipping_age_seconds is None or x.shipping_age_seconds > x.shipping_max_age_seconds:
        reasons.append("SHIPPING_STALE")
    if not x.orderable:
        reasons.append("NOT_ORDERABLE")
    if not x.supplier_active:
        reasons.append("SUPPLIER_INACTIVE")
    if x.supplier_cost is None:
        reasons.append("SUPPLIER_COST_UNKNOWN")
    if x.shipping_cost is None:
        reasons.append("SHIPPING_COST_UNKNOWN")

    return ("SELLABLE" if not reasons else "BLOCKED", reasons)
