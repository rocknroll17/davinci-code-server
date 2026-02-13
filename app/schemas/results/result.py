from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.player import Player

class Result(ABC):
    """Abstract base class for representing the result of a game or operation."""
    def __init__(self, player: "Player", is_invalid: bool = False) -> None:
        self.player = player
        self.is_invalid = is_invalid

    @abstractmethod
    def __repr__(self) -> str:
        pass

    @abstractmethod
    def __str__(self) -> str:
        pass
    

