import pytest
from calc import *


def test_multiply():
    assert multiply(3, 4) == 12
    assert multiply(-2, 5) == -10
    assert multiply(0, 99) == 0
    assert multiply(-3, -7) == 21


def test_divide():
    assert divide(10, 2) == 5.0
    assert divide(-9, 3) == -3.0
    assert divide(7, 2) == 3.5
    assert divide(0, 5) == 0.0


def test_divide_by_zero():
    import pytest
    with pytest.raises(ValueError, match="Cannot divide by zero"):
        divide(5, 0)