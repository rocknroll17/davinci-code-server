from enum import IntEnum
from typing import Optional, List
from pydantic import BaseModel, Field

# ==================== Card ====================

class Color(IntEnum):
    BLACK = 0
    WHITE = 1

class CardInfo(BaseModel):
    """카드 정보"""
    position: int
    color: int
    value: int  # -1 = hidden
    revealed: bool
    is_last_drawn: bool = False  # 마지막으로 뽑은 카드 여부


class PendingCardInfo(BaseModel):
    """배치 대기 중인 카드"""
    color: int
    value: int
    valid_positions: List[int]