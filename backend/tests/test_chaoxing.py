"""Offline connector contracts; authenticated provider compatibility is a separate live gate."""

import time
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

pytest.importorskip("bs4")

from app.auth.dependencies import get_current_user
from app.chaoxing import parsers
from app.chaoxing.browser import BrowserManager, Session, allowed_resource, manager, read_page
from app.chaoxing.router import LoginAction, router
from app.config import settings
from app.database import get_db

COURSE = (
    '<a href="/fyportal/courselist/entercoursenewfy?courseId=12&amp;cpi=34&amp;ckenc=secret"><h3>Python 教务课</h3></a>'
)
EXAM = """<li><h2 class="list_li_tit">期中考试</h2><div title="不应当作为标题">某班</div>
<p>9 已交 21 未交</p><a href="/mooc2-ans/exam/test/marklist?id=56&amp;paperId=78">批阅</a></li>"""
ROSTER = """<table><tr data-index="0"><td data-field="createUserName">张三</td>
<td data-field="loginName">20260001</td></tr></table>
<table><tr data-index="0"><td data-field="answerScore"><input value="6"></td>
<td><button onclick="toMarkPaper('/mooc2-ans/exam/test/markpaper?id=99')">批阅</button></td></tr></table>
<table><tr data-index="1"><td data-field="id">100</td><td data-field="createUserName">李四</td>
<td data-field="loginName">20260002</td><td data-field="mark">未提交</td></tr></table>"""
REVIEW = """<input id="examFullScore" value="100"><div class="borderBox" id="index_1" data1="q1" data2="10">
<div class="hiddenTitle">输出偶数</div><input id="typeName_q1" value="编程题">
<div class="topicStudentAnswer"><div class="SubjectStuAnswer"><pre>for n in range(3):
    print(n)</pre></div></div><div class="topicRightAnswer"><div class="objAnswer_right">参考答案：循环</div></div>
<input class="questionScore" value="6"></div>
<div class="borderBox objective" data1="q2" data2="2"><span class="colorShallow">单选题</span>
<div class="topicStudentAnswer"><span class="colorDeep">学生答案: B</span></div><input class="questionScore" value="2"></div>
<div class="borderBox" data1="q3"><div class="topicStudentAnswer"><img src="https://x.chaoxing.com/image"></div>
<input class="questionScore" value=""></div>"""


def test_teacher_course_exam_and_split_roster():
    course = parsers.courses(COURSE)[0]
    assert course["source_id"] == "12::34" and course["title"] == "Python"
    exam = parsers.exams(EXAM, "https://mooc2-ans.chaoxing.com")[0]
    assert (exam["title"], exam["submitted_count"], exam["unsubmitted_count"]) == ("期中考试", 9, 21)
    rows = parsers.candidates(ROSTER, "https://mooc2-ans.chaoxing.com")
    assert len(rows) == 2
    assert rows[0]["name"] == "张三" and rows[0]["student_no"] == "20260001" and rows[0]["source_score"] == 6
    assert rows[1]["status"] == "unsubmitted" and rows[1]["source_score"] is None


def test_review_preserves_code_and_unknown_scores():
    review = parsers.review(REVIEW)
    assert review["declared_max_score"] == 100
    q1, q2, q3 = review["questions"]
    assert q1["student_answer"] == "for n in range(3):\n    print(n)"
    assert q1["reference_answer"] == "循环" and q1["max_score"] == 10
    assert q2["objective"] and q2["student_answer"] == "B"
    assert q3["requires_manual_review"] and q3["max_score"] is None and q3["source_score"] is None


def test_missing_student_number_is_not_replaced_by_relation_id():
    rows = parsers.candidates(
        """<tr data-index="0"><td data-field="createUserName">张三</td>
        <td data-field="id">12345678</td><td data-field="mark">未提交</td></tr>""",
        "https://mooc2-ans.chaoxing.com",
    )
    assert rows[0]["student_no"] == ""
    plain = parsers.candidates(
        """<tr data-student-id="1234"><td class="studentName">李四</td>
        <td>20260002</td><td>未提交</td></tr>""",
        "https://mooc2-ans.chaoxing.com",
    )
    assert plain[0]["student_no"] == "20260002"
    assert parsers.answer_text(parsers.BeautifulSoup("<pre>    print(1)</pre>", "html.parser").pre) == "    print(1)"


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/mooc2-ans/exam/test",
        "https://mooc2-ans.chaoxing.com.evil.com/exam/test",
        "https://mooc2-ans.chaoxing.com@evil.com/exam/test",
        "http://mooc2-ans.chaoxing.com/exam/test",
        "https://mooc2-ans.chaoxing.com:8080/exam/test",
        "https://mooc2-ans.chaoxing.com/exam/test/submitmark",
        "https://mooc2-ans.chaoxing.com/exam/test/../../delete",
        "javascript:alert(1)",
    ],
)
def test_read_url_allowlist(url):
    assert not parsers.read_url(url)


