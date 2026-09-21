import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

UserPersona = Literal["teacher", "assessor"]


class UserCreate(BaseModel):
    username: str
    email: EmailStr | None = None
    password: str
    full_name: str
    org_id: uuid.UUID | None = None
    role_name: str = "student"
    role_names: list[str] | None = None
    persona: UserPersona = "teacher"
    owner_teacher_id: uuid.UUID | None = None
    teacher_ids: list[uuid.UUID] | None = None


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    is_active: bool | None = None
    password: str | None = None
    role_names: list[str] | None = None
    persona: UserPersona | None = None
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
    must_change_password: bool = False
    persona: UserPersona
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
    # Optional: when an account holds several roles the client sends the one the
    # user picked on the second step; a single-role account may omit it.
    role_name: str | None = None


class RoleOption(BaseModel):
    """One selectable login identity, deduplicated by role name."""

    name: str
    display_name: str
    org_names: list[str] = []


class SelectRoleRequest(BaseModel):
    selection_token: str
    role_name: str


class TokenResponse(BaseModel):
    # Both are None while a role still has to be picked.
    access_token: str | None = None
    token_type: str = "bearer"
    user: UserResponse | None = None
    onboarding_reason: Literal["first_login", "returning_after_week"] | None = None
    requires_role_selection: bool = False
    selection_token: str | None = None
    roles: list[RoleOption] = []


class ForgotPasswordRequest(BaseModel):
    account: str


class ForgotPasswordResponse(BaseModel):
    status: Literal["email_sent", "contact_admin"]
    message: str
    email: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class ResetPasswordResponse(BaseModel):
    message: str


class ForceChangePasswordRequest(BaseModel):
    password: str = Field(min_length=6)
    confirm_password: str | None = None


class ForceChangePasswordResponse(BaseModel):
    message: str
    user: "UserResponse"
