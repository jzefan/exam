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
from app.chaoxing.browser import (
    BrowserManager,
    Session,
    allowed_resource,
    enlarged_list_body,
    manager,
    read_page,
    read_request_allowed,
)
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


def test_semester_picker_lists_each_semester_once():
    # The live course page ships two `select[name="xq"]` elements, so a naive
    # read listed all 17 semesters twice and the picker repeated every option.
    duplicated = """<select name="xq"><option value="0">全部</option>
    <option value="46073" semesternum="2026-2027-1" selected>2026-2027第一学期</option>
    <option value="39913" semesternum="2025-2026-2">2025-2026第二学期</option></select>
    <select name="xq"><option value="0">全部</option>
    <option value="46073" semesternum="2026-2027-1">2026-2027第一学期</option>
    <option value="39913" semesternum="2025-2026-2">2025-2026第二学期</option></select>"""
    items = parsers.semesters(duplicated)
    assert [item["id"] for item in items] == ["0", "46073", "39913"]
    assert [item["title"] for item in items] == ["全部", "2026-2027第一学期", "2025-2026第二学期"]
    assert [item["selected"] for item in items] == [False, True, False]


def test_review_preserves_code_and_unknown_scores():
    review = parsers.review(REVIEW)
    assert review["declared_max_score"] == 100
    q1, q2, q3 = review["questions"]
    assert q1["student_answer"] == "for n in range(3):\n    print(n)"
    assert q1["reference_answer"] == "循环" and q1["max_score"] == 10
    assert q2["objective"] and q2["student_answer"] == "B"
    assert q3["requires_manual_review"] and q3["max_score"] is None and q3["source_score"] is None


# The live paper this mirrors has 30 objective questions with no score field at
# all: the full score exists only inside the type label, e.g. "(单选题, 2.0分)".
REVIEW_LABELLED_SCORE = """<input id="examFullScore" value="100">
<div class="borderBox objective" data1="q1"><div class="mark_name">1. (单选题, 2.0分) 下列哪个是合法标识符</div>
<span class="colorShallow">(单选题, 2.0分)</span><div class="topicStudentAnswer"><span class="colorDeep">考生答案：B</span></div>
<input class="questionScore" value="2"></div>
<div class="borderBox" data1="q2"><div class="mark_name">2. (简答题, 10.0分) 请编写程序，输出偶数</div>
<span class="colorShallow">(简答题, 10.0分)</span>
<div class="topicStudentAnswer"><div class="SubjectStuAnswer"><pre>print(2)</pre>
<div class="answerImg"><img src="https://x.chaoxing.com/icon.png"></div></div></div>
<div class="topicRightAnswer"><div class="objAnswer_right">参考答案：print(2)</div></div>
<input class="questionScore" data-max-score="10" value="8"></div>
<div class="borderBox" data1="q3"><div class="mark_name">3. (简答题, 10.0分) 请画图说明</div>
<span class="colorShallow">(简答题, 10.0分)</span>
<div class="topicStudentAnswer"><img src="https://x.chaoxing.com/answer.png"></div>
<input class="questionScore" data-max-score="10" value=""></div>"""


def test_objective_full_score_comes_from_the_type_label():
    rows = parsers.review(REVIEW_LABELLED_SCORE)["questions"]
    # Without this the 30 objective questions of a real paper had no full score,
    # so their 学习通 marks were dropped and the paper total never matched.
    assert rows[0]["question_type"] == "单选题" and rows[0]["max_score"] == 2
    assert rows[0]["objective"] and rows[0]["source_score"] == 2
    assert rows[0]["requires_manual_review"] is False


def test_subjective_answer_with_text_is_left_to_ai_grading():
    rows = parsers.review(REVIEW_LABELLED_SCORE)["questions"]
    # An image in the answer area used to mark every question "needs a human",
    # which is why no subjective question ever reached the AI grader.
    assert rows[1]["requires_manual_review"] is False
    assert rows[1]["question_type"] == "简答题" and rows[1]["student_answer"] == "print(2)"


def test_answer_that_only_exists_as_a_file_still_needs_a_human():
    rows = parsers.review(REVIEW_LABELLED_SCORE)["questions"]
    assert rows[2]["requires_manual_review"] is True and rows[2]["student_answer"] == ""


