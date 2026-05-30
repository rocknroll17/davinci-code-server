"""
Configuration settings
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Da Vinci Code Game"
    HOST: str = "0.0.0.0"
    PORT: int = 6000
    CHECKPOINT_PATH: str = "checkpoints/model.pt"

    # AI 추론 시각화(AI Lab) 토글. 운영 기본 OFF — AI는 추론 데이터 없이 바로 플레이.
    # ENABLE_REASONING=true 로 켜면 /ai Lab + ai_reasoning SSE + 확인 핸드셰이크 활성화.
    ENABLE_REASONING: bool = False

    class Config:
        env_file = ".env"


settings = Settings()
