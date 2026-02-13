"""
Place Action Handler

카드 배치 액션 처리.
Human과 AI 모두 동일한 로직 사용.
"""

from __future__ import annotations
from typing import TYPE_CHECKING, Any, Dict

from .base import ActionHandler
from app.schemas.emitters.place import PlaceEmitter

if TYPE_CHECKING:
    from app.services.game_session import GameSession
    from app.schemas.results.place import PlaceResult


class PlaceHandler(ActionHandler):
    """
    Place 액션 핸들러
    
    Args:
        session: 게임 세션
        player_id: 플레이어 ID
        color: 카드 색상
        number: 카드 번호
        position: 배치 위치
    """
    
    def __init__(
        self, 
        session: "GameSession", 
        player_id: str, 
        color: int, 
        number: int, 
        position: int
    ):
        super().__init__(session, player_id)
        self._result: PlaceResult | None = None
        self.color = color
        self.number = number
        self.position = position
    
    def execute_action(self) -> "PlaceResult":
        """카드 배치 실행"""
        result = self.engine.place(self.player_id, self.color, self.number, self.position)
        
        # 메시지 설정
        color_name = "검정" if self.color == 0 else "흰색"
        if self.is_ai:
            self._message = f"상대방이 {color_name} 카드를 위치 {self.position}에 배치했습니다."
        else:
            self._message = "상대방 카드를 추측하세요."
        
        self.session.message = self._message
        return result
    
    def emit(self) -> None:
        """SSE 발송"""
        state = self._build_state()
        emitter = PlaceEmitter(self._result, state, self._message)
        
        if self.is_ai:
            emitter.emit_to_opponent_only(self.session, self.player_id)
        else:
            emitter.emit(self.session, self.player_id)
    
    def log(self) -> None:
        """로그 기록"""
        color_name = "검정" if self.color == 0 else "흰색"
        player_idx = self.player.player_index + 1
        self.session.log(f"플레이어 {player_idx}이(가) {color_name} 카드를 위치 {self.position}에 배치했습니다.")
    
    def build_response(self) -> Dict[str, Any]:
        """API 응답"""
        return {
            "success": True,
            "placed_position": self._result.position
        }
