from app.services.player import Player
from .result import Result
from app.game.cards.card import Card

class GuessResult(Result):
    """Class representing a guess result in a game.
    If guess is correct, the guessed card information is included.
    If guess is incorrect, current player's last drawn card information is included.
    """
    def __init__(self, player: Player, card: Card, position: int, guessed_value: str, is_correct: bool, is_invalid: bool = False, revealed_position: int = -1) -> None:
        super().__init__(player, is_invalid)
        # if not is_invalid:
        #     self.placed_card = card
        #     self.position = position
        #     self.correct = correct
        self.card: Card = card
        self.position: int = position  # 상대방 카드 위치 (추측한 위치)
        self.guessed_value: str = guessed_value
        self.is_correct: bool = is_correct
        self.revealed_position: int = revealed_position  # 틀렸을 때 공개된 내 카드 위치



    def __repr__(self) -> str:
        return str(self)
    
    def __str__(self) -> str:
        if self.is_invalid:
            return f"Player {self.player.id} made an invalid guess."
        if self.is_correct:
            return f"Player {self.player.id} correctly guessed {self.guessed_value} for card {self.card} at position {self.position}"
        else:
            return f"Player {self.player.id} incorrectly guessed {self.guessed_value} for card at position {self.position}, Last drawn card of player {self.player.id} was {self.card}"