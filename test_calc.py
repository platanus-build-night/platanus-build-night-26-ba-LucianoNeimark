import pytest
from calc import *


def test_multiply_returns_correct_product():
    pass


def test_division_returns_quotient_and_raises_on_zero():
    assert division(10, 2) == 5.0
    import pytest
    with pytest.raises(ValueError, match="Cannot divide by zero"):
        division(5, 0)