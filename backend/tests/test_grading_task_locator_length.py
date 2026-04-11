from app.exams.student_router import _build_grading_task_payload


class _Exam:
    def __init__(self) -> None:
        self.title = "测试考试"


class _Question:
    def __init__(self) -> None:
        self.type = type("T", (), {"value": "short_answer"})()
        self.content = {"text": "<p>题目内容</p>"}
        self.title = "题目"
        self.answer = {"points": ["要点"]}


def test_exam_submission_source_business_id_fits_column_budget() -> None:
    exam_id = "5eb21de2-2e08-41c6-bcfd-669959add676"
    question_id = "f292e7de-c517-4f8b-bc1e-612ceaca1925"
    student_id = "2fa0f755-1532-4ca9-9376-f3146e8d978b"
    source_business_id = f"{exam_id}:{question_id}:{student_id}"

    payload = _build_grading_task_payload(
        exam=_Exam(),
        question=_Question(),
        question_score=10,
        answer_content={"html": "<p>答案</p>"},
        role_binding_version=1,
        source_business_id=source_business_id,
    )

    assert payload["source_business_id"] == source_business_id
    assert len(source_business_id) == 110
    assert len(source_business_id) <= 160
