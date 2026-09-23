"""Parse teacher pages, adapted from ArkLoop's chaoxing-connector.ts.

URLs stay server-side. Missing fields are unknown, never inferred scores/identities.
These are unofficial page formats; a parsed sample is not proof of completeness.
"""

import re
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup, Tag

from .question_types import is_objective

COURSES_URL = "https://fycourse.fanya.chaoxing.com/fyportal/courselist/course"
READ_PATHS = {
    "fycourse.fanya.chaoxing.com": re.compile(r"^/fyportal/courselist/(course|coursegroupdata|entercoursenewfy)/?$"),
    "mooc2-ans.chaoxing.com": re.compile(
        r"^/(?:mooc2-ans/)?(?:mycourse/tch|mooc2-ans-vue/fanyav3/tch|mooc2-ans-ue/fanya3/tch|exam/test(?:/(?:marklist|mark|review|markpaper))?)/?$"
    ),
    # Course assignments use a separate, older host and route family from the
    # course exam list. Keep this allowlist narrow: the connector only follows
    # assignment list/detail and read-only teacher review pages.
    "mooc1.chaoxing.com": re.compile(
        r"^/(?:visit/stucoursemiddle|mooc2/work/list|mooc-ans/mooc2/work/(?:task|view|dowork)|mooc-ans/work/selectWorkQuestion(?:YiPiYue)?)/?$"
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


CHOICE_OPTION = re.compile(r"^([A-H])(?:\s*[.．、:：)]|\s+)\s*(.+)$")
ANSWER_AREAS = {
    "topicStudentAnswer", "studentAnswer", "SubjectStuAnswer", "stuAnswer", "answerCon", "mark_answer",
    "topicRightAnswer", "rightAnswer", "correctAnswer", "standardAnswer", "answerAnalysis", "AnalysisCon", "mark_score",
}


def choice_options(container: Tag) -> list[str]:
    """Read visible option rows without copying student answers or grading notes."""
    options: dict[str, str] = {}
    for node in container.select("li, p, label, div, span"):
        if any(set(tag.get("class", [])) & ANSWER_AREAS for tag in (node, *node.parents) if isinstance(tag, Tag)):
            continue
        match = CHOICE_OPTION.fullmatch(text(node))
        if not match:
            continue
        # A wrapper can start with A while containing every option. Prefer its
        # deepest matching children so each answer choice stays on one line.
        if any(CHOICE_OPTION.fullmatch(text(child)) for child in node.select("li, p, label, div, span")):
            continue
        options.setdefault(match[1], f"{match[1]}. {match[2]}")
    return list(options.values()) if len(options) >= 2 else []


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
    # The course page ships more than one `select[name="xq"]` (a filter bar plus
    # a template), so every semester would be listed twice in the picker. Keep
    # the first occurrence, which is the visible selector, and merge the flag.
    result: list[dict] = []
    seen: dict[str, dict] = {}
    for option in BeautifulSoup(html, "html.parser").select('select[name="xq"] option'):
        value = str(option.get("value", ""))
        if not value:
            continue
        existing = seen.get(value)
        if existing:
            existing["selected"] = existing["selected"] or option.has_attr("selected")
            continue
        entry = dict(
            id=value,
            semester_num=str(option.get("semesternum", "")),
            title=text(option),
            selected=option.has_attr("selected"),
        )
        seen[value] = entry
        result.append(entry)
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
            details = {}
            labels = "课程编号|教师姓名|教师团队|院校|学期|课程标签"
            containers = (a, *[parent for parent in a.parents if isinstance(parent, Tag)][:8])
            for container in containers:
                raw = text(container)
                if not re.search(rf"(?:{labels})\s*[:：]", raw):
                    continue
                for field, key_name in (
                    ("课程编号", "course_code"),
                    ("教师姓名", "teacher_name"),
                    ("教师团队", "teacher_team"),
                    ("院校", "school_name"),
                    ("学期", "semester_title"),
                    ("课程标签", "course_tags"),
                ):
                    match = re.search(rf"{field}\s*[:：]\s*(.*?)(?=\s*(?:{labels})\s*[:：]|$)", raw)
                    if match:
                        value = match[1].strip(" |｜·•,，")
                        if value:
                            details[key_name] = value
                break
            found[key] = dict(source_id=key, title=title, _url=url, **details)
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


def assignments(html: str, base: str) -> list[dict]:
    """Parse course work rows and retain only provider-supplied read URLs.

    Chaoxing has multiple generations of its work page. The stable list shape
    is a goTask element whose data attribute carries workId/answerId. Some
    teacher pages additionally expose a direct review URL in the row; preserve
    it only when it is one of our explicit read-only paths.
    """
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    for node in soup.select('li[onclick*="goTask"][data], a[onclick*="goTask"][data]'):
        raw_url = str(node.get("data") or "")
        url = read_url(raw_url, base)
        if not url:
            continue
        work_id = query(url, "workId", "workid", "id")
        if not work_id:
            continue
        row = node.find_parent(["li", "tr"]) or node
        title_node = row.select_one(".workTit,.overHidden2,h1,h2,h3,h4,.title,.name")
        label = text(title_node) or text(row)
        title = label.split(";")[0].strip() or f"作业 {work_id}"
        counts = {}
        for name, term in (("submitted_count", "已提交|已交"), ("unsubmitted_count", "未提交|未交")):
            match = re.search(rf"(\d+)\s*人?\s*(?:{term})|(?:{term})\s*[:：]?\s*(\d+)", text(row))
            counts[name] = int(match[1] or match[2]) if match else None
        # Only teacher-side pages can provide a roster/review entry point. A
        # student task URL is still useful metadata, but is not a candidate URL.
        review_urls = actions(row, base, r"/mooc-ans/work/selectWorkQuestion(?:YiPiYue)?$")
        review_url = review_urls[0] if review_urls else ""
        source_id = f"work:{work_id}"
        found[source_id] = dict(
            source_id=source_id,
            title=title,
            _url=review_url,
            item_type="作业",
            submitted_count=counts["submitted_count"],
            unsubmitted_count=counts["unsubmitted_count"],
        )
    return list(found.values())


def candidates(html: str, base: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    groups: dict[str, list[Tag]] = {}
    for index, row in enumerate(soup.select("tr, li.dataRow, .mark_item")):
        # A layout row carries only <th> cells. Treating one as a data row once
        # produced a fake student named "姓名" whose number was the header text.
        if row.find_parent("thead") is not None or row.find("td") is None:
            continue
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

        urls = actions(row, base, r"/exam/test/markpaper$|/mooc-ans/work/selectWorkQuestion(?:YiPiYue)?$")
        url = urls[0] if urls else ""
        # Every identity field comes from a data cell, never from a header cell.
        name = field('td[data-field="createUserName"], td.studentName, td.stuName, td[data-name]')
        student_no = field('td[data-field="loginName"], td[data-student-no], td.studentNo, td.stuNo')
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
        # The row's own cell id belongs to this candidate. A list URL may repeat
        # one relation id for every row, which would collapse the roster into a
        # single entry, so it is only the fallback.
        source_id = field('td[data-field="id"]') or query(url, "id", "testUserRelationId", "studentId")
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
        type_label = (
            str(type_node.get("value", ""))
            if type_node
            else text(container.select_one(".colorShallow,.questionType,.mark_type"))
        )
        # The live page prints the type together with its full score, e.g.
        # "(单选题, 2.0分)". Keep the bare type for display and routing, and read
        # the score out of that label: objective questions carry no score field
        # at all, and without the full score neither the paper total nor the
        # objective marks can be resolved.
        match = re.search(r"([\u4e00-\u9fa5]{1,8}题)", type_label)
        if match is None:
            # Not every provider type ends in 题: "(名词解释, 20.0分)" is a single
            # label, and the score must not travel inside the displayed type.
            match = re.search(r"[（(]\s*([\u4e00-\u9fa5]{2,8})\s*[,，]", type_label)
        question_type = match[1] if match else type_label
        full_score = container.select_one('input[id^="fullScore"]')
        label_score = re.search(r"(\d+(?:\.\d+)?)\s*分", type_label)
        placeholder = re.search(r"0\s*[-~—]\s*(\d+(?:\.\d+)?)", str(score.get("placeholder") or ""))
        max_score = number(
            score.get("data-max-score")
            or container.get("data2")
            or (full_score.get("value") if full_score else None)
            or (label_score[1] if label_score else None)
            or (placeholder[1] if placeholder else None)
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
        # A human is needed when the answer itself lives in a file we cannot read.
        # Counting every <a>/<img> in the answer area flagged all 42 questions of
        # a live paper as "needs a human", which kept the subjective ones — the
        # only ones AI grading can help with — out of the queue entirely.
        attachment = bool(answer_container) and (
            answer_container.select_one("img[src]") is not None
            or any(
                re.search(r"download|attachment|file", str(link.get("href", "")), re.I)
                for link in answer_container.select("a[href]")
            )
        )
        stem = answer_text(container.select_one(".hiddenTitle,.questionStem,.Zy_TItle,.qtContent,.stem,.mark_name"))
        question_content = stem
        if re.search(r"选择|单选|多选", question_type):
            options = choice_options(container)
            if options:
                question_content = "\n".join([" ".join(stem.split()), *(option for option in options if option not in stem)])
        student_answer = answer_text(student)
        # The label decides whether a question is objective, because CSS classes are
        # the provider's rendering detail; the class is only the fallback for labels
        # this reader does not recognize. Keeping the split identical to the rest of
        # the project is what keeps the platform's own marks out of the AI queue.
        objective_by_label = is_objective(question_type)
        found[str(qid)] = dict(
            source_id=str(qid),
            question_type=question_type,
            content=question_content,
            student_answer=student_answer,
            reference_answer=answer_text(reference),
            max_score=max_score,
            source_score=number(score.get("value")),
            objective=(
                "objective" in container.get("class", [])
                if objective_by_label is None
                else objective_by_label
            ),
            requires_manual_review=max_score is None or student is None or (attachment and not student_answer),
        )
    full = soup.select_one("#examFullScore")
    return dict(questions=list(found.values()), declared_max_score=number(full.get("value")) if full else None)
