from typing import Annotated
import logging
import uuid
from datetime import datetime, timedelta, timezone
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.activity_logs.service import CATEGORY_AUTH, log_event
from app.auth.dependencies import CurrentUser
from app.auth.models import User
from app.auth.schemas import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ForceChangePasswordRequest,
    ForceChangePasswordResponse,
    LoginRequest,
    ResetPasswordRequest,
    ResetPasswordResponse,
    TokenResponse,
    UserCreate,
    UserResponse,
)
from app.auth.security import create_access_token
from app.auth.email import EmailNotConfiguredError, send_password_reset_email
from app.auth.service import (
    LoginFailureReason,
    authenticate_user_with_reason,
    build_password_reset_url,
    build_user_response,
    create_password_reset_token,
    create_user,
    force_change_password_for_student,
    get_user_by_account,
    get_user_by_email,
    get_user_by_username,
    has_real_email,
    mask_email,
    reset_password_with_token,
)
from app.auth.dependencies import user_has_role
from app.database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

LOGIN_FAILURE_MESSAGES = {
    LoginFailureReason.USER_NOT_FOUND: "账号不存在，请检查用户名或手机号",
    LoginFailureReason.WRONG_PASSWORD: "密码错误，请重新输入",
}


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    data: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> UserResponse:
    if await get_user_by_username(db, data.username):
        await log_event(
            db,
            event_category=CATEGORY_AUTH,
            event_type="register",
            username=data.username,
            success=False,
            metadata={"reason": "username_exists"},
            request=request,
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该用户名已存在，请更换后重试")
    if data.email and await get_user_by_email(db, data.email):
        await log_event(
            db,
            event_category=CATEGORY_AUTH,
            event_type="register",
            username=data.username,
            success=False,
            metadata={"reason": "email_exists"},
            request=request,
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已被注册，请更换邮箱或直接登录")
    user = await create_user(db, data)
    await log_event(
        db,
        event_category=CATEGORY_AUTH,
        event_type="register",
        user=user,
        request=request,
    )
    return await build_user_response(db, user)


@router.post("/login", response_model=TokenResponse)
async def login(
    data: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> TokenResponse:
    started_at = perf_counter()
    user, failure_reason = await authenticate_user_with_reason(db, data.username, data.password)
    authenticated_at = perf_counter()
    if user is None:
        await log_event(
            db,
            event_category=CATEGORY_AUTH,
            event_type="login",
            username=data.username,
            success=False,
            metadata={"reason": failure_reason.value if failure_reason else "unknown"},
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=LOGIN_FAILURE_MESSAGES.get(failure_reason, "登录失败，请检查账号和密码"),
        )
    if user.user_type == "external_guest":
        await log_event(
            db,
            event_category=CATEGORY_AUTH,
            event_type="login",
            user=user,
            success=False,
            metadata={"reason": "external_guest_rejected"},
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="External guests must use invitation links to access exams",
        )
    user_id = user.id
    previous_login_at = (
        await db.execute(select(User.last_login_at).where(User.id == user_id))
    ).scalar_one_or_none()
    await log_event(
        db,
        event_category=CATEGORY_AUTH,
        event_type="login",
        user=user,
        request=request,
    )
    now = datetime.now(timezone.utc)
    if previous_login_at is not None and previous_login_at.tzinfo is None:
        previous_login_at = previous_login_at.replace(tzinfo=timezone.utc)
    onboarding_reason = None
    if previous_login_at is None:
        onboarding_reason = "first_login"
    elif now - previous_login_at >= timedelta(days=7):
        onboarding_reason = "returning_after_week"
    # Students are limited to a single active session: each login mints a fresh
    # session id, stored on the user and embedded in the JWT. Teachers/admins are
    # unaffected and may stay logged in on multiple devices.
    is_student = await user_has_role(db, user_id, "student")
    session_id = uuid.uuid4().hex if is_student else None
    token = create_access_token(user_id, "", session_id=session_id)
    token_created_at = perf_counter()
    user_response = await build_user_response(db, user, include_relationship_metadata=False)
    update_values: dict = {"last_login_at": now}
    if session_id is not None:
        update_values["session_token"] = session_id
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(**update_values)
        .execution_options(synchronize_session=False)
    )
    await db.flush()
    finished_at = perf_counter()
    if finished_at - started_at >= 0.5:
        logger.warning(
            "Slow auth login username=%s authenticate_ms=%.1f token_ms=%.1f response_ms=%.1f total_ms=%.1f",
            data.username,
            (authenticated_at - started_at) * 1000,
            (token_created_at - authenticated_at) * 1000,
            (finished_at - token_created_at) * 1000,
            (finished_at - started_at) * 1000,
        )
    return TokenResponse(access_token=token, user=user_response, onboarding_reason=onboarding_reason)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(
    data: ForgotPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ForgotPasswordResponse:
    user = await get_user_by_account(db, data.account)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到对应账号，请检查用户名或手机号")
    if not has_real_email(user):
        return ForgotPasswordResponse(
            status="contact_admin",
            message="该账号注册时未留下邮箱，请联系管理员重置密码。",
            email=None,
        )
    token, _reset_token = await create_password_reset_token(db, user)
    reset_url = build_password_reset_url(token)
    try:
        await send_password_reset_email(to_email=user.email, reset_url=reset_url)
    except EmailNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="邮件服务未配置，请联系管理员处理。",
        ) from exc
    return ForgotPasswordResponse(
        status="email_sent",
        message="重置链接已发送至绑定邮箱，请查收。",
        email=mask_email(user.email),
    )


@router.post("/reset-password", response_model=ResetPasswordResponse)
async def reset_password(
    data: ResetPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ResetPasswordResponse:
    if len(data.password) < 6:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="密码至少需要6位")
    if not await reset_password_with_token(db, data.token, data.password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="重置链接无效或已过期")
    return ResetPasswordResponse(message="密码已重置，请使用新密码登录")


@router.get("/me", response_model=UserResponse)
async def get_me(user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]) -> UserResponse:
    return await build_user_response(db, user)


@router.post("/force-change-password", response_model=ForceChangePasswordResponse)
async def force_change_password(
    data: ForceChangePasswordRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ForceChangePasswordResponse:
    if not await user_has_role(db, user.id, "student"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅学生账号需要执行首次改密")
    if not user.must_change_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前账号无需首次改密")
    if data.confirm_password is not None and data.password != data.confirm_password:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="两次输入的密码不一致")
    updated = await force_change_password_for_student(db, user, data.password)
    return ForceChangePasswordResponse(
        message="密码修改成功",
        user=await build_user_response(db, updated),
    )
