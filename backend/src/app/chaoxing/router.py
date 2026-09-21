import hashlib

from typing import Annotated, Literal
from urllib.parse import parse_qs, urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import require_roles
from app.auth.models import User
from app.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from .schemas import ImportPaper
from . import service
from .browser import COURSES_URL, HEIGHT, WIDTH, manager, read_page, read_samples


def no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store, private"


router = APIRouter(dependencies=[Depends(no_cache)])
Teacher = Annotated[User, require_roles("teacher", "admin", "platform_admin", "school_admin", "enterprise_admin")]
NOTICE = "当前为读取验证，尚未确认分页完整性；请与学习通核对人数和题目。"


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=0, lt=WIDTH)
    y: float = Field(ge=0, lt=HEIGHT)


class LoginAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["pointer", "key", "text", "scroll"]
    points: list[Point] = Field(default_factory=list, max_length=120)
    text: str = Field(default="", max_length=1000, repr=False)
    key: Literal[
        "",
        "Tab",
        "Shift+Tab",
        "Backspace",
        "Delete",
        "Enter",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "ControlOrMeta+A",
    ] = ""
    delta: int = Field(default=0, ge=-1500, le=1500)


@router.get("/capabilities")
async def capabilities(user: Teacher):
    return manager.availability()


@router.get("/session")
async def current_session(user: Teacher):
    for session in list(manager.sessions.values()):
        if session.owner == str(user.id) and not session.expired():
            return session.status()
    return None


@router.post("/sessions")
async def connect(user: Teacher):
    return (await manager.create(str(user.id))).status()


@router.delete("/sessions/{session_id}", status_code=204)
async def disconnect(session_id: str, user: Teacher):
    async with manager.hold(session_id, str(user.id)) as session:
        await manager.close(session)


@router.get("/sessions/{session_id}/frame")
async def frame(session_id: str, user: Teacher):
    # Frame polling must not keep an abandoned login alive.
    async with manager.hold(session_id, str(user.id), touch=False) as session:
        if session.connected:
            raise HTTPException(409, "已连接，无需继续操作登录窗口")
        data = await session.page.screenshot(type="jpeg", quality=65, timeout=10_000)
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store, private"})


@router.post("/sessions/{session_id}/actions", status_code=204)
async def login_action(session_id: str, action: LoginAction, user: Teacher):
    async with manager.hold(session_id, str(user.id)) as session:
        if session.connected:
            raise HTTPException(409, "登录交互已结束；读取页面不可操作")
        page = session.page
        if action.kind == "pointer":
            if not action.points:
                raise HTTPException(422, "缺少鼠标位置")
            await page.mouse.move(action.points[0].x, action.points[0].y)
            await page.mouse.down()
            try:
                for point in action.points[1:]:
                    await page.mouse.move(point.x, point.y)
                    # Replay a human-drawn drag without generating captcha solutions.
                    import asyncio

                    await asyncio.sleep(0.015)
            finally:
                await page.mouse.up()
        elif action.kind == "text":
            await page.keyboard.insert_text(action.text)
        elif action.kind == "key" and action.key:
            await page.keyboard.press(action.key)
        elif action.kind == "scroll":
            await page.mouse.wheel(0, action.delta)


def require_connected(session):
    if not session.connected:
        raise HTTPException(409, "请先完成学习通登录并验证连接")


async def course_list(session, semester_id: str | None = None, initial_html: str | None = None):
    from . import parsers

    if initial_html is None:
        _, initial_html = await read_page(session, COURSES_URL)
    session.semesters = parsers.semesters(initial_html)
    semester = (
        next((s for s in session.semesters if s["id"] == semester_id), None)
        if semester_id
        else next((s for s in session.semesters if s["selected"]), None)
    )
    if semester_id and semester is None:
        raise HTTPException(422, "该学期不在当前账号的学期列表中")
    html = initial_html
    if semester:
        params = {
            "moreplat": "0",
            "belongSchoolId": "0",
            "sectionId": semester["id"],
            "semesterNum": semester["semester_num"],
            "coursesource": "0",
            "coursename": "",
            "searchSectionId": semester["id"],
            "searchSemesterNum": semester["semester_num"],
            "searchCourserole": "-1",
            "searchkkstatus": "-1",
            "jwcoursegroup": "0",
        }
        _, html = await read_page(session, COURSES_URL + "groupdata?" + urlencode(params))
    records = parsers.courses(html)
    if not records and not any(term in html for term in ("暂无课程", "没有课程", "暂无相关课程")):
        raise HTTPException(502, "未识别到教师课程，可能尚未登录或学习通页面结构已变化")
    return {
        "items": session.remember("course", records),
        "semesters": session.semesters,
        "semester_id": semester["id"] if semester else "",
        "complete": False,
        "notice": NOTICE,
    }


