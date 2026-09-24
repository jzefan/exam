import asyncio
import hashlib
import time
import uuid

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
from .browser import (
    COURSES_URL,
    HEIGHT,
    WIDTH,
    dump_pages,
    dump_requests,
    dumping_enabled,
    manager,
    read_page,
    read_samples,
)
from .credentials import (
    credentials_encryption_enabled,
    delete_credentials,
    get_credentials,
    save_credentials,
)


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


_READ_LOGIN_FIELDS = """() => {
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const password = [...document.querySelectorAll('input[type="password"]')].find(visible);
  if (!password) return null;
  const root = password.form || password.closest('form') || document;
  const candidates = [...root.querySelectorAll('input:not([type="password"])')]
    .filter((el) => visible(el) && !['hidden', 'checkbox', 'radio', 'submit', 'button'].includes((el.type || '').toLowerCase()));
  const account = candidates.find((el) => /user|account|phone|mobile|login|tel|username/i.test(
    [el.name, el.id, el.placeholder, el.autocomplete].join(' ')
  )) || candidates.find((el) => ['text', 'tel', 'email', ''].includes((el.type || '').toLowerCase()));
  return account ? { username: account.value || '', password: password.value || '' } : null;
}"""


async def _save_login_fields(session, user_id: uuid.UUID, db: AsyncSession) -> bool:
    """Capture the provider form after human input; never return or log its values."""
    if not credentials_encryption_enabled():
        return False
    try:
        if urlsplit(session.page.url).hostname != "passport2.chaoxing.com":
            return False
        values = await session.page.evaluate(_READ_LOGIN_FIELDS)
        if not values:
            return False
        username, password = values["username"].strip(), values["password"]
        if not username or not password:
            return False
        fingerprint = hashlib.sha256(f"{username}\0{password}".encode()).hexdigest()
        if fingerprint == session.credential_fingerprint:
            return True
        await save_credentials(db, user_id, username, password)
        session.credential_fingerprint = fingerprint
        return True
    except Exception:
        # Credential saving must never interfere with a teacher's login flow.
        return False


def _schedule_login_save(session, user_id: uuid.UUID) -> None:
    """Persist completed credentials once typing pauses, not once per keystroke."""
    if not credentials_encryption_enabled():
        return
    if session.credential_save_task:
        session.credential_save_task.cancel()

    async def persist_after_pause():
        current = asyncio.current_task()
        try:
            await asyncio.sleep(0.8)
            async with session.lock:
                if session.closed or session.connected:
                    return
                from app.database import async_session

                async with async_session() as db:
                    if await _save_login_fields(session, user_id, db):
                        await db.commit()
                    else:
                        await db.rollback()
        except asyncio.CancelledError:
            raise
        except Exception:
            # Never surface or log a failure that might include login form data.
            return
        finally:
            if session.credential_save_task is current:
                session.credential_save_task = None

    session.credential_save_task = asyncio.create_task(persist_after_pause())


def _cancel_pending_login_save(session) -> None:
    if session.credential_save_task:
        session.credential_save_task.cancel()
        session.credential_save_task = None


async def _autofill_login_fields(page, username: str, password: str) -> bool:
    return bool(await page.evaluate(
        """([username, password]) => {
          const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
          const pwd = [...document.querySelectorAll('input[type="password"]')].find(visible);
          if (!pwd) return false;
          const root = pwd.form || pwd.closest('form') || document;
          const fields = [...root.querySelectorAll('input:not([type="password"])')]
            .filter((el) => visible(el) && !['hidden', 'checkbox', 'radio', 'submit', 'button'].includes((el.type || '').toLowerCase()));
          const account = fields.find((el) => /user|account|phone|mobile|login|tel|username/i.test(
            [el.name, el.id, el.placeholder, el.autocomplete].join(' ')
          )) || fields.find((el) => ['text', 'tel', 'email', ''].includes((el.type || '').toLowerCase()));
          if (!account || account.value || pwd.value) return false;
          const setter = (el, value) => {
            const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          setter(account, username);
          setter(pwd, password);
          return true;
        }""",
        [username, password],
    ))


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


