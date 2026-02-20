def calculate_discount(price: float, pct: float) -> float:
    if pct < 0 or pct > 100:
        raise ValueError("Percentage must be between 0 and 100")
    return price * (1 - pct / 100)


def apply_bulk_discount(prices: list[float], threshold: int, pct: float) -> list[float]:
    if len(prices) >= threshold:
        return [calculate_discount(p, pct) for p in prices]
    return prices
