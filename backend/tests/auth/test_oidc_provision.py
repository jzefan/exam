from sqlalchemy import select

from app.auth.oidc_provision import get_or_provision_user
from app.rbac.models import Organization, Role, UserOrganization


async def test_oidc_provision_assigns_default_teacher_membership(db_session):
    org = Organization(name="Default Organization", type="school", is_active=True)
    role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, role])
    await db_session.commit()

    user = await get_or_provision_user(
        db_session,
        {
            "sub": "arkloop-user-1",
            "email": "teacher@example.com",
            "name": "Teacher One",
        },
    )

    assert user is not None
    assert user.username == "teacher"
    assert user.provider == "arkloop"
    assert user.oidc_subject == "arkloop-user-1"

    result = await db_session.execute(
        select(UserOrganization).where(UserOrganization.user_id == user.id)
    )
    membership = result.scalar_one()
    assert membership.org_id == org.id
    assert membership.role_id == role.id
    assert membership.is_primary is True
    assert membership.is_primary_role is True
