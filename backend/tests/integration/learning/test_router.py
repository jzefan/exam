"""Integration tests for knowledge management API."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_and_list_majors(admin_client: AsyncClient):
    resp = await admin_client.post("/api/knowledge/majors", json={"name": "Computer Science"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Computer Science"

    resp = await admin_client.get("/api/knowledge/majors")
    assert resp.status_code == 200
    names = [major["name"] for major in resp.json()]
    assert "Computer Science" in names


@pytest.mark.asyncio
async def test_create_direction_and_get_tree(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "Math"})).json()
    direction = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "Algebra"},
        )
    ).json()
    direction_id = direction["id"]

    kp = (
        await admin_client.post(
            "/api/knowledge/knowledge-points",
            json={
                "direction_id": direction_id,
                "name": "Linear Equations",
                "tags": ["algebra"],
                "difficulty": "入门",
            },
        )
    ).json()
    assert kp["name"] == "Linear Equations"

    tree = (await admin_client.get(f"/api/knowledge/directions/{direction_id}/tree")).json()
    assert len(tree["nodes"]) == 1
    assert tree["nodes"][0]["data"]["name"] == "Linear Equations"
    assert tree["edges"] == []


@pytest.mark.asyncio
async def test_admin_lists_new_direction_before_knowledge_points_exist(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "Physics"})).json()

    response = await admin_client.post(
        "/api/knowledge/directions",
        json={"major_id": major["id"], "name": "Mechanics"},
    )
    assert response.status_code == 201

    response = await admin_client.get(f"/api/knowledge/majors/{major['id']}/directions")
    assert response.status_code == 200
    assert [direction["name"] for direction in response.json()] == ["Mechanics"]


@pytest.mark.asyncio
async def test_prerequisite_cycle_returns_400(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "CS2"})).json()
    direction = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "Algorithms"},
        )
    ).json()
    did = direction["id"]

    a = (await admin_client.post("/api/knowledge/knowledge-points", json={"direction_id": did, "name": "A"})).json()
    b = (await admin_client.post("/api/knowledge/knowledge-points", json={"direction_id": did, "name": "B"})).json()

    resp = await admin_client.post(
        f"/api/knowledge/knowledge-points/{b['id']}/prerequisites",
        json={"from_id": a["id"]},
    )
    assert resp.status_code == 201

    resp = await admin_client.post(
        f"/api/knowledge/knowledge-points/{a['id']}/prerequisites",
        json={"from_id": b["id"]},
    )
    assert resp.status_code == 400
    assert "cycle" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_soft_delete_cascades_to_children(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "CS3"})).json()
    direction = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "DS"},
        )
    ).json()
    did = direction["id"]

    parent = (
        await admin_client.post("/api/knowledge/knowledge-points", json={"direction_id": did, "name": "Parent"})
    ).json()
    child = (
        await admin_client.post(
            "/api/knowledge/knowledge-points",
            json={"direction_id": did, "name": "Child", "parent_id": parent["id"]},
        )
    ).json()
    assert child["name"] == "Child"

    resp = await admin_client.delete(f"/api/knowledge/knowledge-points/{parent['id']}")
    assert resp.status_code == 204

    tree = (await admin_client.get(f"/api/knowledge/directions/{did}/tree")).json()
    assert tree["nodes"] == []


@pytest.mark.asyncio
async def test_catalog_photo_recognize_returns_paths(admin_client: AsyncClient, monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeResponse

    async def fake_recognize(_request):
        return CatalogPhotoRecognizeResponse(
            paths=[
                ["第1章 数据库系统概述", "1.1 数据模型"],
                ["第1章 数据库系统概述", "1.2 数据独立性"],
            ]
        )

    monkeypatch.setattr("app.learning.service.recognize_catalog_structure_from_images", fake_recognize)

    response = await admin_client.post(
        "/api/knowledge/catalog-photo/recognize",
        json={
            "file_name": "catalog.png",
            "images": ["data:image/png;base64,ZmFrZQ=="],
            "model": "qwen",
        },
    )

    assert response.status_code == 200
    assert response.json()["paths"][0] == ["第1章 数据库系统概述", "1.1 数据模型"]


def test_parse_catalog_paths_from_paddle_ocr_text():
    from app.learning.service import _parse_catalog_paths_from_text

    paths = _parse_catalog_paths_from_text(
        """
        目录
        第1章 数据库系统概述 ........ 1
        1.1 数据模型 3
        1.1.1 关系模型 5
        1.2 数据独立性 12
        1.3 数据库语言 . 24
        1.4 数据库设计 —— 31
        第2章 关系数据库
        2.1 关系代数
        """
    )

    assert paths == [
        ["第1章 数据库系统概述"],
        ["第1章 数据库系统概述", "1.1 数据模型"],
        ["第1章 数据库系统概述", "1.1 数据模型", "1.1.1 关系模型"],
        ["第1章 数据库系统概述", "1.2 数据独立性"],
        ["第1章 数据库系统概述", "1.3 数据库语言"],
        ["第1章 数据库系统概述", "1.4 数据库设计"],
        ["第2章 关系数据库"],
        ["第2章 关系数据库", "2.1 关系代数"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_uses_paddle_ocr_text(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_image_text(_image: str) -> str:
        return "第1章 数据库系统概述\n1.1 数据模型\n1.2 数据独立性"

    monkeypatch.setattr("app.learning.service.recognize_image_text", fake_recognize_image_text)

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(file_name="catalog.png", images=["data:image/png;base64,ZmFrZQ=="])
    )

    assert response.paths == [
        ["第1章 数据库系统概述"],
        ["第1章 数据库系统概述", "1.1 数据模型"],
        ["第1章 数据库系统概述", "1.2 数据独立性"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_returns_friendly_error_when_ocr_engine_missing(monkeypatch):
    from app.learning.ocr import OCREngineUnavailable
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_image_text(_image: str) -> str:
        raise OCREngineUnavailable("PaddleOCR is not installed")

    monkeypatch.setattr("app.learning.service.recognize_image_text", fake_recognize_image_text)

    with pytest.raises(RuntimeError, match="目录识别服务暂不可用，请联系管理员处理"):
        await recognize_catalog_structure_from_images(
            CatalogPhotoRecognizeRequest(file_name="catalog.png", images=["data:image/png;base64,ZmFrZQ=="])
        )
