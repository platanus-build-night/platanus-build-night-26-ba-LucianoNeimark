def calculate_discount(price: float, pct: float) -> float:
    """Return price after applying a percentage discount (0–100)."""
    if pct < 0 or pct > 100:
        raise ValueError("Percentage must be between 0 and 100")
    return price * (1 - pct / 100)


def apply_bulk_discount(prices: list[float], threshold: int, pct: float) -> list[float]:
    """Apply discount to all prices when the list meets the threshold size."""
    if len(prices) >= threshold:
        return [calculate_discount(p, pct) for p in prices]
    return prices
