import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.models import User
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning.models import KnowledgePoint
from app.questions.models import Question, QuestionBank, QuestionType, Tag, TagType
from app.rbac.models import Organization, Role


async def _create_teacher_org(db_session):
    org = Organization(name="Question Visibility School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, teacher_role])
    await db_session.flush()
    return org


async def _create_teacher(db_session, org_id, *, username: str, email: str, full_name: str):
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=email,
            password="teacherpass123",
            full_name=full_name,
            role_name="teacher",
            org_id=org_id,
        ),
    )


@pytest.mark.asyncio
async def test_list_questions_can_filter_by_knowledge_point(admin_client, db_session) -> None:
    admin_user = (await db_session.execute(select(User).where(User.username == "admin"))).scalar_one()
    knowledge_point = KnowledgePoint(
        name="事务隔离级别",
        description="事务基础",
        owner_id=admin_user.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(knowledge_point)
    await db_session.flush()

    matched = Question(
      type=QuestionType.SHORT_ANSWER,
      title="事务隔离",
      content={"text": "解释可重复读和读已提交的区别"},
      options=None,
      answer={"points": ["不可重复读", "幻读"]},
      analysis="需要说明隔离级别差异",
      difficulty=3,
      score=10,
      created_by=admin_user.id,
      owner_id=admin_user.id,
    )
    matched.knowledge_points = [knowledge_point]

    unmatched = Question(
      type=QuestionType.SHORT_ANSWER,
      title="无关联题目",
      content={"text": "解释缓存雪崩"},
      options=None,
      answer={"points": ["过期时间", "降级"]},
      analysis=None,
      difficulty=3,
      score=10,
      created_by=admin_user.id,
      owner_id=admin_user.id,
    )

    db_session.add_all([matched, unmatched])
    await db_session.commit()

    response = await admin_client.get(f"/api/questions?knowledge_point_id={knowledge_point.id}")

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload] == [str(matched.id)]

    refreshed = await db_session.execute(select(Question).where(Question.id == matched.id))
    assert refreshed.scalar_one().title == "事务隔离"


