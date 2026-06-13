from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_prefix": "EXAM_", "env_file": ".env", "extra": "ignore"}

    database_url: str = "postgresql+asyncpg://exam:exam@localhost:5432/exam"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    cors_origins: list[str] = ["http://localhost:4000"]
    debug: bool = False
    database_pool_size: int = 10
    database_max_overflow: int = 10
    database_pool_recycle_seconds: int = 14400
    database_warm_pool: bool = True
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_model_name: str = "deepseek-v4-flash"
    qwen_api_key: str | None = None
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model_name: str = "qwen-plus"
    qwen_vl_model_name: str = "qwen-vl-plus"
    kimi_api_key: str | None = None
    kimi_base_url: str = "https://api.moonshot.cn/v1"
    kimi_model_name: str = "moonshot-v1-8k"
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model_name: str = "anthropic/claude-3.5-sonnet"
    doubao_api_key: str | None = None
    doubao_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    doubao_model_name: str = "doubao-1-5-pro-32k-250115"
    # Toggle the arbiter (doubao) leg of the grading flow. When False we skip
    # arbitration entirely and use the reviewer model's score as the final
    # score. Keep this off until the upstream QPS quota is high enough that
    # the arbiter call doesn't get rate-limited under exam load.
    arbiter_enabled: bool = False
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

    # ─── OIDC SSO via ArkLoop IdP ────────────────────────────────────────
    # If oidc_issuer is empty, OIDC SSO is disabled and only local login works.
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = "http://localhost:8000/api/auth/oidc/callback"
    # Scopes requested from the IdP. exam:admin is intentionally excluded by default;
    # only explicitly granted via prompt=consent flow if ever needed.
    oidc_scopes: str = "openid profile email offline_access exam:read exam:write"
    oidc_jwks_cache_ttl_seconds: int = 3600

    # Exam paper export: header fields that are not part of the data model.
    exam_export_school_name: str = "江苏卫生健康职业学院"
    exam_export_form: str = "闭卷笔试"
    # Optional CJK .ttf to embed in exported PDFs (guarantees rendering on
    # viewers without Adobe-GB1 fonts). Empty -> built-in STSong-Light CID font.
    exam_export_pdf_font_path: str = ""

    # Course knowledge base (material RAG). The embedder calls an OpenAI-compatible
    # /embeddings endpoint; defaults reuse the Qwen/DashScope credentials above.
    # Switching the model implies re-ingesting materials (vector dims must match).
    kb_embedding_provider: str = "qwen"  # qwen | doubao | custom
    kb_embedding_model: str = "text-embedding-v3"
    kb_embedding_dim: int = 1024
    kb_embedding_base_url: str = ""  # empty -> derived from provider above
    kb_embedding_api_key: str = ""  # empty -> derived from provider above


settings = Settings()
