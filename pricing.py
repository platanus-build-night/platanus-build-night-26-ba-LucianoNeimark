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
