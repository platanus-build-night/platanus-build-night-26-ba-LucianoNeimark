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


def apply_bulk_discount(price: float, quantity: int, threshold: int = 10, discount: float = 0.1) -> float:
    """Return discounted unit price when quantity meets or exceeds threshold."""
    if quantity < 0:
        raise ValueError("Quantity cannot be negative")
    if quantity >= threshold:
        return price * (1 - discount)
    return price
