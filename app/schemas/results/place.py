from typing import TYPE_CHECKING
from .result import Result

if TYPE_CHECKING:
    from app.services.player import Player
    from app.game.cards.card import Card

class PlaceResult(Result):
    """Class representing a place result in a game."""
    def __init__(self, player: "Player", placed_card: "Card", position: int, is_invalid: bool = False) -> None:
        super().__init__(player, is_invalid)
        if not is_invalid:
            self.placed_card = placed_card
            self.position = position

    def __repr__(self) -> str:
        return str(self)
    
    def __str__(self) -> str:
        if self.is_invalid:
            return f"Player {self.player.id} made an invalid place."
        return f"Player {self.player.id} placed {self.placed_card} at position {self.position}"