def test_resource_allowlist_and_action_limits():
    assert allowed_resource("https://passport2.chaoxing.com/login")
    assert not allowed_resource("https://chaoxing.com.evil.com/")
    assert not allowed_resource("http://localhost/")
    with pytest.raises(ValueError):
        LoginAction(kind="key", key="ControlOrMeta+L")
    with pytest.raises(ValueError):
        LoginAction(kind="pointer", points=[{"x": -1, "y": 1}])
    with pytest.raises(ValueError):
        LoginAction(kind="text", text="x" * 1001)


def make_session(owner="teacher"):
    return Session(owner=owner, context=SimpleNamespace(close=AsyncMock()), page=SimpleNamespace(close=AsyncMock()))


async def test_session_isolation_expiry_and_secret_redaction(monkeypatch):
    registry = BrowserManager()
    session = make_session()
    registry.sessions[session.id] = session
    with pytest.raises(HTTPException) as error:
        async with registry.hold(session.id, "another-teacher"):
            pytest.fail("cross-user session access")
    assert error.value.status_code == 404
    items = session.remember("course", parsers.courses(COURSE))
    assert "secret" not in str(items) and "_url" not in str(items)
    with pytest.raises(HTTPException) as error:
        async with registry.hold(session.id, "teacher"):
            raise RuntimeError("sensitive-cookie-or-password")
    assert "sensitive" not in error.value.detail
    touched = session.touched
    async with registry.hold(session.id, "teacher", touch=False):
        pass
    assert session.touched == touched
    monkeypatch.setattr(settings, "chaoxing_idle_seconds", 1)
    session.touched = time.monotonic() - 2
    with pytest.raises(HTTPException) as error:
        async with registry.hold(session.id, "teacher"):
            pass
    assert error.value.status_code == 410
    session.context.close.assert_awaited_once()
    assert not registry.sessions and not session.records


async def test_upstream_expiry_closes_context():
    registry = BrowserManager()
    session = make_session()
    registry.sessions[session.id] = session
    with pytest.raises(HTTPException):
        async with registry.hold(session.id, "teacher"):
            raise HTTPException(410, "expired")
    assert session.closed and session.id not in registry.sessions


async def test_reader_rejects_mutation_and_closes_page():
    session = make_session()
    with pytest.raises(HTTPException) as error:
        await read_page(session, "https://mooc2-ans.chaoxing.com/exam/test/submitmark?id=1")
    assert error.value.status_code == 422
    page = SimpleNamespace(
        route=AsyncMock(), goto=AsyncMock(return_value=SimpleNamespace(status=503)), close=AsyncMock()
    )
    session.context.new_page = AsyncMock(return_value=page)
    with pytest.raises(HTTPException):
        await read_page(session, "https://mooc2-ans.chaoxing.com/exam/test/marklist?id=1")
    page.close.assert_awaited_once()
    guard = page.route.call_args.args[1]
    request = SimpleNamespace(request=SimpleNamespace(method="POST"), abort=AsyncMock(), fallback=AsyncMock())
    await guard(request)
    request.abort.assert_awaited_once()
    request.fallback.assert_not_awaited()


