def apply_tax(price: float, rate: float) -> float:
    """Return price with tax applied. Rate is a decimal (e.g. 0.19 for 19%)."""
    if rate < 0:
        raise ValueError("Tax rate cannot be negative")
    return price * (1 + rate)


def format_price(price: float, currency: str = "USD") -> str:
    """Return a formatted price string like '$9.99'."""
    symbols = {"USD": "$", "EUR": "€", "GBP": "£"}
    symbol = symbols.get(currency, currency + " ")
    return f"{symbol}{price:.2f}"


def apply_coupon(price: float, code: str) -> float:
    """Apply a coupon code and return the discounted price."""
    coupons = {"SAVE10": 0.10, "SAVE20": 0.20, "HALFOFF": 0.50}
    rate = coupons.get(code.upper())
    if rate is None:
        raise ValueError(f"Invalid coupon code: {code}")
    return price * (1 - rate)


def apply_bulk_discount(price: float, quantity: int, threshold: int = 10, discount: float = 0.1) -> float:
    """Return discounted unit price when quantity meets or exceeds threshold."""
    if quantity < 0:
        raise ValueError("Quantity cannot be negative")
    if quantity >= threshold:
        return price * (1 - discount)
    return price


def apply_loyalty_discount(price: float, points: int) -> float:
    """Apply a loyalty points discount. Every 100 points = 1% off, max 15%."""
    if points < 0:
        raise ValueError("Points cannot be negative")
    discount = min(points // 100 * 0.01, 0.15)
    return price * (1 - discount)


def calculate_final_price(price: float, coupon_code: str | None = None, tax_rate: float = 0.0) -> float:
    """Apply optional coupon then tax and return the final price."""
    if coupon_code:
        price = apply_coupon(price, coupon_code)
    return apply_tax(price, tax_rate)
