def multiply(a, b):
    return a * b


def division(a, b):
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b


def sum(a, b):
    return a + b