@router.post("/sessions/{session_id}/actions")
async def login_action(session_id: str, action: LoginAction, user: Teacher, db: AsyncSession = Depends(get_db)):
    async with manager.hold(session_id, str(user.id)) as session:
        if session.connected:
            raise HTTPException(409, "登录交互已结束；读取页面不可操作")
        page = session.page
        credentials_saved = False
        if action.kind == "pointer" or (action.kind == "key" and action.key == "Enter"):
            # A login click may navigate away immediately, so capture completed fields first.
            _cancel_pending_login_save(session)
            credentials_saved = await _save_login_fields(session, user.id, db)
        if action.kind == "pointer":
            if not action.points:
                raise HTTPException(422, "缺少鼠标位置")
            await page.mouse.move(action.points[0].x, action.points[0].y)
            await page.mouse.down()
            try:
                for point in action.points[1:]:
                    await page.mouse.move(point.x, point.y)
                    # Replay a human-drawn drag without generating captcha solutions.
                    await asyncio.sleep(0.015)
            finally:
                await page.mouse.up()
        elif action.kind == "text":
            await page.keyboard.insert_text(action.text)
        elif action.kind == "key" and action.key:
            await page.keyboard.press(action.key)
        elif action.kind == "scroll":
            await page.mouse.wheel(0, action.delta)
        credentials_pending = action.kind == "text" or (action.kind == "key" and action.key != "Enter")
        if credentials_pending:
            _schedule_login_save(session, user.id)
        return {
            "credentials_saved": credentials_saved,
            "credentials_pending": credentials_pending and credentials_encryption_enabled(),
        }


@router.post("/sessions/{session_id}/autofill")
async def autofill_login(session_id: str, user: Teacher, db: AsyncSession = Depends(get_db)):
    async with manager.hold(session_id, str(user.id), touch=False) as session:
        if session.connected:
            return {"saved": False, "filled": False, "persistence_enabled": credentials_encryption_enabled()}
        if not credentials_encryption_enabled():
            return {"saved": False, "filled": False, "persistence_enabled": False}
        try:
            credentials = await get_credentials(db, user.id)
        except ValueError:
            return {"saved": True, "filled": False, "persistence_enabled": True, "unreadable": True}
        if credentials is None:
            return {"saved": False, "filled": False, "persistence_enabled": True}
        filled = await _autofill_login_fields(session.page, *credentials)
        session.credential_fingerprint = hashlib.sha256(
            f"{credentials[0]}\0{credentials[1]}".encode()
        ).hexdigest()
        return {"saved": True, "filled": filled, "persistence_enabled": True}


@router.delete("/credentials", status_code=204)
async def forget_login(user: Teacher, db: AsyncSession = Depends(get_db)):
    await delete_credentials(db, user.id)


def require_connected(session):
    if not session.connected:
        raise HTTPException(409, "请先完成学习通登录并验证连接")


async def course_list(
    session, semester_id: str | None = None, initial_html: str | None = None, *, refresh: bool = False
):
    from . import parsers

    cache_key = f"courses:{semester_id or 'selected'}"
    if refresh:
        session.invalidate_read_cache("courses:", "exams:", "candidates:", "review:")
        session.records.clear()
    elif initial_html is None:
        cached = session.cached_read(cache_key)
        if cached is not None:
            session.semesters = cached["semesters"]
            return cached

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
    if semester and semester["id"] != "0":
        for record in records:
            record["semester_title"] = semester["title"]
    if not records and not any(term in html for term in ("暂无课程", "没有课程", "暂无相关课程")):
        raise HTTPException(502, "未识别到教师课程，可能尚未登录或学习通页面结构已变化")
    result = {
        "items": session.remember("course", records),
        "semesters": session.semesters,
        "semester_id": semester["id"] if semester else "",
        "complete": False,
        "notice": NOTICE,
    }
    session.cache_read(cache_key, result)
    if semester and semester["selected"]:
        session.cache_read("courses:selected", result)
    return result


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
async def list_courses(session_id: str, user: Teacher, semester: str | None = None, refresh: bool = False):
    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        return await course_list(session, semester, refresh=refresh)


