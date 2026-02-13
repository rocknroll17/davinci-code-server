"""
Configuration settings
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Da Vinci Code Game"
    HOST: str = "0.0.0.0"
    PORT: int = 6000
    CHECKPOINT_PATH: str = "checkpoints/model.pt"
    
    class Config:
        env_file = ".env"


settings = Settings()