async def test_api_role_boundary_and_connected_input_lock(monkeypatch):
    app = FastAPI()
    app.include_router(router, prefix="/api/chaoxing")
    user = SimpleNamespace(id=uuid.uuid4())
    roles = ["student"]
    db = SimpleNamespace(execute=AsyncMock(side_effect=lambda _: SimpleNamespace(all=lambda: [(r,) for r in roles])))
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    session = make_session(str(user.id))
    monkeypatch.setattr(manager, "sessions", {session.id: session})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/chaoxing/capabilities")).status_code == 403
        roles[:] = ["teacher"]
        response = await client.get("/api/chaoxing/session")
        assert response.status_code == 200 and response.json()["id"] == session.id
        assert "no-store" in response.headers["cache-control"]
        session.connected = True
        response = await client.post(
            f"/api/chaoxing/sessions/{session.id}/actions", json={"kind": "key", "key": "Enter"}
        )
        assert response.status_code == 409
        other = make_session("someone-else")
        manager.sessions[other.id] = other
        assert (await client.get(f"/api/chaoxing/sessions/{other.id}/courses")).status_code == 404
        response = await client.delete(f"/api/chaoxing/sessions/{session.id}")
        assert response.status_code == 204 and session.closed


async def test_verify_requires_real_cookie_and_teacher_course(monkeypatch):
    from app.chaoxing import router as routes

    user = SimpleNamespace(id=uuid.uuid4())
    session = make_session(str(user.id))
    session.context.cookies = AsyncMock(return_value=[])
    monkeypatch.setattr(manager, "sessions", {session.id: session})
    with pytest.raises(HTTPException) as error:
        await routes.verify(session.id, user)
    assert error.value.status_code == 409 and not session.connected
    session.context.cookies.return_value = [{"name": "UID", "value": "private"}]
    monkeypatch.setattr(routes, "read_page", AsyncMock(return_value=(parsers.COURSES_URL, "<main>unrecognized</main>")))
    with pytest.raises(HTTPException):
        await routes.verify(session.id, user)
    assert not session.connected
    routes.read_page.return_value = (parsers.COURSES_URL, COURSE)
    result = await routes.verify(session.id, user)
    assert result["session"]["connected"] and result["items"][0]["title"] == "Python"
    assert "private" not in str(result) and "secret" not in str(result)
    session.page.close.assert_awaited_once()


async def test_full_read_chain_does_not_create_students_or_write_scores(monkeypatch):
    from app.chaoxing import router as routes

    user = SimpleNamespace(id=uuid.uuid4())
    session = make_session(str(user.id))
    session.connected = True
    monkeypatch.setattr(manager, "sessions", {session.id: session})
    course = session.remember("course", parsers.courses(COURSE))[0]
    monkeypatch.setattr(
        routes,
        "read_page",
        AsyncMock(
            return_value=(
                "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch?courseid=12&cpi=34&clazzid=45&enc=private",
                "",
            )
        ),
    )
    samples = AsyncMock(
        side_effect=[
            [("https://mooc2-ans.chaoxing.com", EXAM)],
            [("https://mooc2-ans.chaoxing.com", ROSTER)],
            [("https://mooc2-ans.chaoxing.com", REVIEW)],
        ]
    )
    monkeypatch.setattr(routes, "read_samples", samples)
    exams = await routes.list_exams(session.id, course["id"], user)
    roster = await routes.list_candidates(session.id, exams["items"][0]["id"], user)
    result = await routes.get_review(session.id, roster["items"][0]["id"], user)
    assert len(result["questions"]) == 3 and not result["complete"]
    assert roster["expected_submitted"] == 9
    assert "private" not in str((exams, roster, result))
    assert "clazzid=-1" in samples.call_args_list[0].args[1]
    assert {r.methods and next(iter(r.methods)) for r in router.routes} <= {"GET", "POST", "DELETE"}
    assert not any("score" in r.path or "submit" in r.path for r in router.routes)


async def test_process_guard_and_session_capacity(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "chaoxing_enabled", True)
    monkeypatch.setattr(settings, "chaoxing_lock_path", str(tmp_path / "browser.lock"))
    first, second = BrowserManager(), BrowserManager()
    await first.start()
    try:
        with pytest.raises(RuntimeError, match="single API worker"):
            await second.start()
        monkeypatch.setattr(first, "availability", lambda: {"enabled": True})
        session = make_session()
        first.sessions[session.id] = session
        assert await first.create("teacher") is session
        monkeypatch.setattr(settings, "chaoxing_max_sessions", 1)
        with pytest.raises(HTTPException) as error:
            await first.create("another")
        assert error.value.status_code == 429
    finally:
        await first.shutdown()
    assert session.closed
    await second.start()
    await second.shutdown()
