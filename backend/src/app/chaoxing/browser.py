"""In-memory browser sessions. Run the enabled connector in ONE API process.

No storage_state, tracing, HAR, video, cookie export, or credential persistence.
Only fixed read routes are exposed. Login input is human-controlled, never an LLM.
"""

import asyncio
import contextlib
import hashlib
import importlib.util
import os
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

from fastapi import HTTPException

from app.config import settings

WIDTH, HEIGHT = 1080, 720
COURSES_URL = "https://fycourse.fanya.chaoxing.com/fyportal/courselist/course"
LOGIN_URL = "https://passport2.chaoxing.com/login?" + urlencode({"newversion": "true", "refer": COURSES_URL})
# Opt-in provider-page dump for adapting the reader to changed pages. Nothing is
# written unless this directory already exists; see docs/chaoxing-connection.md.
PAGE_DUMP_DIR = Path(os.environ.get("EXAM_CHAOXING_DUMP_DIR") or "/tmp/exam-chaoxing-pages")

# The provider fills some tables with its own XHR POST, so the served HTML holds
# an empty <tbody> and the reader saw a roster page with no students. Only these
# exact read-only query paths may use POST; every other reader request stays
# GET/HEAD. They are paged lists, so one page would silently truncate the roster:
# the body is rewritten to ask for a single page big enough for a class.
READ_POST_PATHS = frozenset({"/mooc2-ans/exam/test/markresult-new"})
LIST_PAGE_SIZE = 500
# The tables above appear after the page's own script runs.
ROWS_READY = "() => !!document.querySelector('tr[data-index] td')"
ROWS_READY_TIMEOUT_MS = 8000


def allowed_resource(url: str) -> bool:
    p = urlsplit(url)
    host = p.hostname or ""
    return (
        p.scheme == "https"
        and p.netloc == host
        and any(
            host == domain or host.endswith("." + domain)
            for domain in ("chaoxing.com", "chaoxing.net", "chaoxingv.com")
        )
    )


@dataclass
class Session:
    owner: str
    context: Any
    page: Any
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created: float = field(default_factory=time.monotonic)
    touched: float = field(default_factory=time.monotonic)
    connected: bool = False
    account_key: str = ""
    closed: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    records: dict[str, dict] = field(default_factory=dict)
    semesters: list[dict] = field(default_factory=list)

    def status(self):
        return {
            "id": self.id,
            "connected": self.connected,
            "width": WIDTH,
            "height": HEIGHT,
            "remaining_seconds": max(0, int(settings.chaoxing_max_age_seconds - (time.monotonic() - self.created))),
        }

    def expired(self):
        now = time.monotonic()
        return (
            self.closed
            or now - self.touched > settings.chaoxing_idle_seconds
            or now - self.created > settings.chaoxing_max_age_seconds
        )

    def remember(self, kind: str, records: list[dict], parent: str = "") -> list[dict]:
        result = []
        for record in records:
            key = hashlib.sha256(f"{kind}:{parent}:{record['source_id']}".encode()).hexdigest()[:32]
            self.records[key] = {**record, "kind": kind, "parent": parent}
            result.append(
                {
                    "id": key,
                    **{k: v for k, v in record.items() if not k.startswith("_")},
                    "readable": bool(record.get("_url")),
                }
            )
        return result

    def record(self, key: str, kind: str):
        record = self.records.get(key)
        if not record or record["kind"] != kind:
            raise HTTPException(404, "此记录不属于当前连接，请重新读取列表")
        return record