def module_entry(course_html: str, soup, host: str, path: str) -> str:
    """The URL a Vue course page publishes as one of its module entry points.

    The shell decides when a module exists, so the entry is not reliably an
    iframe `src`: it may sit in a lazy `data-src`, or only inside the shell's own
    script. Search the markup for an allowlisted URL on that host and path
    instead of trusting one attribute name; an entry that is not on the read
    allowlist is not returned.
    """
    import re

    from . import parsers

    pattern = re.compile(rf"https://{re.escape(host)}{re.escape(path)}\?[^\"'<>\s]*")
    for match in pattern.finditer(course_html):
        url = parsers.read_url(match.group(0).replace("\\u0026", "&"))
        if url:
            return url
    for frame in soup.select("iframe"):
        url = parsers.read_url(str(frame.get("src") or frame.get("data-src") or ""))
        if url:
            where = urlsplit(url)
            if where.hostname == host and where.path.rstrip("/") == path:
                return url
    return ""


def capture_unreadable_course(final: str, course_html: str, soup) -> None:
    """Record a course page whose assignment list could not even be attempted.

    Nothing downstream runs once the page offers neither the old hidden
    credentials nor a module entry, so without this the only trace of such a
    course is the notice in the UI. The summary says what the page did offer, so
    an entry that moved can be found without guessing. Opt-in, and write failures
    are already swallowed by the two dump helpers.
    """
    if not dumping_enabled():
        return
    dump_pages("course-no-assignment-source", [(final, course_html)])
    where = urlsplit(final)
    notes = [
        f"page={where.netloc}{where.path}",
        f"query_keys={','.join(sorted({key.lower() for key in parse_qs(where.query)}))}",
        f"enc_input={'yes' if soup.select_one('#enc') else 'no'} work_enc_input={'yes' if soup.select_one('#workEnc') else 'no'}",
    ]
    for frame in soup.select("iframe"):
        raw = str(frame.get("src") or frame.get("data-src") or "").replace("&amp;", "&")
        module = urlsplit(raw) if raw else None
        # parse_qs returns a mapping; its keys are the parameter names.
        keys = ",".join(sorted(parse_qs(module.query))) if module else ""
        notes.append(
            f"iframe={module.netloc}{module.path} keys={keys}"
            if module and module.netloc
            else f"iframe=<unusable> attrs={','.join(sorted(frame.attrs))}"
        )
    dump_requests("course-no-assignment-source", notes)


async def read_task_assignments(session, course_html: str, soup, final: str) -> tuple[list[dict], str]:
    """Read tasks using the Vue module's own authenticated list request."""
    from . import parsers

    entry = module_entry(course_html, soup, "task.chaoxing.com", "/task/index")
    if not entry:
        if dumping_enabled():
            dump_pages("course-no-task-module", [(final, course_html)])
        return [], "新版课程页未提供可读取的教学任务入口。"
    refused: list[str] = []
    task_responses: list[dict] = []
    network_events: list[str] = []
    try:
        module_final, module_html = await read_page(session, entry, refused, task_responses, network_events)
    except HTTPException:
        if dumping_enabled():
            dump_pages("course-no-work-credential", [(final, course_html)])
            dump_requests("task-module", refused)
        return [], "学习通教学任务入口暂时无法读取。"
    if dumping_enabled():
        dump_pages("course-no-work-credential", [(final, course_html)])
        dump_pages("task-module", [(module_final, module_html)])
        dump_requests("task-module", refused)
        dump_requests("task-module-network", network_events)
    if not task_responses:
        return [], "教学任务页未返回作业列表数据。"
    items = []
    for payload in task_responses:
        items.extend(parsers.task_assignments(payload))
    unique = {item["source_id"]: item for item in items}
    if unique:
        return list(unique.values()), "新版作业已读取；该任务类型暂不支持读取学生答卷。"
    return [], "学习通已响应教学任务列表，但没有返回可识别的作业。"


async def capture_home_module(session, course_html: str, soup, final: str) -> None:
    """Leave the course home module behind when the assignment list is unread.

    The Vue shell mounts the course home as an iframe module, and it is the
    module the teacher is looking at while the assignment list is on screen. Its
    list can be server-rendered markup or its own call, so record both. Same
    opt-in gate as the other diagnostics, and failures change nothing.
    """
    if not dumping_enabled():
        return
    dump_pages("course-no-work-credential", [(final, course_html)])
    entry = next(
        (
            url
            for host, path in (
                ("mooc2-ans.chaoxing.com", "/mooc2-ans-vue/fanyav3/index"),
                ("mooc2-ans.chaoxing.com", "/mooc2-ans-ue/fanya3/index"),
            )
            if (url := module_entry(course_html, soup, host, path))
        ),
        "",
    )
    if not entry:
        return
    refused: list[str] = []
    responses: list[dict] = []
    events: list[str] = []
    try:
        module_final, module_html = await read_page(session, entry, refused, responses, events)
    except HTTPException:
        return
    dump_pages("home-module", [(module_final, module_html)])
    dump_requests("home-module", refused)
    dump_requests("home-module-network", events)