# 填空题 carries no `objective` class on every rendered page, and 名词解释 is a
# written answer the provider files under its own label. The label decides.
REVIEW_OBJECTIVE_LABELS = """<input id="examFullScore" value="24">
<div class="borderBox" data1="q1"><div class="mark_name">1. (填空题, 4.0分) 补全语句</div>
<span class="colorShallow">(填空题, 4.0分)</span><div class="topicStudentAnswer"><span class="colorDeep">考生答案：print</span></div>
<input class="questionScore" value="4"></div>
<div class="borderBox" data1="q2"><div class="mark_name">2. (名词解释, 20.0分) 解释变量作用域</div>
<span class="colorShallow">(名词解释, 20.0分)</span>
<div class="topicStudentAnswer"><span class="colorDeep">考生答案：局部变量只在函数内可见</span></div>
<div class="topicRightAnswer"><div class="objAnswer_right">参考答案：作用域即变量的可见范围</div></div>
<input class="questionScore" data-max-score="20" value="15"></div>"""


def test_question_type_label_decides_objective_not_the_provider_class():
    rows = parsers.review(REVIEW_OBJECTIVE_LABELS)["questions"]
    # 填空题 is marked by the provider itself, so it keeps that mark even though the
    # container carries no `objective` class: sending it to a model would both
    # re-grade a decided answer and lose the 学习通 score.
    assert rows[0]["question_type"] == "填空题"
    assert rows[0]["objective"] is True and rows[0]["source_score"] == 4
    # 名词解释 is written work: the AI queue is exactly where it belongs.
    assert rows[1]["question_type"] == "名词解释" and rows[1]["objective"] is False


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


HEADER_TABLE = """<table class="layui-table"><thead><tr>
<th data-field="createUserName">姓名</th><th data-field="loginName">学号/工号</th>
<th data-field="option">操作</th></tr></thead><tbody></tbody></table>"""


def test_layout_rows_are_never_read_as_candidates():
    # A live roster page whose rows are still empty once produced exactly one
    # fake candidate: name "姓名", student number "学号/工号".
    assert parsers.candidates(HEADER_TABLE, "https://mooc2-ans.chaoxing.com") == []
    rows = parsers.candidates(
        HEADER_TABLE + """<table><tbody><tr data-index="0">
        <td data-field="createUserName" data-content="张三">张三</td>
        <td data-field="loginName" data-content="20260001">20260001</td></tr></tbody></table>""",
        "https://mooc2-ans.chaoxing.com",
    )
    assert [(row["name"], row["student_no"]) for row in rows] == [("张三", "20260001")]


def rendered_roster(rows: list[tuple[str, int, str, str, str]]) -> str:
    """A roster as the provider's own layui table renders it.

    The served HTML has an empty <tbody>; rows arrive from the page's XHR POST.
    Each row then exists three times with the same data-index (main table plus
    the left and right fixed-column tables).
    """
    header = (
        '<div class="layui-table-header"><table class="layui-table"><thead><tr>'
        '<th data-field="0" class="layui-table-col-special"><div class="layui-table-cell">'
        '<input type="checkbox" name="layTableCheckbox"></div></th>'
        '<th data-field="createUserName" title="姓名"><div class="layui-table-cell"><span>姓名</span></div></th>'
        '<th data-field="loginName" title="学号/工号"><div class="layui-table-cell"><span>学号/工号</span></div></th>'
        '<th data-field="option" title="操作"><div class="layui-table-cell"><span>操作</span></div></th>'
        "</tr></thead><tbody></tbody></table></div>"
    )

    def action(relation: str, answer_id: str) -> str:
        return (
            '<td data-field="option"><div class="layui-table-cell"><p onclick="toMarkPaper('
            f"'/mooc2-ans/exam/test/markpaper?courseid=12&amp;clazzid=139502558&amp;id={relation}"
            f"&amp;answerId={answer_id}&amp;paperId=78')\">批阅</p></div></td>"
        )

    def cell(field: str, value: str, extra: str = "") -> str:
        return f'<td data-field="{field}"{extra}><div class="layui-table-cell"><span>{value}</span></div></td>'

    def main_row(relation: str, index: int, name: str, student_no: str, answer_id: str) -> str:
        return (
            f'<tr data-index="{index}">'
            + cell("id", answer_id, ' class="layui-hide"')
            + cell("createUserName", name, f' data-content="{name}"')
            + cell("loginName", student_no, f' data-content="{student_no}"')
            + f'<td data-field="answerScore"><div class="layui-table-cell">'
            f'<input class="scoreInput" answerid="{answer_id}" value="86"></div></td>'
            + action(relation, answer_id)
            + "</tr>"
        )

    def fixed_row(relation: str, index: int, name: str, student_no: str, answer_id: str) -> str:
        return (
            f'<tr data-index="{index}">'
            + cell("createUserName", name, f' data-content="{name}"')
            + cell("loginName", student_no, f' data-content="{student_no}"')
            + action(relation, answer_id)
            + "</tr>"
        )

    body = "".join(main_row(*row) for row in rows)
    fixed = "".join(fixed_row(*row) for row in rows)
    return (
        header
        + f'<div class="layui-table-body"><table class="layui-table"><tbody>{body}</tbody></table></div>'
        + f'<div class="layui-table-fixed layui-table-fixed-l"><div class="layui-table-body">'
        f'<table class="layui-table"><tbody>{fixed}</tbody></table></div></div>'
        + f'<div class="layui-table-fixed layui-table-fixed-r"><div class="layui-table-body">'
        f'<table class="layui-table"><tbody>{fixed}</tbody></table></div></div>'
    )


