from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.auth.schemas import LoginRequest, TokenResponse, UserCreate, UserResponse
from app.auth.security import create_access_token
from app.auth.service import (
    authenticate_user,
    build_user_response,
    create_user,
    get_user_by_email,
    get_user_by_username,
)
from app.database import get_db

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(data: UserCreate, db: Annotated[AsyncSession, Depends(get_db)]) -> UserResponse:
    if await get_user_by_username(db, data.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    if data.email and await get_user_by_email(db, data.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    user = await create_user(db, data)
    return await build_user_response(db, user)


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]) -> TokenResponse:
    user = await authenticate_user(db, data.username, data.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.user_type == "external_guest":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="External guests must use invitation links to access exams",
        )
    token = create_access_token(user.id, "")
    user_response = await build_user_response(db, user)
    return TokenResponse(access_token=token, user=user_response)


@router.get("/me", response_model=UserResponse)
async def get_me(user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]) -> UserResponse:
    return await build_user_response(db, user)
