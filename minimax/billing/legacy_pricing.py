"""Invoices and order pricing for the sample project.

This module is the *target* of the sample development task: it contains the
same tier-discount arithmetic implemented three times, which the agent is
asked to consolidate without changing any observable behaviour.

The public surface (``tiered_discount``, ``discounted_total``,
``shipping_fee``, ``compute_invoice``) and every numeric result must stay
byte-for-byte identical after the refactor - the behaviour snapshot test
proves it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

TIER_THRESHOLDS: tuple[tuple[float, float], ...] = (
    (5000.0, 0.05),
    (2000.0, 0.03),
    (500.0, 0.01),
)

FREE_SHIPPING_THRESHOLD = 300.0

REGION_RATES: dict[str, float] = {
    "domestic": 8.0,
    "remote": 18.0,
    "international": 45.0,
}

REGION_SURCHARGE: dict[str, float] = {
    "domestic": 0.0,
    "remote": 2.0,
    "international": 12.0,
}


@dataclass(frozen=True)
class InvoiceLine:
    sku: str
    quantity: int
    unit_price: float

    @property
    def amount(self) -> float:
        return round(self.quantity * self.unit_price, 2)


@dataclass
class Invoice:
    lines: list[InvoiceLine] = field(default_factory=list)
    region: str = "domestic"
    discount: float = 0.0
    shipping: float = 0.0

    @property
    def subtotal(self) -> float:
        return round(sum(line.amount for line in self.lines), 2)

    @property
    def total(self) -> float:
        return round(self.subtotal - self.discount + self.shipping, 2)


def _discount_rate(amount: float) -> float:
    if amount >= TIER_THRESHOLDS[0][0]:
        return TIER_THRESHOLDS[0][1]
    if amount >= TIER_THRESHOLDS[1][0]:
        return TIER_THRESHOLDS[1][1]
    if amount >= TIER_THRESHOLDS[2][0]:
        return TIER_THRESHOLDS[2][1]
    return 0.0


def _discount_amount(amount: float) -> float:
    return round(amount * _discount_rate(amount), 2)


def _shipping_base(amount: float, region: str) -> float:
    if amount >= FREE_SHIPPING_THRESHOLD:
        return 0.0
    return REGION_RATES.get(region, REGION_RATES["domestic"])


def _shipping_amount(amount: float, region: str) -> float:
    base = _shipping_base(amount, region)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(base + surcharge, 2)


def tiered_discount(amount: float) -> float:
    """Return the discount amount for a gross order amount."""
    return _discount_amount(amount)


def discounted_total(amount: float, region: str = "domestic") -> float:
    """Return the discounted amount, ignoring shipping."""
    discount = _discount_amount(amount)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(amount - discount + surcharge, 2)


def shipping_fee(amount: float, region: str = "domestic") -> float:
    """Return the shipping fee for an order."""
    return _shipping_amount(amount, region)


def compute_invoice(lines: Iterable[InvoiceLine], region: str = "domestic") -> Invoice:
    """Build a full invoice for the given lines."""
    collected = list(lines)
    subtotal = round(sum(line.amount for line in collected), 2)
    discount = _discount_amount(subtotal)
    shipping = _shipping_amount(subtotal, region)
    return Invoice(lines=collected, region=region, discount=discount, shipping=shipping)