def test_rendered_roster_keeps_every_student_distinct():
    # The list URL repeats one relation id for every student, so taking identity
    # from the URL would collapse this roster into a single candidate.
    html = rendered_roster(
        [
            ("9498278", 0, "张三", "20260001", "12200901"),
            ("9498278", 1, "李四", "20260002", "12200902"),
        ]
    )
    rows = parsers.candidates(html, "https://mooc2-ans.chaoxing.com")
    assert [(row["name"], row["student_no"], row["source_id"]) for row in rows] == [
        ("张三", "20260001", "12200901"),
        ("李四", "20260002", "12200902"),
    ]
    assert [row["status"] for row in rows] == ["submitted", "submitted"]
    assert all(row["_url"] for row in rows)
    assert [row["source_score"] for row in rows] == [86, 86]


def test_only_named_list_posts_are_sent_by_the_reader():
    new = "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/markresult-new"
    assert read_request_allowed("GET", new) and read_request_allowed("HEAD", new)
    # The roster table is queried with POST by the provider's own page script.
    assert read_request_allowed("POST", new)
    assert not read_request_allowed("POST", new.replace("-new", ""))
    assert not read_request_allowed("PUT", new)
    assert not read_request_allowed("POST", "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/submitmark")
    # One page would truncate a class, so the page size is raised, not removed.
    assert enlarged_list_body("courseid=12&id=120841740&size=12") == "courseid=12&id=120841740&size=500"
    assert enlarged_list_body("courseid=12") == "courseid=12&size=500"
    assert enlarged_list_body(None) is None


async def test_roster_follows_same_exam_page_with_resolved_class(monkeypatch):
    from app.chaoxing import browser as connector

    entry = "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/marklist?id=56&clazzid=-1"
    resolved = "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/marklist?id=56&clazzid=45"
    other = "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/marklist?id=57&clazzid=-1"
    bodies = {
        entry: f'<iframe src="{resolved}"></iframe><a href="{other}">另一场考试</a>',
        resolved: "<main>roster</main>",
    }

    async def fake_read_page(session, url):
        return url, bodies[url]

    monkeypatch.setattr(connector, "read_page", fake_read_page)
    pages = await connector.read_samples(make_session(), entry)
    assert [url for url, _ in pages] == [entry, resolved]


async def test_unrecognized_landing_reports_the_site_without_its_query():
    session = make_session()
    page = SimpleNamespace(
        route=AsyncMock(),
        goto=AsyncMock(return_value=SimpleNamespace(status=200)),
        wait_for_load_state=AsyncMock(),
        content=AsyncMock(return_value="<main>workspace</main>"),
        url="https://i.chaoxing.com/base?t=signed-private",
        close=AsyncMock(),
    )
    session.context.new_page = AsyncMock(return_value=page)
    with pytest.raises(HTTPException) as error:
        await read_page(session, "https://mooc2-ans.chaoxing.com/exam/test/marklist?id=1")
    assert error.value.status_code == 502
    assert "i.chaoxing.com/base" in error.value.detail
    assert "signed-private" not in error.value.detail
    page.close.assert_awaited_once()


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

    def route(method: str, url: str, body: str | None = None):
        return SimpleNamespace(
            request=SimpleNamespace(method=method, url=url, post_data=body),
            abort=AsyncMock(),
            fallback=AsyncMock(),
            continue_=AsyncMock(),
        )

    mutation = route("POST", "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/markresult-new-x")
    await guard(mutation)
    mutation.abort.assert_awaited_once()

    foreign = route("POST", "https://tracker.example.com/mooc2-ans/exam/test/markresult-new")
    await guard(foreign)
    foreign.abort.assert_awaited_once()

    page_read = route("GET", "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/marklist?id=1")
    await guard(page_read)
    page_read.fallback.assert_awaited_once()

    roster = route(
        "POST",
        "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/markresult-new",
        "courseid=12&id=120841740&size=12",
    )
    await guard(roster)
    roster.abort.assert_not_awaited()
    assert roster.continue_.call_args.kwargs["post_data"] == "courseid=12&id=120841740&size=500"


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
