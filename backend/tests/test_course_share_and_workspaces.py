"""Public course contract across anonymous visitors, publishers and two teachers."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker
from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.database import get_db
from app.job_models.models import LearningResource
from app.learning.models import Direction, KnowledgePoint, Major
from app.main import app
from app.papers.models import Paper, PaperQuestion
from app.questions.models import Question, QuestionBank, QuestionType
from app.questions.service import root_knowledge_question_bank_name
from app.rbac.seed import seed_roles
from app.rbac.models import Organization
from app.teacher_courses.models import CourseUserWorkspace


@pytest.fixture
async def client(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def env(db_session):
    await seed_roles(db_session)
    db_session.add(Organization(name="Course School", type="school", is_active=True))
    await db_session.flush()
    result = {}
    for name, role in [
        ("author", "teacher"),
        ("b", "teacher"),
        ("c", "teacher"),
        ("admin", "platform_admin"),
        ("school", "school_admin"),
        ("student", "student"),
    ]:
        user = await create_user(
            db_session,
            UserCreate(
                username=f"course_{name}",
                email=f"{name}@example.com",
                password="password123",
                full_name=name,
                role_name=role,
            ),
        )
        result[name] = {"id": user.id, "headers": {"Authorization": f"Bearer {create_access_token(user.id, role)}"}}
    major = Major(name="Computer Science")
    db_session.add(major)
    await db_session.flush()
    direction = Direction(name="Python", major_id=major.id)
    db_session.add(direction)
    await db_session.flush()
    owner = result["author"]["id"]
    course = KnowledgePoint(name="Python Course", direction_id=direction.id, owner_id=owner)
    db_session.add(course)
    await db_session.flush()
    kp = KnowledgePoint(name="Variables", parent_id=course.id, owner_id=owner)
    bank = QuestionBank(name=root_knowledge_question_bank_name(course.name), owner_id=owner)
    db_session.add_all([kp, bank])
    await db_session.flush()
    q = Question(
        type=QuestionType.CHOICE,
        title="Base question",
        content={"stem": "1+1?"},
        options={"A": "2", "B": "3"},
        answer={"correct": "A"},
        difficulty=1,
        score=5,
        owner_id=owner,
        created_by=owner,
        question_bank_id=bank.id,
    )
    q.knowledge_points.append(kp)
    material = LearningResource(
        node_id=kp.id,
        node_type="kp",
        resource_type="link",
        title="Base material",
        url="https://example.com/course",
        uploaded_by=owner,
    )
    paper = Paper(
        title="Base paper", root_knowledge_point_id=course.id, is_reusable=True, owner_id=owner, created_by=owner
    )
    db_session.add_all([q, material, paper])
    await db_session.flush()
    db_session.add(PaperQuestion(paper_id=paper.id, question_id=q.id, order=0))
    await db_session.commit()
    return {**result, "course": str(course.id), "kp": str(kp.id), "question": str(q.id), "paper": str(paper.id)}


async def publish(client, env):
    r = await client.post(f"/api/teacher/courses/{env['course']}/publish-link", headers=env["admin"]["headers"])
    assert r.status_code == 200, r.text
    return r.json()["share_code"]


async def enter(client, env, code):
    r = await client.post(f"/api/public/course-share/{code}/enter", headers=env["b"]["headers"], json={})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"] is None
    assert r.json()["user"]["id"] == str(env["b"]["id"])
    assert r.json()["user"]["primary_org"]["role_name"] == "teacher"


async def test_only_platform_admin_publishes(client, env):
    path = f"/api/teacher/courses/{env['course']}/publish-link"
    for who in ("author", "b", "school"):
        assert (await client.post(path, headers=env[who]["headers"])).status_code == 403
    code = await publish(client, env)
    for who in ("author", "b", "school"):
        assert (await client.delete(path, headers=env[who]["headers"])).status_code == 403
    assert (await client.delete(path, headers=env["admin"]["headers"])).status_code == 204
    for suffix in ("", "/content"):
        assert (await client.get(f"/api/public/course-share/{code}{suffix}")).status_code == 404


async def test_public_preview_is_read_only(client, env, db_session):
    code = await publish(client, env)
    count = await db_session.scalar(select(func.count(User.id)))
    r = await client.get(f"/api/public/course-share/{code}/content")
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["knowledge_points"]) == 2
    assert data["questions"][0]["id"] == env["question"]
    assert data["papers"][0]["questions"][0]["question_id"] == env["question"]
    assert data["materials"][0]["title"] == "Base material"
    assert (await client.post(f"/api/public/course-share/{code}/enter", json={})).status_code in (401, 403)
    assert (
        await client.post(f"/api/public/course-share/{code}/enter", json={}, headers=env["student"]["headers"])
    ).status_code == 403
    assert await db_session.scalar(select(func.count(User.id))) == count
    assert await db_session.scalar(select(func.count(CourseUserWorkspace.id))) == 0


async def test_teacher_student_semester_exam_flow(client, env):
    cid = env["course"]
    b = env["b"]["headers"]
    c = env["c"]["headers"]
    await enter(client, env, await publish(client, env))
    cls = await client.post("/api/rbac/students/classes", headers=b, json={"name": "B class"})
    assert cls.status_code == 201, cls.text
    student = await client.post(
        "/api/rbac/students",
        headers=b,
        json={"full_name": "B student", "student_id": "share-b-student", "class_id": cls.json()["id"]},
    )
    assert student.status_code == 201, student.text
    sem = await client.post(
        f"/api/teacher/courses/{cid}/semesters", headers=b, json={"name": "Spring", "class_ids": [cls.json()["id"]]}
    )
    assert sem.status_code == 201, sem.text
    assert (await client.get("/api/rbac/students", headers=c)).json() == []
    assert (await client.get(f"/api/teacher/courses/{cid}/semesters", headers=c)).json() == []
    assert (
        await client.patch(
            f"/api/teacher/courses/{cid}/semesters/{sem.json()['id']}/classes", headers=c, json={"class_ids": []}
        )
    ).status_code == 403
    assert (
        await client.post(
            f"/api/teacher/courses/{cid}/semesters", headers=c, json={"name": "No", "class_ids": [cls.json()["id"]]}
        )
    ).status_code == 404
    grade = await client.get(f"/api/teacher/courses/{cid}/grade-summary", headers=b)
    assert grade.status_code == 200, grade.text
    for category, suffix in [("exam", "exams"), ("practice", "assignments")]:
        exam = await client.post(
            "/api/exams",
            headers=b,
            json={
                "title": category,
                "category": category,
                "status": "ongoing",
                "course_kp_id": cid,
                "course_semester_id": sem.json()["id"],
                "question_ids": [env["question"]],
                "student_ids": [student.json()["id"]],
            },
        )
        assert exam.status_code == 201, exam.text
        assert (await client.post(f"/api/exams/{exam.json()['id']}/public-link", headers=b)).status_code == 201
        assert (await client.get(f"/api/teacher/courses/{cid}/{suffix}", headers=c)).json() == []
    assert any(x["id"] == cid for x in (await client.get("/api/teacher/courses", headers=b)).json())


async def test_shared_references_and_private_question_paper(client, env):
    cid = env["course"]
    b = env["b"]["headers"]
    c = env["c"]["headers"]
    assert (await client.get(f"/api/papers/{env['paper']}", headers=c)).status_code == 404
    code = await publish(client, env)
    await enter(client, env, code)
    r = await client.get(f"/api/questions/{env['question']}", headers=b)
    assert r.status_code == 200, r.text
    q = await client.post(
        "/api/questions",
        headers=b,
        json={
            "type": "choice",
            "title": "B private",
            "difficulty": 1,
            "content": {"stem": "2+2?"},
            "options": {"A": "4", "B": "5"},
            "answer": {"correct": "A"},
            "knowledge_point_ids": [env["kp"]],
        },
    )
    assert q.status_code == 201, q.text
    qid = q.json()["id"]
    for suffix in ("questions", "questions/paginated"):
        own = (await client.get(f"/api/teacher/courses/{cid}/{suffix}", headers=b)).json()
        other = (await client.get(f"/api/teacher/courses/{cid}/{suffix}", headers=c)).json()
        if isinstance(own, dict):
            own, other = own["items"], other["items"]
        assert any(x["id"] == qid for x in own)
        assert all(x["id"] != qid for x in other)
    assert (await client.get(f"/api/questions/{qid}", headers=c)).status_code == 404
    paper = await client.post(
        "/api/papers",
        headers=b,
        json={
            "title": "B private paper",
            "root_knowledge_point_id": cid,
            "source_paper_id": env["paper"],
            "question_items": [{"question_id": env["question"]}, {"question_id": qid}],
        },
    )
    assert paper.status_code == 201, paper.text
    assert (await client.get(f"/api/papers/{paper.json()['id']}", headers=c)).status_code == 404
    assert (await client.post("/api/exams", headers=c, json={"title": "No", "question_ids": [qid]})).status_code == 404
    preview = (await client.get(f"/api/public/course-share/{code}/content")).json()
    assert all(x["id"] != qid for x in preview["questions"])
    assert all(x["id"] != paper.json()["id"] for x in preview["papers"])
    stats = (await client.get(f"/api/public/course-share/{code}")).json()["stats"]
    assert stats["question_count"] == 1 and stats["paper_count"] == 1


@pytest.mark.parametrize("stale_path", [False, True])
async def test_private_material_all_access_paths(client, env, monkeypatch, tmp_path, db_session, stale_path):
    from app.job_models import router as resources
    from app.uploads import router as uploads

    monkeypatch.setattr(resources, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(uploads, "UPLOAD_DIR", tmp_path)
    cid = env["course"]
    b = env["b"]["headers"]
    c = env["c"]["headers"]
    code = await publish(client, env)
    upload = await client.post(
        f"/api/job-models/models/nodes/{cid}/resources/upload",
        headers=b,
        data={"title": "B private.txt", "node_type": "kp"},
        files={"file": ("private.txt", b"PRIVATE", "text/plain")},
    )
    assert upload.status_code == 201, upload.text
    r = upload.json()
    rid = r["id"]
    for path in (f"/api/teacher/courses/{cid}/materials", f"/api/job-models/models/nodes/{cid}/resources"):
        assert any(x["id"] == rid for x in (await client.get(path, headers=b)).json())
        assert all(x["id"] != rid for x in (await client.get(path, headers=c)).json())
    assert (await client.get(r["url"], headers=b)).content == b"PRIVATE"
    assert (await client.get(r["url"], headers=c)).status_code == 404
    copied = await client.post(
        f"/api/job-models/models/nodes/{cid}/resources?node_type=kp",
        headers=c,
        json={"title": "A URL is not an access grant", "resource_type": "link", "url": r["url"]},
    )
    assert copied.status_code == 201
    assert (await client.get(r["url"], headers=c)).status_code == 404
    assert (await client.get(r["url"], headers=b)).content == b"PRIVATE"
    assert (await client.get(r["url"])).status_code == 404
    assert (
        await client.patch(f"/api/job-models/models/resources/{rid}", headers=c, json={"title": "stolen"})
    ).status_code == 403
    assert (await client.delete(f"/api/job-models/models/resources/{rid}", headers=c)).status_code == 403
    assert (await client.get(f"/api/job-models/models/resources/{rid}/preview-html", headers=c)).status_code == 404
    assert all(
        x["id"] != rid for x in (await client.get(f"/api/public/course-share/{code}/content")).json()["materials"]
    )
    if stale_path:
        import uuid

        record = await db_session.get(LearningResource, uuid.UUID(rid))
        record.file_path = "/old-deployment/uploads/" + r["url"].rsplit("/", 1)[-1]
        await db_session.commit()
    assert (await client.delete(f"/api/job-models/models/resources/{rid}", headers=b)).status_code == 204
    assert (await client.get(r["url"])).status_code == 404
    if stale_path:
        assert (tmp_path / r["url"].rsplit("/", 1)[-1]).exists()


async def test_registered_teacher_can_enter_and_manage_students(client, env):
    code = await publish(client, env)
    account = {
        "username": "new_course_teacher",
        "password": "password123",
        "full_name": "新教师",
        "role_name": "teacher",
    }
    registered = await client.post("/api/auth/register", json=account)
    assert registered.status_code == 201, registered.text
    assert registered.json()["primary_org"]["role_name"] == "teacher"
    login = await client.post(
        "/api/auth/login",
        json={"username": account["username"], "password": account["password"], "role_name": "teacher"},
    )
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await client.post(f"/api/public/course-share/{code}/enter", json={}, headers=headers)).status_code == 200
    assert (
        await client.post("/api/rbac/students/classes", json={"name": "新教师班级"}, headers=headers)
    ).status_code == 201


async def test_imported_questions_stay_in_teachers_course(client, env):
    code = await publish(client, env)
    await enter(client, env, code)
    result = await client.post(
        "/api/questions/import/bulk-create-job",
        headers=env["b"]["headers"],
        json={
            "root_knowledge_point_id": env["course"],
            "skip_knowledge_matching": True,
            "questions": [
                {
                    "type": "short_answer",
                    "title": "Private imported question",
                    "content": {"text": "Explain a variable"},
                    "answer": {"points": ["Named storage"]},
                    "difficulty": 1,
                    "score": 5,
                }
            ],
        },
    )
    assert result.status_code == 201, result.text
    own = (await client.get(f"/api/teacher/courses/{env['course']}/questions", headers=env["b"]["headers"])).json()
    other = (await client.get(f"/api/teacher/courses/{env['course']}/questions", headers=env["c"]["headers"])).json()
    assert any(q["title"] == "Private imported question" for q in own)
    assert all(q["title"] != "Private imported question" for q in other)


async def test_knowledge_retrieval_does_not_expose_private_material(client, env, db_session, monkeypatch):
    import uuid
    from app.course_kb import service as kb_service
    from app.course_kb.models import CourseMaterialChunk

    await publish(client, env)
    resource = await client.post(
        f"/api/job-models/models/nodes/{env['course']}/resources?node_type=kp",
        headers=env["b"]["headers"],
        json={"title": "Private knowledge", "resource_type": "link", "url": "https://example.com/private"},
    )
    assert resource.status_code == 201
    db_session.add(
        CourseMaterialChunk(
            resource_id=uuid.UUID(resource.json()["id"]),
            course_kp_id=uuid.UUID(env["course"]),
            node_id=uuid.UUID(env["course"]),
            ordinal=0,
            heading_path=["Private"],
            chunk_type="text",
            text="Teacher B private knowledge",
            token_count=6,
            embedding=[1.0, 0.0],
        )
    )
    await db_session.commit()

    async def fake_embed(texts):
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(kb_service, "embed_texts", fake_embed)
    for who, expected in [("b", 1), ("c", 0)]:
        stats = await client.get(f"/api/teacher/courses/{env['course']}/kb/stats", headers=env[who]["headers"])
        assert stats.status_code == 200, stats.text
        assert stats.json()["chunk_count"] == expected
        hits = await client.get(
            f"/api/teacher/courses/{env['course']}/kb/search?q=knowledge", headers=env[who]["headers"]
        )
        assert hits.status_code == 200, hits.text
        assert len(hits.json()) == expected
