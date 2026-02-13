"""Constants and Enums for Da Vinci Code Game."""

from enum import IntEnum
from typing import Final


class Phase(IntEnum):
    """Game phase enumeration."""
    DRAW = 0
    GUESS = 1
    DECISION = 2


class Color(IntEnum):
    """Card color enumeration."""
    BLACK = 0
    WHITE = 1
    NONE = -1  # No card in slot
    
    def to_string(self) -> str:
        if self == Color.BLACK:
            return "Black"
        elif self == Color.WHITE:
            return "White"
        else:
            return "None"


class CardValue(IntEnum):
    """Card value special constants."""
    N0 = 0
    N1 = 1
    N2 = 2
    N3 = 3
    N4 = 4
    N5 = 5
    N6 = 6
    N7 = 7
    N8 = 8
    N9 = 9
    N10 = 10
    N11 = 11

    HIDDEN = -1  # Card exists but value not revealed
    NONE = -2    # No card in slot
    JOKER = 12   # Joker card value
    
    def to_string(self) -> str:
        if self == CardValue.HIDDEN:
            return "Hidden"
        elif self == CardValue.NONE:
            return "None"
        elif self == CardValue.JOKER:
            return "-"
        else:
            return str(int(self))


# Game configuration constants
MAX_HAND_SIZE: Final[int] = 13
NUM_VALUES: Final[int] = 13  # 0-11 + joker (12)

# Numerical stability constant for masked logits (avoid -inf issues)
MASK_VALUE: Final[float] = -1e4

# Initial hand sizes
INITIAL_HAND_SIZE_2P: Final[int] = 4

MAX_PLAYERS: Final[int] = 2