def work_list_url(final: str) -> str:
    """The assignment list route this generation publishes in its course menu.

    The course menu links assignments at the relative `/mooc2-ans/work/list` and
    appends the course identity itself, so the route is rebuilt from the course
    page's own parameters rather than scraped from the menu. The older reader
    used `mooc1.chaoxing.com/mooc2/work/list`, which is a different generation.
    """
    from . import parsers

    where = urlsplit(final)
    if not where.hostname or not where.query:
        return ""
    params = {key.lower(): value[0] for key, value in parse_qs(where.query).items()}
    identity = {
        key: params[key]
        for key in ("courseid", "clazzid", "cpi", "enc", "t", "ut", "openc")
        if params.get(key)
    }
    if not identity.get("courseid") or not identity.get("cpi"):
        return ""
    # The work module historically reads camelCase names even though the course
    # page carries lower case, so both are sent rather than picking one.
    for lower, camel in (("courseid", "courseId"), ("clazzid", "classId"), ("clazzid", "clazzId")):
        if identity.get(lower):
            identity[camel] = identity[lower]
    url = f"https://{where.hostname}/mooc2-ans/work/list?" + urlencode(identity)
    return url if parsers.read_url(url) else ""


async def read_work_list_assignments(session, final: str) -> tuple[list[dict], str]:
    """Read the assignment list from the course menu's own route."""
    from . import parsers

    url = work_list_url(final)
    if not url:
        return [], ""
    try:
        work_final, work_html = await read_page(session, url)
    except HTTPException:
        return [], "学习通作业列表暂时无法读取。"
    if dumping_enabled():
        dump_pages("work-list-module", [(work_final, work_html)])
    items = parsers.assignments(work_html, work_final)
    if not items:
        return [], "未识别到课程作业列表项；请检查学习通页面结构。"
    notice = (
        "已读取作业列表，但部分作业未提供可识别的教师批阅入口；不可读项目已禁用。"
        if any(not item["_url"] for item in items)
        else ""
    )
    return items, notice


WORK_ROSTER_PAGE_SIZE = 500


def work_page_url(url: str, page: int, size: int) -> str:
    """The same roster page with an explicit page number and page size."""
    from urllib.parse import parse_qsl, urlunsplit

    where = urlsplit(url)
    params = [
        (key, value)
        for key, value in parse_qsl(where.query, keep_blank_values=True)
        if key.lower() not in ("pages", "size")
    ]
    params += [("pages", str(page)), ("size", str(size))]
    return urlunsplit((where.scheme, where.netloc, where.path, urlencode(params), ""))


