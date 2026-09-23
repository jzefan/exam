from pydantic import BaseModel, ConfigDict, Field


class StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ImportPaper(StrictPayload):
    review_hash: str = Field(min_length=64, max_length=64)
    completeness_confirmed: bool


class ConfirmScore(StrictPayload):
    version: int = Field(ge=1)
    score: float = Field(ge=0, le=100000)
    reason: str = Field(default="", max_length=2000)
    # Teacher may supply the maximum only when the source maximum is unknown.
    max_score: float | None = Field(default=None, gt=0, le=100000)
