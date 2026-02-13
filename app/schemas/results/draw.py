from __future__ import annotations
from typing import TYPE_CHECKING
from .result import Result

if TYPE_CHECKING:
    from app.services.player import Player
    from app.services.game_engine import PendingCard

class DrawResult(Result):
    """Class representing a draw result in a game."""
    def __init__(self, player: Player, pending_card: PendingCard, is_invalid: bool = False) -> None:
        super().__init__(player, is_invalid)
        if not is_invalid:
            self.pending_card = pending_card

    def __repr__(self) -> str:
        return str(self)
    
    def __str__(self) -> str:
        if self.is_invalid:
            return f"Player {self.player.id} made an invalid draw."
        return f"Player {self.player.id} drew {self.pending_card}"