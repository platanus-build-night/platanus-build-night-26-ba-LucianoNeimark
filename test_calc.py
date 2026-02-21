import pytest
from calc import *


def test_multiply_returns_correct_product():
    assert multiply(3, 4) == 12


def test_division_raises_on_zero_divisor():
    with pytest.raises(ValueError):
        division(10, 0)


def test_division_returns_correct_quotient():
    assert division(10, 2) == 5.0