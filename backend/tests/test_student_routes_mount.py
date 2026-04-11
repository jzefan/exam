import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_student_exam_routes_are_mounted(client: AsyncClient) -> None:
    response = await client.post(f"/api/student/exams/{uuid.uuid4()}/start")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_wrong_answer_routes_are_mounted(client: AsyncClient) -> None:
    response = await client.get("/api/wrong-answers")

    assert response.status_code == 401
