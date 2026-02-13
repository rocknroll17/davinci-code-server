from __future__ import annotations
from typing import TYPE_CHECKING

from .enums import ActionType

from .base import BaseEmitter

if TYPE_CHECKING:
    from app.schemas.results.place import PlaceResult
    from app.schemas.game import GameState
#  ==================== Place Emitter ====================

class PlaceEmitter(BaseEmitter):
    """
    Place 결과 Emitter
    
    - actor: 배치 위치 + state
    - opponent: 카드 색상 + 배치 위치 (값은 비공개)
    """
    action = ActionType.PLACE
    
    def __init__(self, result: "PlaceResult", state: "GameState", message: str):
        super().__init__()
        self.result = result
        self.state = state
        self.message = message
        self._build()
    
    def _build(self):
        card = self.result.placed_card
        position = self.result.position
        color_name = "검정" if card.color.value == 0 else "흰색"
        
        # Actor 데이터 (state가 있을 때만)
        if self.state is not None:
            self.actor_data = {
                "action": self.action.value,
                "position": position,
                "message": self.message,
                "state": self.state.model_dump()
            }
        else:
            self.actor_data = None
        
        # Opponent 데이터 (값은 숨김)
        self.opponent_data = {
            "action": self.action.value,
            "color": card.color.value,
            "position": position,
            "message": f"상대방이 {color_name} 카드를 위치 {position}에 배치했습니다."
        }