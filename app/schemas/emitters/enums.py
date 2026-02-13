from enum import Enum


class ActionType(str, Enum):
    """액션 타입"""
    DRAW = "draw"
    PLACE = "place"
    GUESS = "guess"
    DECISION = "decision"


class EventType(str, Enum):
    """SSE 이벤트 타입"""
    MY_ACTION = "my_action"
    OPPONENT_ACTION = "opponent_action"
    TURN_CHANGE = "turn_change"
    GAME_OVER = "game_over"
    GAME_START = "game_start"
    PLAYER_DISCONNECTED = "player_disconnected"