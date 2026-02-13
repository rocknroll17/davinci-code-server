from typing import TYPE_CHECKING
from .result import Result

if TYPE_CHECKING:
    from app.services.player import Player
    from app.game.cards.card import Card

class DecisionResult(Result):
    """Class representing a place result in a game."""
    def __init__(self, player: "Player", is_continue: bool, is_invalid: bool = False) -> None:
        super().__init__(player, is_invalid)
        if not is_invalid:
            self.is_continue = is_continue
    def __repr__(self) -> str:
        return str(self)
    
    def __str__(self) -> str:
        if self.is_invalid:
            return f"Player {self.player.id} made an invalid decision."
        return f"Player {self.player.id} decided to {'continue' if self.is_continue else 'stop'} guessing."