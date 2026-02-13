"""
Game State Manager - 게임 상태만 관리
"""

from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field


@dataclass
class JokerState:
    """조커 배치 대기 상태"""
    color: int
    current_position: int
    terminated: bool
    info: Dict[str, Any]


@dataclass
class GameStateManager:
    """게임 상태 관리"""
    
    game_over: bool = False
    winner: Optional[int] = None  # 0=human, 1=ai
    message: str = ""
    logs: List[str] = field(default_factory=list)
    last_event: Optional[Dict[str, Any]] = None
    joker: Optional[JokerState] = None
    
    MAX_LOGS: int = 10
    
    def reset(self, player_first: bool = True):
        """상태 초기화"""
        self.game_over = False
        self.winner = None
        self.logs = []
        self.last_event = None
        self.joker = None
        
        if player_first:
            self.log("게임 시작! 당신의 차례입니다.")
            self.message = "카드를 뽑으세요."
        else:
            self.log("게임 시작! AI가 먼저 시작합니다.")
            self.message = "AI 차례입니다..."
    
    def log(self, msg: str):
        """로그 추가"""
        self.logs.append(msg)
        if len(self.logs) > self.MAX_LOGS:
            self.logs.pop(0)
    
    def set_event(self, event_type: str, player: str, **data):
        """이벤트 설정"""
        self.last_event = {"type": event_type, "player": player, "data": data}
    
    def set_joker_pending(self, color: int, position: int, terminated: bool, info: dict):
        """조커 대기 상태 설정"""
        self.joker = JokerState(color, position, terminated, info)
    
    def clear_joker(self) -> JokerState:
        """조커 대기 상태 해제 후 반환"""
        joker = self.joker
        self.joker = None
        return joker
    
    def end_game(self, winner: Optional[int], human_id: int, ai_id: int):
        """게임 종료 처리"""
        self.game_over = True
        
        if winner == human_id:
            self.winner = 0
            self.message = "🎉 축하합니다! 당신이 이겼습니다!"
            self.log("🎉 당신의 승리!")
        elif winner == ai_id:
            self.winner = 1
            self.message = "💀 상대방이 이겼습니다."
            self.log("💀 상대방의 승리!")
        else:
            self.winner = None
            self.message = "🤝 무승부입니다."
            self.log("🤝 무승부!")
    
    @property
    def has_joker_pending(self) -> bool:
        return self.joker is not None
