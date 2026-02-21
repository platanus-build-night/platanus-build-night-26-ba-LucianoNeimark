def multiply(a, b):
    return a * b


def division(a, b):
    if b == 0:
        raise ZeroDivisionError("Cannot divide by zero")
    return a / b


def sum_(a, b):
    return a + b
