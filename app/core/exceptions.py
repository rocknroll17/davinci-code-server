"""
Custom Exceptions
"""

from fastapi import HTTPException, status

def handle_game_error(e: Exception):
    """게임 예외를 HTTP 예외로 변환"""
    if isinstance(e, GameNotStarted):
        raise HTTPException(status_code=404, detail="게임을 찾을 수 없습니다.")
    elif isinstance(e, NotYourTurn):
        raise HTTPException(status_code=400, detail=str(e))
    elif isinstance(e, InvalidAction):
        raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(status_code=500, detail=str(e))


class GameException(HTTPException):
    """게임 관련 예외 베이스"""
    def __init__(self, detail: str):
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


class GameNotStarted(GameException):
    def __init__(self):
        super().__init__("게임이 시작되지 않았습니다.")


class GameAlreadyOver(GameException):
    def __init__(self):
        super().__init__("게임이 이미 종료되었습니다.")


class NotYourTurn(GameException):
    def __init__(self, msg: str = "당신의 차례가 아닙니다."):
        super().__init__(msg)


class InvalidAction(GameException):
    def __init__(self, msg: str = "유효하지 않은 액션입니다."):
        super().__init__(msg)


class InvalidPhase(GameException):
    def __init__(self, expected: str, current: str):
        super().__init__(f"{expected} 페이즈가 아닙니다. (현재: {current})")


class InvalidPosition(GameException):
    def __init__(self, max_pos: int):
        super().__init__(f"유효하지 않은 위치입니다. (0-{max_pos})")


class NoCardsAvailable(GameException):
    def __init__(self, color: str):
        super().__init__(f"{color} 카드가 없습니다.")


class JokerPending(GameException):
    def __init__(self):
        super().__init__("조커 위치를 먼저 선택해주세요.")


class NoJokerPending(GameException):
    def __init__(self):
        super().__init__("위치를 선택할 조커가 없습니다.")