@pytest.mark.asyncio
async def test_list_questions_filter_by_parent_knowledge_point_includes_descendants(admin_client, db_session) -> None:
    admin_user = (await db_session.execute(select(User).where(User.username == "admin"))).scalar_one()
    parent_kp = KnowledgePoint(
        name="计算机网络",
        description="根知识点",
        owner_id=admin_user.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(parent_kp)
    await db_session.flush()

    child_kp = KnowledgePoint(
        name="应用层",
        parent_id=parent_kp.id,
        description="子知识点",
        owner_id=admin_user.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(child_kp)
    await db_session.flush()

    grandchild_kp = KnowledgePoint(
        name="DNS 协议",
        parent_id=child_kp.id,
        description="孙知识点",
        owner_id=admin_user.id,
        visibility=VisibilityScope.PRIVATE,
    )
    other_kp = KnowledgePoint(
        name="物理层",
        description="无关联知识点",
        owner_id=admin_user.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([grandchild_kp, other_kp])
    await db_session.flush()

    q_parent = Question(
        type=QuestionType.SHORT_ANSWER,
        title="网络总体架构",
        content={"text": "概述网络分层架构"},
        answer={"text": "五层或七层架构"},
        difficulty=2,
        score=5,
        created_by=admin_user.id,
        owner_id=admin_user.id,
    )
    q_parent.knowledge_points = [parent_kp]

    q_child = Question(
        type=QuestionType.CHOICE,
        title="应用层协议",
        content={"text": "下列哪个是应用层协议？"},
        options={"A": "HTTP", "B": "IP"},
        answer={"correct": "A"},
        difficulty=2,
        score=2,
        created_by=admin_user.id,
        owner_id=admin_user.id,
    )
    q_child.knowledge_points = [child_kp]

    q_grandchild = Question(
        type=QuestionType.CHOICE,
        title="DNS 默认端口",
        content={"text": "DNS 默认使用的端口号是？"},
        options={"A": "53", "B": "80"},
        answer={"correct": "A"},
        difficulty=1,
        score=2,
        created_by=admin_user.id,
        owner_id=admin_user.id,
    )
    q_grandchild.knowledge_points = [grandchild_kp]

    q_other = Question(
        type=QuestionType.SHORT_ANSWER,
        title="双绞线标准",
        content={"text": "简述 5 类双绞线标准"},
        answer={"text": "支持百兆以太网"},
        difficulty=3,
        score=5,
        created_by=admin_user.id,
        owner_id=admin_user.id,
    )
    q_other.knowledge_points = [other_kp]

    db_session.add_all([q_parent, q_child, q_grandchild, q_other])
    await db_session.commit()

    # 过滤父知识点：应同时包含父、子、孙知识点的题目，但不包含其它知识点的题目
    res_parent = await admin_client.get(f"/api/questions?knowledge_point_id={parent_kp.id}")
    assert res_parent.status_code == 200
    parent_ids = {item["id"] for item in res_parent.json()}
    assert parent_ids == {str(q_parent.id), str(q_child.id), str(q_grandchild.id)}
    assert res_parent.headers["X-Total-Count"] == "3"

    # 过滤子知识点：应包含子和孙，但不包含父或其它
    res_child = await admin_client.get(f"/api/questions?knowledge_point_id={child_kp.id}")
    assert res_child.status_code == 200
    child_ids = {item["id"] for item in res_child.json()}
    assert child_ids == {str(q_child.id), str(q_grandchild.id)}
    assert res_child.headers["X-Total-Count"] == "2"


@pytest.mark.asyncio
async def test_teacher_only_sees_owned_and_platform_bank_questions(client: AsyncClient, db_session) -> None:
    org = await _create_teacher_org(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-question-owner",
        email="teacher-question-owner@example.com",
        full_name="Teacher Question Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-question-other",
        email="teacher-question-other@example.com",
        full_name="Teacher Question Other",
    )

    own_bank = QuestionBank(
        name="Own Bank",
        description=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    shared_bank = QuestionBank(
        name="Shared Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    hidden_bank = QuestionBank(
        name="Hidden Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([own_bank, shared_bank, hidden_bank])
    await db_session.flush()

    visible_owned = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Own Banked Question",
        content={"text": "Describe normalization"},
        options=None,
        answer={"points": ["1NF", "2NF"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
        question_bank_id=own_bank.id,
    )
    visible_unbanked = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Own Unbanked Question",
        content={"text": "Describe indexing"},
        options=None,
        answer={"points": ["b-tree"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
        question_bank_id=None,
    )
    visible_shared = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Shared Bank Question",
        content={"text": "Describe joins"},
        options=None,
        answer={"points": ["inner", "left"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=other_teacher.id,
        owner_id=other_teacher.id,
        question_bank_id=shared_bank.id,
    )
    hidden_banked = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Hidden Bank Question",
        content={"text": "Describe ACID"},
        options=None,
        answer={"points": ["atomicity"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=other_teacher.id,
        owner_id=other_teacher.id,
        question_bank_id=hidden_bank.id,
    )
    hidden_unbanked = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Hidden Unbanked Question",
        content={"text": "Describe sharding"},
        options=None,
        answer={"points": ["partition"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=other_teacher.id,
        owner_id=other_teacher.id,
        question_bank_id=None,
    )
    db_session.add_all(
        [visible_owned, visible_unbanked, visible_shared, hidden_banked, hidden_unbanked]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/questions?_start=0&_end=10&_sort=title&_order=ASC")

    assert response.status_code == 200
    payload = response.json()
    assert [item["title"] for item in payload] == [
        "Own Banked Question",
        "Own Unbanked Question",
        "Shared Bank Question",
    ]
    assert {item["owner_id"] for item in payload} == {str(teacher.id), str(other_teacher.id)}


@pytest.mark.asyncio
async def test_unbanked_question_filter_keeps_teacher_scope(client: AsyncClient, db_session) -> None:
    org = await _create_teacher_org(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-question-none-owner",
        email="teacher-question-none-owner@example.com",
        full_name="Teacher None Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-question-none-other",
        email="teacher-question-none-other@example.com",
        full_name="Teacher None Other",
    )

    own_unbanked = Question(
        type=QuestionType.SHORT_ANSWER,
        title="My Unbanked",
        content={"text": "Describe a queue"},
        options=None,
        answer={"points": ["fifo"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
        question_bank_id=None,
    )
    other_unbanked = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Other Unbanked",
        content={"text": "Describe a stack"},
        options=None,
        answer={"points": ["lifo"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=other_teacher.id,
        owner_id=other_teacher.id,
        question_bank_id=None,
    )
    db_session.add_all([own_unbanked, other_unbanked])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/questions?question_bank_id=__none__&_start=0&_end=10")

    assert response.status_code == 200
    payload = response.json()
    assert [item["title"] for item in payload] == ["My Unbanked"]
    assert response.headers["X-Total-Count"] == "1"


@pytest.mark.asyncio
async def test_multi_tag_filter_counts_distinct_questions(admin_client, db_session) -> None:
    admin_user = (await db_session.execute(select(User).where(User.username == "admin"))).scalar_one()
    tag_a = Tag(name="数据库", type=TagType.CUSTOM)
    tag_b = Tag(name="事务", type=TagType.CUSTOM)
    question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Tagged Once In Payload",
        content={"text": "Describe transaction isolation"},
        options=None,
        answer={"points": ["isolation"]},
        analysis=None,
        difficulty=3,
        score=10,
        created_by=admin_user.id,
        owner_id=admin_user.id,
    )
    question.tags = [tag_a, tag_b]
    db_session.add(question)
    await db_session.commit()

    response = await admin_client.get(f"/api/questions?tag_id={tag_a.id},{tag_b.id}&_start=0&_end=10")

    assert response.status_code == 200
    assert [item["title"] for item in response.json()] == ["Tagged Once In Payload"]
    assert response.headers["X-Total-Count"] == "1"


@pytest.mark.asyncio
async def test_list_questions_rejects_malformed_uuid_filters(admin_client) -> None:
    for query in (
        "tag_id=not-a-uuid",
        "knowledge_point_id=not-a-uuid",
        "question_bank_id=not-a-uuid",
    ):
        response = await admin_client.get(f"/api/questions?{query}")

        assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_questions_can_filter_single_and_multi_choice(admin_client, db_session) -> None:
    admin_user = (await db_session.execute(select(User).where(User.username == "admin"))).scalar_one()
    single_choice = Question(
        type=QuestionType.CHOICE,
        title="单选题",
        content={"text": "单选题目", "multi": False},
        options={"A": "选项A", "B": "选项B"},
        answer={"correct": "A"},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=admin_user.id,
        owner_id=admin_user.id,
    )
    multi_choice = Question(
        type=QuestionType.CHOICE,
        title="多选题",
        content={"text": "多选题目", "multi": True},
        options={"A": "选项A", "B": "选项B"},
        answer={"correct": ["A", "B"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=admin_user.id,
        owner_id=admin_user.id,
    )
    db_session.add_all([single_choice, multi_choice])
    await db_session.commit()

    multi_response = await admin_client.get("/api/questions?multi=true")
    multi_ids = {item["id"] for item in multi_response.json()}
    assert str(multi_choice.id) in multi_ids
    assert str(single_choice.id) not in multi_ids

    single_response = await admin_client.get("/api/questions?multi=false")
    single_ids = {item["id"] for item in single_response.json()}
    assert str(single_choice.id) in single_ids
    assert str(multi_choice.id) not in single_ids
