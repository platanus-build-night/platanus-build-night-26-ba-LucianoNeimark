import pytest
from calc import *


def test_multiply():
    assert multiply(3, 4) == 12
    assert multiply(-2, 5) == -10
    assert multiply(0, 99) == 0
    assert multiply(-3, -7) == 21


def test_divide():
    pass


def test_divide_by_zero():
    import pytest
    with pytest.raises(ValueError, match="Cannot divide by zero"):
        divide(5, 0)