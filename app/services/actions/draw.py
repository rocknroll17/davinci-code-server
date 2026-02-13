"""
Draw Action Handler

카드 뽑기 액션 처리.
Human과 AI 모두 동일한 로직 사용.
"""

from __future__ import annotations
from typing import TYPE_CHECKING, Any, Dict

from .base import ActionHandler
from app.schemas.emitters.draw import DrawEmitter

if TYPE_CHECKING:
    from app.services.game_session import GameSession
    from app.schemas.results.draw import DrawResult


class DrawHandler(ActionHandler):
    """
    Draw 액션 핸들러
    
    Args:
        session: 게임 세션
        player_id: 플레이어 ID
        color: 카드 색상 (0=검정, 1=흰색)
    """
    
    def __init__(self, session: "GameSession", player_id: str, color: int):
        super().__init__(session, player_id)
        self._result: DrawResult | None = None
        self.color = color
    
    def execute_action(self) -> "DrawResult":
        """카드 뽑기 실행"""
        result = self.engine.draw(self.player_id, self.color)
        
        # 메시지 설정
        valid_positions = result.pending_card.valid_positions
        if len(valid_positions) != 1:
            self._message = f"카드를 배치할 위치를 선택하세요. ({len(valid_positions)}곳 가능)"
        else:
            self._message = "카드가 자동으로 배치됩니다."
        
        self.session.message = self._message
        return result
    
    def emit(self) -> None:
        """SSE 발송"""
        state = self._build_state()
        emitter = DrawEmitter(self._result, state, self._message)
        
        if not self.is_ai:
            emitter.emit(self.session, self.player_id)
    
    def build_response(self) -> Dict[str, Any]:
        """API 응답"""
        return {
            "success": True,
            "card": {
                "color": self._result.pending_card.color.value,
                "value": self._result.pending_card.value,
                "valid_positions": self._result.pending_card.valid_positions,
            }
        }
