"""Pydantic schemas for RBAC entities."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

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
