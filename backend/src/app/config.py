from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_prefix": "EXAM_", "env_file": ".env", "extra": "ignore"}

    database_url: str = "postgresql+asyncpg://exam:exam@localhost:5432/exam"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    cors_origins: list[str] = ["http://localhost:4000"]
    debug: bool = False
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_model_name: str = "deepseek-chat"
    qwen_api_key: str | None = None
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model_name: str = "qwen-plus"
    kimi_api_key: str | None = None
    kimi_base_url: str = "https://api.moonshot.cn/v1"
    kimi_model_name: str = "moonshot-v1-8k"


settings = Settings()