@router.post("/sessions/{session_id}/verify")
async def verify(session_id: str, user: Teacher):
    async with manager.hold(session_id, str(user.id)) as session:
        cookies = await session.context.cookies([COURSES_URL, "https://mooc2-ans.chaoxing.com"])
        if not any(c["name"] in ("UID", "_uid", "uid") and c["value"] for c in cookies):
            raise HTTPException(409, "尚未检测到学习通登录，请在窗口中完成登录后重试")
        result = await course_list(session)
        uid = next(c["value"] for c in cookies if c["name"] in ("UID", "_uid", "uid") and c["value"])
        session.account_key = hashlib.sha256(("chaoxing:" + uid).encode()).hexdigest()
        session.connected = True
        await session.page.close()
        return {"session": session.status(), **result}


@router.get("/sessions/{session_id}/courses")
async def list_courses(session_id: str, user: Teacher, semester: str | None = None):
    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        return await course_list(session, semester)


@router.get("/sessions/{session_id}/courses/{course_id}/exams")
async def list_exams(session_id: str, course_id: str, user: Teacher):
    from . import parsers

    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        course = session.record(course_id, "course")
        final, _ = await read_page(session, course["_url"])
        params = {k.lower(): v[0] for k, v in parse_qs(urlsplit(final).query).items()}
        if not params.get("courseid") or not params.get("cpi") or "mycourse/tch" not in final:
            raise HTTPException(502, "未能解析教师课程入口，暂不支持此类课程")
        params = {k: v for k, v in params.items() if k in ("courseid", "cpi", "enc", "t")}
        params["clazzid"] = "-1"
        url = "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test?" + urlencode(params)
        pages = await read_samples(session, url)
        items = [item for base, html in pages for item in parsers.exams(html, base)]
        if not items and not any(term in html for _, html in pages for term in ("暂无考试", "没有考试")):
            raise HTTPException(502, "未识别到考试列表，请核对教师权限或页面结构")
        unique = {item["source_id"]: item for item in items}
        return {
            "items": session.remember("exam", list(unique.values()), course_id),
            "complete": False,
            "notice": NOTICE,
        }


@router.get("/sessions/{session_id}/exams/{exam_id}/candidates")
async def list_candidates(session_id: str, exam_id: str, user: Teacher):
    from . import parsers

    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        exam = session.record(exam_id, "exam")
        pages = await read_samples(session, exam["_url"])
        items = {item["source_id"]: item for base, html in pages for item in parsers.candidates(html, base)}
        if not items:
            raise HTTPException(502, "未识别到考生记录，可能为动态分页或账号没有答卷权限")
        return {
            "items": session.remember("candidate", list(items.values()), exam_id),
            "expected_submitted": exam.get("submitted_count"),
            "complete": False,
            "notice": NOTICE,
        }


@router.get("/sessions/{session_id}/candidates/{candidate_id}/review")
async def get_review(session_id: str, candidate_id: str, user: Teacher):
    from . import parsers

    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        candidate = session.record(candidate_id, "candidate")
        if not candidate["_url"]:
            raise HTTPException(409, "该考生暂无可读取答卷")
        pages = await read_samples(session, candidate["_url"])
        questions = {}
        declared_max_score = None
        for _, html in pages:
            parsed = parsers.review(html)
            if parsed["declared_max_score"] is not None:
                if declared_max_score is not None and declared_max_score != parsed["declared_max_score"]:
                    raise HTTPException(502, "答卷满分不一致，请在学习通核对")
                declared_max_score = parsed["declared_max_score"]
            for question in parsed["questions"]:
                old = questions.get(question["source_id"])
                if old and old != question:
                    raise HTTPException(502, "同一题目出现不一致内容，请在学习通核对答卷")
                questions[question["source_id"]] = question
        if not questions:
            raise HTTPException(502, "未识别到答卷题目，暂不能导入评分")
        review = {"questions": list(questions.values()), "declared_max_score": declared_max_score}
        candidate["_review"] = review
        return {**review, "review_hash": service.fingerprint(review), "complete": False, "notice": NOTICE}


@router.post("/sessions/{session_id}/candidates/{candidate_id}/import")
async def save_paper(
    session_id: str,
    candidate_id: str,
    payload: ImportPaper,
    user: Teacher,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        candidate = session.record(candidate_id, "candidate")
        exam = session.record(candidate["parent"], "exam")
        course = session.record(exam["parent"], "course")
        review = candidate.get("_review")
        if not review or service.fingerprint(review) != payload.review_hash:
            raise HTTPException(409, "答卷已变化，请重新读取并核对后保存")
        saved = await service.import_paper(db, user.id, session.account_key, course, exam, candidate, review)
        # Commit while holding the source-session lock to serialize double clicks.
        await db.commit()
        return {"id": saved.id, "revision": saved.revision}