async def append_work_roster_pages(session, url: str, pages: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Follow a work roster's remaining pages.

    Its pager is a script call rather than links, so pages are requested by
    number. The size is asked for large enough that a class fits in one request,
    which is why this normally adds nothing.
    """
    from bs4 import BeautifulSoup

    total = size = 0
    for _, html in pages:
        soup = BeautifulSoup(html, "html.parser")
        total_node = soup.select_one("#totalPage")
        size_node = soup.select_one("#pageSize")
        total = max(total, int(str(total_node.get("value", 0) or 0)) if total_node else 0)
        size = size or (int(str(size_node.get("value", 0) or 0)) if size_node else 0)
    for number in range(2, total + 1):
        try:
            pages.append(await read_page(session, work_page_url(url, number, size or WORK_ROSTER_PAGE_SIZE)))
        except HTTPException:
            break
    return pages


@router.get("/sessions/{session_id}/courses/{course_id}/exams")
async def list_exams(session_id: str, course_id: str, user: Teacher, refresh: bool = False):
    from . import parsers

    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        course = session.record(course_id, "course")
        cache_key = f"exams:{course_id}"
        if refresh:
            session.invalidate_read_cache(cache_key, "candidates:", "review:")
        else:
            cached = session.cached_read(cache_key)
            if cached is not None:
                return cached
        final, course_html = await read_page(session, course["_url"])
        final_path = urlsplit(final).path.rstrip("/")
        params = {k.lower(): v[0] for k, v in parse_qs(urlsplit(final).query).items()}
        supported_course_page = final_path.endswith("/mycourse/tch") or final_path in {
            "/mooc2-ans-vue/fanyav3/tch",
            "/mooc2-ans-ue/fanya3/tch",
        }
        if not params.get("courseid") or not params.get("cpi") or not supported_course_page:
            raise HTTPException(502, "未能解析教师课程入口，暂不支持此类课程")
        params = {k: v for k, v in params.items() if k in ("courseid", "cpi", "enc", "t")}
        params["clazzid"] = "-1"
        url = "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test?" + urlencode(params)
        pages = await read_samples(session, url)
        items = [item for base, html in pages for item in parsers.exams(html, base)]
        exam_list_unrecognized = not items and not any(
            term in html for _, html in pages for term in ("暂无考试", "没有考试")
        )
        unique = {item["source_id"]: item for item in items}
        for item in unique.values():
            item["item_type"] = "考试"

        # Course assignments use workEnc rather than the exam page's enc. The
        # separate list is best-effort: older/alternate course variants may not
        # expose this credential or may deny the route, in which case the exam
        # list remains available and unchanged.
        from bs4 import BeautifulSoup

        course_soup = BeautifulSoup(course_html, "html.parser")
        work_enc = str((course_soup.select_one("#workEnc") or {}).get("value", "")).strip()
        page_enc = str((course_soup.select_one("#enc") or {}).get("value", "")).strip()
        course_query = {k.lower(): v[0] for k, v in parse_qs(urlsplit(final).query).items()}
        work_course_id = course_query.get("courseid", "")
        work_class_id = course_query.get("clazzid", "")
        cpi = course_query.get("cpi", "")
        assignment_notice = ""
        task_entry = module_entry(course_html, course_soup, "task.chaoxing.com", "/task/index")
        if not task_entry and not (work_enc and page_enc) and work_course_id and work_class_id and cpi:
            middle_params = {
                "courseid": work_course_id,
                "clazzid": work_class_id,
                "cpi": cpi,
                "ismooc2": "1",
                "v": "2",
            }
            middle_url = "https://mooc1.chaoxing.com/visit/stucoursemiddle?" + urlencode(middle_params)
            try:
                _, middle_html = await read_page(session, middle_url)
            except HTTPException:
                middle_html = ""
            middle_soup = BeautifulSoup(middle_html, "html.parser")
            work_enc = work_enc or str((middle_soup.select_one("#workEnc") or {}).get("value", "")).strip()
            page_enc = page_enc or str((middle_soup.select_one("#enc") or {}).get("value", "")).strip()
        if task_entry:
            parsed_assignments, assignment_notice = await read_task_assignments(
                session, course_html, course_soup, final
            )
            for item in parsed_assignments:
                unique[item["source_id"]] = item
            if not parsed_assignments:
                await capture_home_module(session, course_html, course_soup, final)
        elif work_enc and page_enc and work_course_id and work_class_id and cpi:
            work_params = {
                "courseId": work_course_id,
                "classId": work_class_id,
                "cpi": cpi,
                "ut": "s",
                "t": str(int(time.time() * 1000)),
                "stuenc": page_enc,
                "enc": work_enc,
                "isdisplaytable": "2",
            }
            if course_query.get("openc"):
                work_params["openc"] = course_query["openc"]
            work_url = "https://mooc1.chaoxing.com/mooc2/work/list?" + urlencode(work_params)
            try:
                work_pages = await read_samples(session, work_url)
            except HTTPException:
                work_pages = []
                assignment_notice = "学习通未返回课程作业列表，已保留考试列表。"
            parsed_assignments = []
            for base, html in work_pages:
                parsed_assignments.extend(parsers.assignments(html, base))
            if parsed_assignments:
                for item in parsed_assignments:
                    unique[item["source_id"]] = item
                if any(not item["_url"] for item in parsed_assignments):
                    assignment_notice = "已读取作业列表，但部分作业未提供可识别的教师批阅入口；不可读项目已禁用。"
            elif work_pages and not any(
                marker in html for _, html in work_pages for marker in ("暂无作业", "没有作业", "暂无已发放作业")
            ):
                assignment_notice = "未识别到课程作业列表项；请检查学习通页面结构。"
            if not parsed_assignments:
                dump_pages("work-list", work_pages)
        else:
            assignment_notice = "当前课程未提供作业读取凭据，未读取作业列表。"
            capture_unreadable_course(final, course_html, course_soup)
            # A page that carries only the home module still needs that module
            # read: on this generation it is the one showing the coursework.
            await capture_home_module(session, course_html, course_soup, final)
            found, notice = await read_work_list_assignments(session, final)
            for item in found:
                unique[item["source_id"]] = item
            if found:
                assignment_notice = notice
        if not unique and exam_list_unrecognized:
            raise HTTPException(502, "未识别到考试或作业列表，请核对教师权限或页面结构")
        result = {
            "items": session.remember("exam", list(unique.values()), course_id),
            "complete": False,
            "notice": NOTICE,
            "assignment_notice": assignment_notice,
        }
        return session.cache_read(cache_key, result)


@router.get("/sessions/{session_id}/exams/{exam_id}/candidates")
async def list_candidates(session_id: str, exam_id: str, user: Teacher, refresh: bool = False):
    from . import parsers

    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        exam = session.record(exam_id, "exam")
        cache_key = f"candidates:{exam_id}"
        if refresh:
            session.invalidate_read_cache(cache_key, "review:")
        else:
            cached = session.cached_read(cache_key)
            if cached is not None:
                return cached
        # A work roster is paged by its own script, so it is asked for a page big
        # enough for a class and then for its remaining pages by number.
        url = exam["_url"]
        work_roster = "/work/mark" in urlsplit(url).path
        if work_roster:
            url = work_page_url(url, 1, WORK_ROSTER_PAGE_SIZE)
        pages = await read_samples(session, url)
        if work_roster:
            pages = await append_work_roster_pages(session, url, pages)
        items = {item["source_id"]: item for base, html in pages for item in parsers.candidates(html, base)}
        if not items:
            # An exam with no submitted answer has an empty roster: that is a
            # fact about the exam, not a reader failure.
            if exam.get("submitted_count") == 0:
                raise HTTPException(409, "该考试暂无已提交的答卷，没有可读取的考生")
            # Keep a local copy of what the provider actually returned so the
            # reader can be adapted; see dump_pages() for the opt-in gate.
            dump_pages(f"candidates-{exam_id[:8]}", pages)
            raise HTTPException(502, "未识别到考生记录，可能为动态分页或账号没有答卷权限")
        result = {
            "items": session.remember("candidate", list(items.values()), exam_id),
            "expected_submitted": exam.get("submitted_count"),
            "complete": False,
            "notice": NOTICE,
        }
        return session.cache_read(cache_key, result)


@router.get("/sessions/{session_id}/candidates/{candidate_id}/review")
async def get_review(session_id: str, candidate_id: str, user: Teacher, refresh: bool = False):
    from . import parsers

    async with manager.hold(session_id, str(user.id)) as session:
        require_connected(session)
        candidate = session.record(candidate_id, "candidate")
        cache_key = f"review:{candidate_id}"
        if refresh:
            session.invalidate_read_cache(cache_key)
        else:
            cached = session.cached_read(cache_key)
            if cached is not None:
                candidate["_review"] = cached["_source_review"]
                return {k: v for k, v in cached.items() if k != "_source_review"}
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
            # Keep what the provider returned: a work answer sheet is a different
            # document from an exam one and has to be adapted from real markup.
            dump_pages(f"review-{candidate_id[:8]}", pages)
            raise HTTPException(502, "未识别到答卷题目，暂不能导入评分")
        review = {"questions": list(questions.values()), "declared_max_score": declared_max_score}
        candidate["_review"] = review
        result = {
            **review,
            "review_hash": service.fingerprint(review),
            "complete": False,
            "notice": NOTICE,
            "_source_review": review,
        }
        session.cache_read(cache_key, result)
        return {k: v for k, v in result.items() if k != "_source_review"}


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
        saved = await service.import_paper(
            db, user.id, session.account_key, course, exam, candidate, review,
            completeness_confirmed=payload.completeness_confirmed,
        )
        # Commit while holding the source-session lock to serialize double clicks.
        await db.commit()
        return {"id": saved.id, "revision": saved.revision}
