"""Pydantic schemas for exam invitation APIs."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class CandidateImportItem(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=5, max_length=20)
    email: EmailStr | None = None


class InvitationCreated(BaseModel):
    user_id: uuid.UUID
    invitation_id: uuid.UUID
    invite_url: str


class InvitationListItem(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    candidate_name: str
    candidate_phone: str
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None


class RedeemRequest(BaseModel):
    token: str = Field(min_length=20)


class RedeemResponse(BaseModel):
    access_token: str
    exam_id: uuid.UUID
    candidate_name: str
