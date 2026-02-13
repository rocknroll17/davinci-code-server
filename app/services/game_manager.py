from typing import Dict, List, Optional, TYPE_CHECKING
from uuid import uuid4
import asyncio
import time
import logging

from .game_session import GameSession

from app.core.exceptions import GameNotStarted

logger = logging.getLogger(__name__)

# 게임 세션 TTL (초)
GAME_SESSION_TTL = 3600  # 1시간
CLEANUP_INTERVAL = 300  # 5분마다 정리

class GameManager:
    """게임 매니저 - 여러 게임 세션 관리 (Singleton)"""
    
    _instance: Optional["GameManager"] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self.games: Dict[str, GameSession] = {}
        self._game_timestamps: Dict[str, float] = {}  # 게임 생성/업데이트 시간
        self._cleanup_task: Optional[asyncio.Task] = None
        self._initialized = True
    
    def create_game(self) -> tuple[str, str]:
        """
        새 PvP 게임 생성 + 첫 번째 플레이어 추가
        
        Returns: (game_id, player_id)
        """
        game_id = uuid4().hex[:8]
        session = GameSession(game_id)
        player_id = session.add_player()  # HumanPlayer
        
        self.games[game_id] = session
        self._game_timestamps[game_id] = time.time()
        session.log("게임이 생성되었습니다. 상대방을 기다리는 중...")
        logger.info(f"Game created: {game_id}")
        
        return game_id, player_id
    
    def create_ai_game(self, use_model: bool = True) -> tuple[str, str]:
        """
        AI 대전 게임 생성
        
        Human(선공) vs AI(후공) 게임 즉시 시작
        
        Args:
            use_model: True면 학습된 모델, False면 랜덤 AI
        Returns: (game_id, player_id)
        """
        game_id = uuid4().hex[:8]
        session = GameSession(game_id)
        
        # Human 먼저 추가 (선공)
        player_id = session.add_player()  # HumanPlayer
        
        # AI 추가 (후공) - 이때 게임 자동 시작
        session.add_ai_player()
        
        self.games[game_id] = session
        self._game_timestamps[game_id] = time.time()
        session.log("AI 대전이 시작되었습니다!")
        logger.info(f"AI game created: {game_id}")
        
        return game_id, player_id
    
    def join_game(self, game_id: str) -> str:
        """
        기존 게임에 참가
        
        Args:
            game_id: 게임 ID
        Returns: player_id
        Raises: GameNotStarted, ValueError
        """
        session = self.get_game(game_id)
        
        if session.is_full:
            raise ValueError("이미 게임이 시작되었습니다.")
        
        player_id = session.add_player()
        session.log("상대방이 참가했습니다!")
        
        return player_id
    
    def get_game(self, game_id: str) -> GameSession:
        """게임 세션 조회"""
        if game_id not in self.games:
            raise GameNotStarted()
        return self.games[game_id]
    
    def remove_game(self, game_id: str):
        """게임 제거"""
        if game_id in self.games:
            del self.games[game_id]
            self._game_timestamps.pop(game_id, None)
            logger.info(f"Game removed: {game_id}")
    
    def touch_game(self, game_id: str):
        """게임 타임스탬프 갱신 (활동 시 호출)"""
        if game_id in self._game_timestamps:
            self._game_timestamps[game_id] = time.time()
    
    def cleanup_expired_games(self):
        """만료된 게임 세션 정리"""
        now = time.time()
        expired = [
            gid for gid, ts in self._game_timestamps.items()
            if now - ts > GAME_SESSION_TTL
        ]
        for gid in expired:
            session = self.games.get(gid)
            # 종료된 게임만 삭제 (대기 중인 게임도 1시간 후 삭제)
            self.remove_game(gid)
            logger.info(f"Expired game cleaned up: {gid}")
        return len(expired)
    
    async def start_cleanup_task(self):
        """백그라운드 정리 타스크 시작"""
        if self._cleanup_task is not None:
            return
        
        async def cleanup_loop():
            while True:
                await asyncio.sleep(CLEANUP_INTERVAL)
                count = self.cleanup_expired_games()
                if count > 0:
                    logger.info(f"Cleaned up {count} expired games")
        
        self._cleanup_task = asyncio.create_task(cleanup_loop())
        logger.info("Game cleanup task started")
    
    def list_games(self) -> List[str]:
        """활성 게임 목록"""
        return list(self.games.keys())
    
    def list_waiting_games(self) -> List[str]:
        """대기 중인 게임 목록 (1명만 참가)"""
        return [gid for gid, session in self.games.items() if not session.is_full]


# 전역 매니저
game_manager = GameManager()