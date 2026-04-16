import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    username: str
    email: EmailStr | None = None
    password: str
    full_name: str
    org_id: uuid.UUID | None = None
    role_name: str = "student"
    role_names: list[str] | None = None
    owner_teacher_id: uuid.UUID | None = None
    teacher_ids: list[uuid.UUID] | None = None


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    is_active: bool | None = None
    password: str | None = None
    role_names: list[str] | None = None
    owner_teacher_id: uuid.UUID | None = None
    teacher_ids: list[uuid.UUID] | None = None


class UserOrgInfo(BaseModel):
    model_config = {"from_attributes": True}

    org_id: uuid.UUID
    org_name: str
    org_type: str
    role_id: uuid.UUID
    role_name: str
    role_display_name: str
    is_primary: bool


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    username: str
    email: str
    full_name: str
    is_active: bool
    primary_org: UserOrgInfo | None = None
    organizations: list[UserOrgInfo] = []
    system_domain: str
    owner_teacher_id: uuid.UUID | None = None
    owner_teacher_name: str | None = None
    teacher_ids: list[uuid.UUID] = []
    teacher_names: list[str] = []
    managed_student_count: int = 0
    created_at: datetime
    updated_at: datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
