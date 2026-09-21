"""Parse teacher pages, adapted from ArkLoop's chaoxing-connector.ts.

URLs stay server-side. Missing fields are unknown, never inferred scores/identities.
These are unofficial page formats; a parsed sample is not proof of completeness.
"""

import re
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup, Tag

COURSES_URL = "https://fycourse.fanya.chaoxing.com/fyportal/courselist/course"
READ_PATHS = {
    "fycourse.fanya.chaoxing.com": re.compile(r"^/fyportal/courselist/(course|coursegroupdata|entercoursenewfy)/?$"),
    "mooc2-ans.chaoxing.com": re.compile(
        r"^/(?:mooc2-ans/)?(?:mycourse/tch|exam/test(?:/(?:marklist|mark|review|markpaper))?)/?$"
    ),
}


def read_url(raw: str, base: str = COURSES_URL) -> str:
    url = urljoin(base, raw.replace("&amp;", "&").replace("\\x26", "&").replace("\\/", "/"))
    p = urlsplit(url)
    pattern = READ_PATHS.get(p.hostname or "")
    if p.scheme != "https" or p.netloc != p.hostname or not pattern or not pattern.fullmatch(p.path):
        return ""
    return url.split("#", 1)[0]


def query(url: str, *names: str) -> str:
    params = {k.lower(): v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    return next((params[n.lower()] for n in names if params.get(n.lower())), "")


def text(node: Tag | None) -> str:
    return node.get_text(" ", strip=True) if node else ""


def answer_text(node: Tag | None) -> str:
    if node is None:
        return ""
    # Preserve indentation and line breaks in programming answers.
    copy = BeautifulSoup(str(node), "html.parser")
    for br in copy.find_all("br"):
        br.replace_with("\n")
    for block in copy.select("p, div, li"):
        block.append("\n")
    value = copy.get_text().replace("\xa0", " ").strip("\n\r")
    if not value.strip():
        return ""
    return re.sub(r"^(?:考生答案|学生答案|我的答案|正确答案|标准答案|参考答案|答案解析|解析)\s*[:：]?\s*", "", value)


def number(value) -> float | None:
    try:
        result = float(value)
        return result if 0 <= result < 1_000_000 else None
    except (TypeError, ValueError):
        return None


def actions(node: Tag, base: str, suffix: str) -> list[str]:
    found = []
    for element in node.select("[href], [onclick], [data-url], [src]"):
        for attr in ("href", "onclick", "data-url", "src"):
            raw = str(element.get(attr, ""))
            for value in [raw, *re.findall(r"['\"]([^'\"]+)['\"]", raw)]:
                url = read_url(value, base)
                if url and re.search(suffix, urlsplit(url).path) and url not in found:
                    found.append(url)
    return found


def semesters(html: str) -> list[dict]:
    options = BeautifulSoup(html, "html.parser").select('select[name="xq"] option')
    result = [
        dict(
            id=str(o.get("value", "")),
            semester_num=str(o.get("semesternum", "")),
            title=text(o),
            selected=o.has_attr("selected"),
        )
        for o in options
        if o.get("value")
    ]
    if result and not any(item["selected"] for item in result):
        next((item for item in result if item["id"] != "0"), result[0])["selected"] = True
    return result


def courses(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    for a in soup.select("a[href], [data-url]"):
        url = read_url(str(a.get("href") or a.get("data-url") or ""))
        if not url or "entercoursenewfy" not in urlsplit(url).path:
            continue
        course_id, cpi = query(url, "courseId"), query(url, "cpi")
        title = re.sub(r"\s*教务课\s*$", "", text(a.select_one("h1,h2,h3,h4,.title,.name") or a))
        if course_id and cpi and title:
            key = f"{course_id}:{query(url, 'clazzid')}:{cpi}"
            found[key] = dict(source_id=key, title=title, _url=url)
    return list(found.values())


def exams(html: str, base: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    for a in soup.select("[href], [onclick]"):
        wrapper = BeautifulSoup(str(a), "html.parser")
        urls = actions(wrapper, base, r"/exam/test/(?:marklist|mark|review)$")
        if not urls:
            continue
        url = urls[0]
        source_id = query(url, "id", "testId", "examId", "paperId")
        if not source_id:
            continue
        row = a.find_parent(["li", "tr"]) or a.parent
        label = row.select_one(".list_li_tit,h1,h2,h3,h4,.title,.name")
        counts = {}
        for name, term in [("submitted_count", "已提交|已交"), ("unsubmitted_count", "未提交|未交")]:
            match = re.search(rf"(\d+)\s*人?\s*(?:{term})|(?:{term})\s*[:：]?\s*(\d+)", text(row))
            counts[name] = int(match[1] or match[2]) if match else None
        found[source_id] = dict(source_id=source_id, title=text(label) or f"考试 {source_id}", _url=url, **counts)
    return list(found.values())


def candidates(html: str, base: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    groups: dict[str, list[Tag]] = {}
    for index, row in enumerate(soup.select("tr, li.dataRow, .mark_item")):
        # Fixed LayUI columns duplicate rows with the same data-index.
        key = str(row.get("data-index", f"row-{index}"))
        groups.setdefault(key, []).append(row)
    found = {}
    for rows in groups.values():
        row = BeautifulSoup("".join(str(r) for r in rows), "html.parser")

        def field(selector: str) -> str:
            nodes = row.select(selector)
            for node in nodes:
                value = (
                    node.get("data-content")
                    or node.get("data-value")
                    or node.get("data-name")
                    or node.get("data-student-no")
                    or text(node)
                )
                if str(value).strip():
                    return str(value).strip()
            return ""

        urls = actions(row, base, r"/exam/test/markpaper$")
        url = urls[0] if urls else ""
        name = field('[data-field="createUserName"], .studentName, .stuName, [data-name]')
        student_no = field('[data-field="loginName"], [data-student-no], .studentNo, .stuNo')
        if not student_no:
            # Only the plain cell immediately after an explicitly named name cell.
            # Never mistake an unrelated relation ID / score for a student number.
            name_cell = row.select_one("td.studentName, td.stuName")
            next_cell = name_cell.find_next_sibling("td") if name_cell else None
            if (
                next_cell
                and not next_cell.has_attr("data-field")
                and re.fullmatch(r"[A-Za-z0-9_-]{5,30}", text(next_cell))
            ):
                student_no = text(next_cell)
        source_id = query(url, "id", "testUserRelationId", "studentId") or field('[data-field="id"]')
        if not source_id:
            source_id = str(rows[0].get("data-student-id") or rows[0].get("data-uid") or student_no)
        if not name or not source_id:
            continue
        unsubmitted = bool(re.search("未提交|未交", text(row))) and not url
        score = row.select_one('[data-field="answerScore"] input')
        found[source_id] = dict(
            source_id=source_id,
            name=name,
            student_no=student_no,
            status="unsubmitted" if unsubmitted else "submitted" if url else "unknown",
            source_score=number(score.get("value") or score.get("data")) if score else None,
            _url=url,
        )
    return list(found.values())


def review(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    for score in soup.select('input.questionScore:not([type="hidden"]), input[data-question-id][name*="score"]'):
        container = score.find_parent(
            class_=lambda value: (
                value
                and any(c in value.split() for c in ("borderBox", "question-item", "questionLi", "subjective-item"))
            )
        )
        if container is None:
            continue
        qid = score.get("data-question-id") or container.get("data1")
        if not qid:
            match = re.search(r"\d+", str(score.get("name") or score.get("id") or ""))
            qid = match[0] if match else ""
        if not qid:
            continue  # Never invent an identity for a grading question.
        type_node = container.select_one('input[id^="typeName_"]')
        type_text = (
            str(type_node.get("value", ""))
            if type_node
            else text(container.select_one(".colorShallow,.questionType,.mark_type"))
        )
        full_score = container.select_one('input[id^="fullScore"]')
        max_score = number(
            score.get("data-max-score") or container.get("data2") or (full_score.get("value") if full_score else None)
        )
        student = container.select_one(".SubjectStuAnswer,.topicStudentAnswer .colorDeep,.studentAnswer,.answerCon")
        reference = container.select_one(
            ".topicRightAnswer .objAnswer_right,.topicRightAnswer .colorGreen,.rightAnswer,.correctAnswer,.standardAnswer"
        )
        if student is None:
            student = next((p for p in container.select("p") if re.match("考生答案|学生答案", text(p))), None)
        if reference is None:
            reference = next(
                (p for p in container.select("p") if re.match("参考答案|标准答案|正确答案", text(p))), None
            )
        answer_container = container.select_one(".topicStudentAnswer,.studentAnswer,.answerCon") or student
        attachment = bool(answer_container and answer_container.select_one("img, a, audio, video, object, iframe"))
        found[str(qid)] = dict(
            source_id=str(qid),
            question_type=type_text,
            content=answer_text(
                container.select_one(".hiddenTitle,.questionStem,.Zy_TItle,.qtContent,.stem,.mark_name")
            ),
            student_answer=answer_text(student),
            reference_answer=answer_text(reference),
            max_score=max_score,
            source_score=number(score.get("value")),
            objective="objective" in container.get("class", []) or bool(re.search("单选|多选|判断", type_text)),
            requires_manual_review=attachment or max_score is None or student is None,
        )
    full = soup.select_one("#examFullScore")
    return dict(questions=list(found.values()), declared_max_score=number(full.get("value")) if full else None)
