"""
Action Handlers

모든 게임 액션(Draw, Place, Guess, Decision)을 통일된 방식으로 처리.
Human과 AI가 동일한 Handler를 사용하여 코드 중복 제거.

사용 예시:
    handler = DrawHandler(session, player_id, color=0)
    result = await handler.execute()  # 검증 → 실행 → Emit → 결과 반환
"""

from .base import ActionHandler, ActionResult
from .draw import DrawHandler
from .place import PlaceHandler
from .guess import GuessHandler
from .decision import DecisionHandler

__all__ = [
    "ActionHandler",
    "ActionResult",
    "DrawHandler",
    "PlaceHandler",
    "GuessHandler",
    "DecisionHandler",
]
