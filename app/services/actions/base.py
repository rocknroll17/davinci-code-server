"""
Action Handler 기본 클래스

모든 액션의 공통 로직:
1. 검증 (validate)
2. 실행 (execute_action)
3. SSE 발송 (emit)
4. 후처리 (post_process - 게임오버, 턴변경 등)

Human과 AI 모두 동일한 Handler 사용.
AI일 때는 is_ai=True로 상대에게만 emit.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional, Any, Dict

if TYPE_CHECKING:
    from app.services.game_session import GameSession
    from app.services.game_engine import GameEngine


@dataclass
class ActionResult:
    """액션 실행 결과"""
    success: bool
    data: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


class ActionHandler(ABC):
    """
    액션 핸들러 기본 클래스
    
    Template Method 패턴:
    execute() 가 전체 플로우를 관리하고,
    서브클래스는 validate(), execute_action(), build_emitter()만 구현.
    
    Attributes:
        session: 게임 세션
        player_id: 행동하는 플레이어 ID
        is_ai: AI 플레이어 여부 (True면 상대에게만 emit)
    """
    
    def __init__(self, session: "GameSession", player_id: str):
        self.session = session
        self.player_id = player_id
        self.engine: "GameEngine" = session.engine
        self.player = self.engine.get_player_by_id(player_id)
        self.is_ai = self.player.is_ai
        
        # 서브클래스에서 설정
        self._result: Any = None
        self._message: str = ""
    
    # ==================== Template Method ====================
    
    async def execute(self) -> ActionResult:
        """
        액션 실행 (Template Method)
        
        Returns:
            ActionResult: 실행 결과
        """
        # 1. 검증
        error = self.validate()
        if error:
            return ActionResult(success=False, error=error)
        
        # 2. 실행
        try:
            self._result = self.execute_action()
        except (ValueError, RuntimeError) as e:
            return ActionResult(success=False, error=str(e))
        
        # 3. 로그 기록
        self.log()
        
        # 4. SSE 발송
        self.emit()
        
        # 5. 후처리 (게임오버, 턴변경 등)
        await self.post_process()
        
        # 6. 결과 반환
        return ActionResult(success=True, data=self.build_response())
    
    # ==================== 서브클래스 구현 필요 ====================
    
    def validate(self) -> Optional[str]:
        """
        검증 (선택적 오버라이드)
        
        Returns:
            에러 메시지 (없으면 None)
        """
        return None
    
    @abstractmethod
    def execute_action(self) -> Any:
        """
        Engine 액션 실행
        
        Returns:
            Engine 결과 (DrawResult, PlaceResult 등)
        """
        pass
    
    @abstractmethod
    def emit(self) -> None:
        """SSE 이벤트 발송"""
        pass
    
    def log(self) -> None:
        """로그 기록 (선택적 오버라이드)"""
        if self._result:
            self.session.log(self._result)
    
    async def post_process(self) -> None:
        """후처리 (선택적 오버라이드) - 게임오버, 턴변경 등"""
        pass
    
    def build_response(self) -> Dict[str, Any]:
        """API 응답 데이터 (선택적 오버라이드)"""
        return {"success": True}
    
    # ==================== 유틸리티 ====================
    
    def _build_state(self) -> Optional[Any]:
        """
        State 빌드
        
        AI는 state 없이 emit (상대에게만 opponent_action 보내기 때문)
        Human은 state 포함
        """
        if self.is_ai:
            return None
        return self.session._build_state(self.player_id, for_actor=True)
