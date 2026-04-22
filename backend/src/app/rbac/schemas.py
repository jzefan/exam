"""Pydantic schemas for RBAC entities."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

OrgTypeEnum = Literal["enterprise", "school"]
PermissionAction = Literal["create", "read", "update", "delete"]


class OrganizationCreate(BaseModel):
    name: str = Field(max_length=200)
    type: OrgTypeEnum
    description: str | None = None
    logo_url: str | None = None


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    logo_url: str | None = None
    is_active: bool | None = None


class OrganizationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    type: str
    description: str | None
    logo_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PermissionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    resource: str
    action: str
    description: str | None


class RoleCreate(BaseModel):
    name: str = Field(max_length=50)
    display_name: str = Field(max_length=100)
    description: str | None = None
    org_id: uuid.UUID | None = None
    permission_ids: list[uuid.UUID] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    description: str | None = None
    permission_ids: list[uuid.UUID] | None = None


class RoleResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    display_name: str
    description: str | None
    is_system: bool
    org_id: uuid.UUID | None
    permissions: list[PermissionResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class UserOrganizationCreate(BaseModel):
    user_id: uuid.UUID
    org_id: uuid.UUID
    role_id: uuid.UUID
    is_primary: bool = False


class UserOrganizationResponse(BaseModel):
    model_config = {"from_attributes": True}

    user_id: uuid.UUID
    org_id: uuid.UUID
    role_id: uuid.UUID
    is_primary: bool
    organization: OrganizationResponse | None = None
    role: RoleResponse | None = None


class StudentCreate(BaseModel):
    full_name: str
    phone: str | None = None
    student_id: str | None = None
    class_id: uuid.UUID | None = None

    @field_validator("full_name", "phone", "student_id", mode="before")
    @classmethod
    def strip_text_fields(cls, value):
        if value is None:
            return None
        stripped = str(value).strip()
        return stripped or None

    @model_validator(mode="after")
    def require_account_identifier(self):
        if not self.phone and not self.student_id:
            raise ValueError("手机号和学号至少需要填写一项")
        return self


class ClassCreate(BaseModel):
    name: str = Field(max_length=100)


class ClassResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    name: str
    org_id: uuid.UUID
    created_at: datetime


class StudentRead(BaseModel):
    id: uuid.UUID
    full_name: str
    phone: str | None
    student_id: str | None
    class_id: uuid.UUID | None
    owner_teacher_id: uuid.UUID | None = None
    class_name: str | None = None
    username: str
    is_active: bool

    class Config:
        from_attributes = True


class BatchImportResponse(BaseModel):
    success_count: int
    failed_count: int
    errors: list[str] = []


class StudentBatchDeleteRequest(BaseModel):
    student_ids: list[uuid.UUID] = Field(default_factory=list)


class StudentBatchDeleteResponse(BaseModel):
    success_count: int
    failed_count: int
    errors: list[str] = []
