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
    deepseek_model_name: str = "deepseek-v4-pro"
    qwen_api_key: str | None = None
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model_name: str = "qwen-3.6"
    qwen_vl_model_name: str = "qwen-3.6"
    kimi_api_key: str | None = None
    kimi_base_url: str = "https://api.moonshot.cn/v1"
    kimi_model_name: str = "moonshot-v1-8k"
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model_name: str = "anthropic/claude-3.5-sonnet"
    grading_score_diff_threshold: float = 0.15
    grading_dimension_diff_threshold: float = 0.20
    judge_runner_url: str | None = None
    lsp_runner_url: str | None = None
    frontend_base_url: str = "http://localhost:4000"
    password_reset_token_expire_minutes: int = 30
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True


settings = Settings()
