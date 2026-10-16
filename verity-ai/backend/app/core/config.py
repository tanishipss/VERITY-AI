from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VERITY_", env_file=".env", extra="ignore")

    llm_provider: str = "mock"  # mock | anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-5-5"
    llm_timeout_seconds: float = 12.0
    llm_max_tokens: int = 1200

    max_evidence_items: int = 40
    max_evidence_chars: int = 1200
    rate_limit_per_minute: int = 20
    allowed_origins: list[str] = []
    allowed_origin_regex: str = r"^chrome-extension://[a-z]{32}$|^http://localhost(:\d+)?$"


settings = Settings()
