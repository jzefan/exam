from sqlalchemy import Enum, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool

from app.common.data_visibility import VisibilityScope
from app.common.resource_access import (
    can_read_shared_resource,
    can_write_owned_resource,
    teacher_owned_resource_filter,
    teacher_visible_resource_filter,
)


class Base(DeclarativeBase):
    pass


class DemoResource(Base):
    __tablename__ = "demo_resources"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[str] = mapped_column(String(32), nullable=False)
    visibility: Mapped[VisibilityScope] = mapped_column(
        Enum(
            VisibilityScope,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            native_enum=False,
            name="visibilityscope",
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)


def _make_session() -> Session:
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def test_teacher_can_read_own_private_resource() -> None:
    assert can_read_shared_resource(
        is_platform_admin=False,
        current_user_id="teacher-a",
        owner_id="teacher-a",
        visibility=VisibilityScope.PRIVATE,
    )


def test_teacher_can_read_platform_visible_resource() -> None:
    assert can_read_shared_resource(
        is_platform_admin=False,
        current_user_id="teacher-a",
        owner_id="teacher-b",
        visibility=VisibilityScope.PLATFORM,
    )


def test_teacher_cannot_read_other_teachers_private_resource() -> None:
    assert not can_read_shared_resource(
        is_platform_admin=False,
        current_user_id="teacher-a",
        owner_id="teacher-b",
        visibility=VisibilityScope.PRIVATE,
    )


def test_platform_admin_can_read_private_resource() -> None:
    assert can_read_shared_resource(
        is_platform_admin=True,
        current_user_id="teacher-a",
        owner_id="teacher-b",
        visibility=VisibilityScope.PRIVATE,
    )


def test_teacher_can_write_own_resource() -> None:
    assert can_write_owned_resource(
        is_platform_admin=False,
        current_user_id="teacher-a",
        owner_id="teacher-a",
    )


def test_teacher_cannot_write_other_teachers_resource() -> None:
    assert not can_write_owned_resource(
        is_platform_admin=False,
        current_user_id="teacher-a",
        owner_id="teacher-b",
    )


def test_platform_admin_can_write_any_resource() -> None:
    assert can_write_owned_resource(
        is_platform_admin=True,
        current_user_id="teacher-a",
        owner_id="teacher-b",
    )


def test_teacher_visible_resource_filter_returns_owner_and_platform_rows() -> None:
    session = _make_session()
    try:
        session.add_all(
            [
                DemoResource(owner_id="teacher-a", visibility=VisibilityScope.PRIVATE, name="own private"),
                DemoResource(owner_id="teacher-b", visibility=VisibilityScope.PLATFORM, name="shared platform"),
                DemoResource(owner_id="teacher-b", visibility=VisibilityScope.PRIVATE, name="other private"),
            ]
        )
        session.commit()

        rows = session.scalars(
            select(DemoResource)
            .where(teacher_visible_resource_filter(DemoResource, "teacher-a"))
            .order_by(DemoResource.id)
        ).all()

        assert [row.name for row in rows] == ["own private", "shared platform"]
    finally:
        session.close()


def test_teacher_owned_resource_filter_returns_only_owner_rows() -> None:
    session = _make_session()
    try:
        session.add_all(
            [
                DemoResource(owner_id="teacher-a", visibility=VisibilityScope.PRIVATE, name="own private"),
                DemoResource(owner_id="teacher-a", visibility=VisibilityScope.PLATFORM, name="own platform"),
                DemoResource(owner_id="teacher-b", visibility=VisibilityScope.PLATFORM, name="other platform"),
            ]
        )
        session.commit()

        rows = session.scalars(
            select(DemoResource)
            .where(teacher_owned_resource_filter(DemoResource, "teacher-a"))
            .order_by(DemoResource.id)
        ).all()

        assert [row.name for row in rows] == ["own private", "own platform"]
    finally:
        session.close()
