import pytest
from calc import *


def test_multiply():
    pass


def test_divide():
    pass


def test_divide_by_zero():
    import pytest
    with pytest.raises(ValueError, match="Cannot divide by zero"):
        divide(5, 0)