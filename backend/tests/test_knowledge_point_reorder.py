"""课程目录重排：同级上下移动 + 拖到别的目录下成为子目录。

覆盖 `POST /api/knowledge/knowledge-points/{kp_id}/reorder` 与配套 service 函数，
并顺带守住「知识树按 sort_order 展示」这条口径。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning import service
from app.learning.models import KnowledgePoint
from app.learning.schemas import KnowledgePointCreate
from app.rbac.models import Organization, Role


async def _create_teacher(db_session: AsyncSession) -> tuple[uuid.UUID, str]:
    """返回 (teacher_id, token)：只留纯值，避免请求失败回滚后 ORM 对象过期。"""

    org = Organization(name="Catalog Reorder School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, teacher_role])
    await db_session.flush()
    user = await create_user(
        db_session,
        UserCreate(
            username="teacher-catalog-reorder",
            email="teacher-catalog-reorder@example.com",
            password="teacherpass123",
            full_name="Catalog Reorder Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    return user.id, create_access_token(user.id, "")


async def _seed(db_session: AsyncSession, owner_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """建一棵 course → (章A, 章B) → 节 的目录，同级都带显式 sort_order。

    返回一组裸 id：接口返回 400 时依赖会回滚并让 ORM 实例过期，
    之后再读实例属性会触发同步懒加载（MissingGreenlet），所以不留对象。
    """

    course = KnowledgePoint(
        name="计算机网络基础", owner_id=owner_id, visibility=VisibilityScope.PRIVATE, sort_order=0
    )
    db_session.add(course)
    await db_session.flush()

    chapter_a = KnowledgePoint(
        name="第一章 概述",
        parent_id=course.id,
        owner_id=owner_id,
        visibility=VisibilityScope.PRIVATE,
        sort_order=0,
    )
    chapter_b = KnowledgePoint(
        name="第二章 物理层",
        parent_id=course.id,
        owner_id=owner_id,
        visibility=VisibilityScope.PRIVATE,
        sort_order=1,
    )
    db_session.add_all([chapter_a, chapter_b])
    await db_session.flush()

    leaf = KnowledgePoint(
        name="1.1 互联网概述",
        parent_id=chapter_a.id,
        owner_id=owner_id,
        visibility=VisibilityScope.PRIVATE,
        sort_order=0,
    )
    db_session.add(leaf)
    await db_session.commit()
    return {
        "course": course.id,
        "chapter_a": chapter_a.id,
        "chapter_b": chapter_b.id,
        "leaf": leaf.id,
    }


async def _tree_children(client: AsyncClient, course_id: uuid.UUID) -> dict[str, list[str]]:
    """把知识树读成 {父节点名: [子节点名]}，用于断言目录顺序。"""

    response = await client.get(f"/api/teacher/courses/{course_id}/knowledge-tree")
    assert response.status_code == 200, response.text
    tree = response.json()
    return {
        tree["name"]: [child["name"] for child in tree["children"]],
        **{
            child["name"]: [grandchild["name"] for grandchild in child["children"]]
            for child in tree["children"]
        },
    }


@pytest.mark.asyncio
async def test_reorder_moves_node_under_another_parent(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """拖到别的目录下：reparent 到新父节点，并在目标父节点里排到指定位置。"""

    teacher_id, token = await _create_teacher(db_session)
    nodes = await _seed(db_session, teacher_id)
    client.headers.update({"Authorization": f"Bearer {token}"})

    response = await client.post(
        f"/api/knowledge/knowledge-points/{nodes['leaf']}/reorder",
        json={"parent_id": str(nodes["chapter_b"]), "ordered_ids": [str(nodes["leaf"])]},
    )
    assert response.status_code == 200, response.text

    children = await _tree_children(client, nodes["course"])
    assert children["计算机网络基础"] == ["第一章 概述", "第二章 物理层"]
    assert children["第一章 概述"] == []
    assert children["第二章 物理层"] == ["1.1 互联网概述"]


@pytest.mark.asyncio
async def test_reorder_up_down_within_same_parent(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """同级上下移动：把最后一章移到最前，知识树顺序随之变化。"""

    teacher_id, token = await _create_teacher(db_session)
    nodes = await _seed(db_session, teacher_id)
    client.headers.update({"Authorization": f"Bearer {token}"})

    response = await client.post(
        f"/api/knowledge/knowledge-points/{nodes['chapter_b']}/reorder",
        json={
            "parent_id": str(nodes["course"]),
            "ordered_ids": [str(nodes["chapter_b"]), str(nodes["chapter_a"])],
        },
    )
    assert response.status_code == 200, response.text

    children = await _tree_children(client, nodes["course"])
    assert children["计算机网络基础"] == ["第二章 物理层", "第一章 概述"]


@pytest.mark.asyncio
async def test_reorder_rejects_moving_into_own_descendant(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    teacher_id, token = await _create_teacher(db_session)
    nodes = await _seed(db_session, teacher_id)
    client.headers.update({"Authorization": f"Bearer {token}"})

    response = await client.post(
        f"/api/knowledge/knowledge-points/{nodes['chapter_a']}/reorder",
        json={"parent_id": str(nodes["leaf"]), "ordered_ids": [str(nodes["chapter_a"])]},
    )
    assert response.status_code == 400
    assert "下级知识点" in response.json()["detail"]


@pytest.mark.asyncio
async def test_reorder_rejects_moving_into_self(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    teacher_id, token = await _create_teacher(db_session)
    nodes = await _seed(db_session, teacher_id)
    client.headers.update({"Authorization": f"Bearer {token}"})

    response = await client.post(
        f"/api/knowledge/knowledge-points/{nodes['chapter_a']}/reorder",
        json={"parent_id": str(nodes["chapter_a"]), "ordered_ids": [str(nodes["chapter_a"])]},
    )
    assert response.status_code == 400
    assert "自身" in response.json()["detail"]


@pytest.mark.asyncio
async def test_reorder_requires_target_in_ordered_ids(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    teacher_id, token = await _create_teacher(db_session)
    nodes = await _seed(db_session, teacher_id)
    client.headers.update({"Authorization": f"Bearer {token}"})

    response = await client.post(
        f"/api/knowledge/knowledge-points/{nodes['chapter_b']}/reorder",
        json={"parent_id": str(nodes["course"]), "ordered_ids": [str(nodes["chapter_a"])]},
    )
    assert response.status_code == 400
    assert "必须包含" in response.json()["detail"]


@pytest.mark.asyncio
async def test_reorder_rejects_foreign_node_in_ordered_ids(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """排序列表里混进了别的父节点下的知识点时直接拒绝，且不改动 parent_id。"""

    teacher_id, token = await _create_teacher(db_session)
    nodes = await _seed(db_session, teacher_id)
    client.headers.update({"Authorization": f"Bearer {token}"})

    response = await client.post(
        f"/api/knowledge/knowledge-points/{nodes['leaf']}/reorder",
        json={
            "parent_id": str(nodes["chapter_b"]),
            "ordered_ids": [str(nodes["leaf"]), str(nodes["chapter_a"])],
        },
    )
    assert response.status_code == 400
    assert "不属于该父节点" in response.json()["detail"]

    # 校验发生在落库之前：leaf 仍然挂在第一章下。
    children = await _tree_children(client, nodes["course"])
    assert children["第一章 概述"] == ["1.1 互联网概述"]
    assert children["第二章 物理层"] == []


@pytest.mark.asyncio
async def test_apply_sibling_order_appends_unlisted_siblings_last(
    db_session: AsyncSession,
) -> None:
    """前端拿着旧树来重排时，别人刚新建的同级节点不能丢排序位。"""

    owner = uuid.uuid4()
    parent = KnowledgePoint(name="课程", owner_id=owner, visibility=VisibilityScope.PRIVATE)
    db_session.add(parent)
    await db_session.flush()

    first = KnowledgePoint(name="A", parent_id=parent.id, owner_id=owner, sort_order=0)
    second = KnowledgePoint(name="B", parent_id=parent.id, owner_id=owner, sort_order=1)
    third = KnowledgePoint(name="C", parent_id=parent.id, owner_id=owner, sort_order=2)
    db_session.add_all([first, second, third])
    await db_session.commit()

    # 只报了 A 和 C，B 没出现在列表里 → 排到最后。
    ordered = await service.apply_sibling_order(db_session, parent.id, [third.id, first.id])
    assert [node.name for node in ordered] == ["C", "A", "B"]

    again = await service.list_child_knowledge_points(db_session, parent.id)
    assert [node.name for node in again] == ["C", "A", "B"]
    assert [node.sort_order for node in again] == [0, 1, 2]


@pytest.mark.asyncio
async def test_bulk_import_appends_after_reordered_siblings(
    db_session: AsyncSession,
) -> None:
    """目录批量导入（从书名 / 拍照 / Excel）也走「追加到末尾」。

    这条链路用的是 questions.service.create_knowledge_point，
    如果漏掉 sort_order，新导入的章节会插到手动排过序的同级最前面。
    """

    from app.knowledge_extract import service as extract_service
    from app.knowledge_extract.schemas import BulkCreateKnowledgePointItem

    owner = uuid.uuid4()
    course = KnowledgePoint(name="课程", owner_id=owner, visibility=VisibilityScope.PRIVATE)
    db_session.add(course)
    await db_session.flush()

    # 模拟「已被手动重排过」的同级：sort_order 不是从 0 连续开始。
    first = KnowledgePoint(name="旧章一", parent_id=course.id, owner_id=owner, sort_order=5)
    second = KnowledgePoint(name="旧章二", parent_id=course.id, owner_id=owner, sort_order=6)
    db_session.add_all([first, second])
    await db_session.commit()

    created, skipped = await extract_service.bulk_create_knowledge_points(
        db_session,
        owner,
        course_kp_id=course.id,
        items=[BulkCreateKnowledgePointItem(name="导入章一"), BulkCreateKnowledgePointItem(name="导入章二")],
    )
    assert skipped == []
    assert [node.name for node in created] == ["导入章一", "导入章二"]

    children = await service.list_child_knowledge_points(db_session, course.id)
    assert [node.name for node in children] == ["旧章一", "旧章二", "导入章一", "导入章二"]
    assert [node.sort_order for node in children] == [5, 6, 7, 8]


@pytest.mark.asyncio
async def test_create_knowledge_point_appends_after_renumbered_siblings(
    db_session: AsyncSession,
) -> None:
    """重排过的同级下新建知识点，要排到末尾而不是插到最前面。"""

    owner = uuid.uuid4()
    parent = KnowledgePoint(name="课程", owner_id=owner, visibility=VisibilityScope.PRIVATE)
    db_session.add(parent)
    await db_session.flush()

    existing = KnowledgePoint(name="旧章", parent_id=parent.id, owner_id=owner, sort_order=5)
    db_session.add(existing)
    await db_session.commit()

    created = await service.create_knowledge_point(
        db_session,
        KnowledgePointCreate(direction_id=uuid.uuid4(), parent_id=parent.id, name="新章"),
        owner,
    )
    assert created.sort_order == 6

    children = await service.list_child_knowledge_points(db_session, parent.id)
    assert [node.name for node in children] == ["旧章", "新章"]