class BrowserManager:
    def __init__(self):
        self.sessions: dict[str, Session] = {}
        self.lock = asyncio.Lock()
        self.playwright = None
        self.browser = None
        self.reaper = None
        self.process_lock = None

    def availability(self):
        available = bool(importlib.util.find_spec("playwright") and importlib.util.find_spec("bs4"))
        reason = (
            ""
            if settings.chaoxing_enabled and available
            else ("管理员尚未启用学习通连接" if not settings.chaoxing_enabled else "服务器尚未安装学习通浏览器依赖")
        )
        return {"enabled": settings.chaoxing_enabled and available, "reason": reason}

    async def start(self):
        if not settings.chaoxing_enabled:
            return
        # Fail fast with multiple workers instead of randomly losing teacher sessions.
        import fcntl

        fd = os.open(settings.chaoxing_lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self.process_lock = os.fdopen(fd, "w")
        try:
            fcntl.flock(self.process_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.process_lock.close()
            self.process_lock = None
            raise RuntimeError(
                "Chaoxing requires a single API worker; another connector process holds the lock"
            ) from None
        self.reaper = asyncio.create_task(self._reap())

    async def _reap(self):
        while True:
            await asyncio.sleep(30)
            for session in list(self.sessions.values()):
                if session.expired():
                    async with session.lock:
                        if session.expired():
                            await self.close(session)

    async def close(self, session: Session):
        session.closed = True
        self.sessions.pop(session.id, None)
        session.records.clear()
        session.semesters.clear()
        with contextlib.suppress(Exception):
            await session.context.close()

    async def shutdown(self):
        if self.reaper:
            self.reaper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.reaper
        for session in list(self.sessions.values()):
            await self.close(session)
        if self.browser:
            await self.browser.close()
            self.browser = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None
        if self.process_lock:
            self.process_lock.close()
            self.process_lock = None

    async def create(self, owner: str) -> Session:
        state = self.availability()
        if not state["enabled"]:
            raise HTTPException(503, state["reason"])
        async with self.lock:
            for session in list(self.sessions.values()):
                if session.expired():
                    async with session.lock:
                        await self.close(session)
                elif session.owner == owner:
                    return session
            if len(self.sessions) >= settings.chaoxing_max_sessions:
                raise HTTPException(429, "当前连接人数已达上限，请稍后重试")
            context = None
            try:
                if not self.browser or not self.browser.is_connected():
                    from playwright.async_api import async_playwright

                    if not self.playwright:
                        self.playwright = await async_playwright().start()
                    options = {"headless": True}
                    if settings.chaoxing_browser_executable:
                        options["executable_path"] = settings.chaoxing_browser_executable
                    self.browser = await self.playwright.chromium.launch(**options)
                context = await self.browser.new_context(
                    viewport={"width": WIDTH, "height": HEIGHT},
                    locale="zh-CN",
                    accept_downloads=False,
                    service_workers="block",
                )
                page = await context.new_page()
                session = Session(owner=owner, context=context, page=page)

                async def guard(route):
                    request = route.request
                    if not allowed_resource(request.url):
                        return await route.abort()
                    p = urlsplit(request.url)
                    from .parsers import read_url

                    # Login browser cannot navigate to an editing or scoring page.
                    if request.is_navigation_request() and not (
                        p.hostname == "passport2.chaoxing.com"
                        or read_url(request.url)
                        or (p.hostname == "i.chaoxing.com" and p.path in ("/", "/base", "/base/"))
                    ):
                        return await route.abort()
                    if request.method not in ("GET", "HEAD") and (
                        session.connected
                        or p.hostname
                        not in ("passport2.chaoxing.com", "passport2-api.chaoxing.com", "captcha.chaoxing.com")
                    ):
                        return await route.abort()
                    if re_mutation(p.path):
                        return await route.abort()
                    await route.continue_()

                await context.route("**/*", guard)
                # No arbitrary auxiliary windows; the fixed login flow stays on this page.
                page.on("popup", lambda popup: asyncio.create_task(popup.close()))
                page.set_default_timeout(12_000)
                page.set_default_navigation_timeout(30_000)
                self.sessions[session.id] = session
                try:
                    await page.goto(LOGIN_URL, wait_until="domcontentloaded")
                except BaseException:
                    await self.close(session)
                    raise
                return session
            except HTTPException:
                raise
            except BaseException as exc:
                if context:
                    with contextlib.suppress(Exception):
                        await context.close()
                if isinstance(exc, asyncio.CancelledError):
                    raise
                raise HTTPException(503, "无法打开学习通登录页，请检查服务器网络和 Chromium 安装") from None

    @asynccontextmanager
    async def hold(self, session_id: str, owner: str, *, touch=True):
        session = self.sessions.get(session_id)
        if session is None or session.owner != owner:
            raise HTTPException(404, "连接不存在或已结束，请重新连接")
        async with session.lock:
            if session.expired():
                await self.close(session)
                raise HTTPException(410, "连接已过期，请重新登录学习通")
            if touch:
                session.touched = time.monotonic()
            try:
                yield session
            except HTTPException as exc:
                if exc.status_code == 410:
                    await self.close(session)
                raise
            except Exception:
                # Never include Playwright exceptions: they can contain credential URLs/input.
                raise HTTPException(502, "学习通页面读取失败，请重试；持续失败时断开并重新连接") from None


def re_mutation(path: str) -> bool:
    import re

    return bool(re.search(r"submitmark|savemark|delete|publish|submitpaper|updateScore", path, re.I))


def read_request_allowed(method: str, url: str) -> bool:
    """May the read channel send this request?

    Reads are GET/HEAD everywhere. A few provider list endpoints are queried
    with POST by the provider's own page scripts and stay read-only, so they are
    named individually instead of widening the rule to every XHR.
    """
    if method in ("GET", "HEAD"):
        return True
    return method == "POST" and urlsplit(url).path in READ_POST_PATHS and not re_mutation(urlsplit(url).path)


def enlarged_list_body(body: str | None) -> str | None:
    """Ask an allowlisted list endpoint for one page large enough for a class."""
    if not body:
        return None
    from urllib.parse import parse_qsl, urlencode as encode

    pairs = [(k, v) for k, v in parse_qsl(body, keep_blank_values=True) if k != "size"]
    pairs.append(("size", str(LIST_PAGE_SIZE)))
    return encode(pairs)


def dump_pages(label: str, pages: list[tuple[str, str]]) -> list[str]:
    """Write provider pages the fixed read routes cannot recognize.

    Disabled unless PAGE_DUMP_DIR exists. Only pages fetched through the read
    allowlist are passed here; login screens are never read this way. The dump
    contains provider URLs and page markup, so treat it as a local debugging
    artifact and delete it after adapting the parser.
    """
    if not PAGE_DUMP_DIR.is_dir():
        return []
    written = []
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for index, (url, html) in enumerate(pages):
        target = PAGE_DUMP_DIR / f"{stamp}-{label}-{index}.html"
        with contextlib.suppress(OSError):
            target.write_text(f"<!-- {url} -->\n{html}", encoding="utf-8")
            written.append(str(target))
    return written


async def read_page(session: Session, url: str) -> tuple[str, str]:
    from .parsers import read_url

    if not read_url(url):
        raise HTTPException(422, "不支持的学习通读取地址")
    page = await session.context.new_page()
    try:
        # Stronger than the login guard: reader traffic is GET/HEAD, plus the
        # individually named read-only list endpoints the provider queries with
        # POST. Everything else, including any other XHR, is aborted.
        async def guard(route):
            request = route.request
            if not allowed_resource(request.url) or not read_request_allowed(request.method, request.url):
                await route.abort()
            elif request.method in ("GET", "HEAD"):
                await route.fallback()
            else:
                body = enlarged_list_body(request.post_data)
                if body is None:
                    await route.continue_()
                else:
                    await route.continue_(post_data=body)

        await page.route("**/*", guard)
        response = await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        if response and response.status >= 400:
            raise HTTPException(502, f"学习通返回 HTTP {response.status}，请稍后重试")
        with contextlib.suppress(Exception):
            await page.wait_for_load_state("networkidle", timeout=5000)
        if urlsplit(page.url).hostname == "passport2.chaoxing.com":
            session.connected = False
            session.records.clear()
            raise HTTPException(410, "学习通登录已失效，请重新连接")
        final = page.url
        content = await page.content()
        if "请重新登录" in content:
            session.connected = False
            session.records.clear()
            raise HTTPException(410, "学习通登录已失效，请重新连接")
        if "layui-table-body" in content:
            # Best effort. The provider renders these tables from its own XHR, so
            # the markup above arrives before the rows do. A table that is still
            # empty when this elapses stays empty; the caller reports that.
            with contextlib.suppress(Exception):
                await page.wait_for_function(ROWS_READY, timeout=ROWS_READY_TIMEOUT_MS)
            content = await page.content()
        if not read_url(final):
            dump_pages("landing", [(final, content)])
            # Report the site without its query: signatures stay server-side.
            where = urlsplit(final)
            raise HTTPException(502, f"学习通跳转到了不支持的页面：{where.netloc or '未知站点'}{where.path or '/'}")
        return final, content
    finally:
        await page.close()


# A roster or answer page legitimately differs from its entry page in class and
# session parameters (clazzid, cpi, courseid, enc, t, page=). Only the entity
# identity decides whether a nested page belongs to the same exam or answer.
ENTITY_PARAMS = ("id", "testId", "paperId", "testUserRelationId")


async def read_samples(session: Session, initial: str, limit=5):
    """Follow only same-entity pagination and fixed read-only iframes.

    Completeness is deliberately unverified: JS-only pagination is not guessed.
    """
    from .parsers import actions, query
    from bs4 import BeautifulSoup

    queue, seen, pages = [initial], set(), []
    while queue and len(pages) < limit:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        final, html = await read_page(session, url)
        pages.append((final, html))
        for link in actions(
            BeautifulSoup(html, "html.parser"), final, r"/exam/test(?:/(?:marklist|mark|review|markpaper))?/?$"
        ):
            if urlsplit(link).path != urlsplit(initial).path:
                continue
            if any(query(link, key) != query(initial, key) for key in ENTITY_PARAMS):
                continue
            if link not in seen and link not in queue:
                queue.append(link)
    return pages


manager = BrowserManager()
