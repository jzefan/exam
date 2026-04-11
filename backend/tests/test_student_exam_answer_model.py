import uuid

import pytest

from app.exams.models import StudentExamAnswer


@pytest.mark.asyncio
async def test_student_exam_answer_generates_id_on_flush(db_session) -> None:
    answer = StudentExamAnswer(
        exam_id=uuid.uuid4(),
        student_id=uuid.uuid4(),
        question_id=uuid.uuid4(),
        answer_content={"selected": ["A"]},
        score_awarded=1.0,
        is_correct=True,
        feedback={},
    )

    db_session.add(answer)
    await db_session.flush()

    assert answer.id is not None
