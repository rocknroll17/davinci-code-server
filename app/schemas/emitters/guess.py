from __future__ import annotations
from typing import TYPE_CHECKING
from pydantic import BaseModel
from typing import Optional

from .enums import ActionType

from .base import BaseEmitter

if TYPE_CHECKING:
    from app.schemas.results.guess import GuessResult
    from app.schemas.game import GameState
    
# ==================== Guess Emitter ====================

class RevealedCard(BaseModel):
    """공개된 카드 정보"""
    position: int
    color: int
    value: int
    revealed: bool = True


class GuessEmitter(BaseEmitter):
    """
    Guess 결과 Emitter
    
    - actor: 추측 결과 + 틀렸으면 공개된 내 카드 + state
    - opponent: 추측 위치/값/결과 + 맞췄으면 공개된 내 카드
    """
    action = ActionType.GUESS
    
    def __init__(
        self, 
        result: "GuessResult", 
        state: "GameState", 
        message: str,
        revealed_card: Optional[RevealedCard] = None
    ):
        super().__init__()
        self.result = result
        self.state = state
        self.message = message
        self.revealed_card = revealed_card
        self._build()
    
    def _build(self):
        result = self.result
        value_int = int(result.guessed_value)  # "5" -> 5, "12" -> 12
        value_str = "조커" if value_int == 12 else str(value_int)
        
        # Actor 데이터 (state가 있을 때만)
        if self.state is not None:
            self.actor_data = {
                "action": self.action.value,
                "position": result.position,
                "value": value_int,
                "correct": result.is_correct,
                "message": self.message,
                "state": self.state.model_dump()
            }
            
            # 틀렸을 때 본인에게 공개된 카드 정보 추가
            if not result.is_correct and self.revealed_card:
                self.actor_data["revealed_card"] = self.revealed_card.model_dump()
        else:
            self.actor_data = None
        
        # Opponent 데이터
        self.opponent_data = {
            "action": self.action.value,
            "position": result.position,
            "value": value_int,
            "correct": result.is_correct,
            "message": f"상대방이 위치 {result.position}을(를) {value_str}로 추측했습니다."
        }
        
        # 맞췄을 때 상대에게 공개된 카드 정보 (상대 입장에서는 자기 카드가 공개됨)
        if result.is_correct and result.card:
            self.opponent_data["revealed_position"] = result.position
            self.opponent_data["revealed_value"] = result.card.value
        
        # 틀렸을 때 상대에게 공개된 카드 정보 (추측한 사람의 카드가 공개됨)
        if not result.is_correct and result.revealed_position >= 0:
            self.opponent_data["revealed_position"] = result.revealed_position
            self.opponent_data["revealed_value"] = result.card.value if result.card else None
