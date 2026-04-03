"""API routes for organization and role management."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.rbac.models import Permission, Role
from app.rbac.schemas import (
    OrganizationCreate,
    OrganizationResponse,
    OrganizationUpdate,
    PermissionResponse,
    RoleCreate,
    RoleResponse,
    RoleUpdate,
)
from app.rbac.service import (
    create_organization,
    create_role,
    get_organization_by_id,
    get_role_by_id,
    list_organizations,
    list_roles,
    update_organization,
    update_role,
)

org_router = APIRouter()
role_router = APIRouter()
permission_router = APIRouter()


# --- Organization Routes ---


@org_router.get("", response_model=list[OrganizationResponse])
async def list_orgs(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> list[OrganizationResponse]:
    orgs = await list_organizations(db)
    return [OrganizationResponse.model_validate(o) for o in orgs]


@org_router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_org(
    body: OrganizationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> OrganizationResponse:
    org = await create_organization(db, body)
    return OrganizationResponse.model_validate(org)


@org_router.get("/{org_id}", response_model=OrganizationResponse)
async def get_org(
    org_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> OrganizationResponse:
    org = await get_organization_by_id(db, org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return OrganizationResponse.model_validate(org)


@org_router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_org(
    org_id: uuid.UUID,
    body: OrganizationUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> OrganizationResponse:
    org = await get_organization_by_id(db, org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    updated = await update_organization(db, org, body)
    return OrganizationResponse.model_validate(updated)


# --- Role Routes ---


@role_router.get("", response_model=list[RoleResponse])
async def list_all_roles(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
    org_id: uuid.UUID | None = None,
) -> list[RoleResponse]:
    roles = await list_roles(db, org_id=org_id)
    result = []
    for role in roles:
        perms = [
            PermissionResponse.model_validate(rp.permission)
            for rp in role.role_permissions
        ]
        resp = RoleResponse.model_validate(role)
        resp.permissions = perms
        result.append(resp)
    return result


@role_router.post("", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_new_role(
    body: RoleCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> RoleResponse:
    role = await create_role(db, body)
    perms = [
        PermissionResponse.model_validate(rp.permission)
        for rp in role.role_permissions
    ]
    resp = RoleResponse.model_validate(role)
    resp.permissions = perms
    return resp


@role_router.patch("/{role_id}", response_model=RoleResponse)
async def update_existing_role(
    role_id: uuid.UUID,
    body: RoleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> RoleResponse:
    role = await get_role_by_id(db, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify system roles")
    updated = await update_role(db, role, body)
    perms = [
        PermissionResponse.model_validate(rp.permission)
        for rp in updated.role_permissions
    ]
    resp = RoleResponse.model_validate(updated)
    resp.permissions = perms
    return resp


# --- Permission Routes ---


@permission_router.get("", response_model=list[PermissionResponse])
async def list_permissions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> list[PermissionResponse]:
    result = await db.execute(select(Permission).order_by(Permission.resource, Permission.action))
    perms = result.scalars().all()
    return [PermissionResponse.model_validate(p) for p in perms]
