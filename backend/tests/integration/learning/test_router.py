"""Integration tests for knowledge management API."""

import asyncio

import pytest
from httpx import AsyncClient


@pytest.fixture(autouse=True)
def prevent_real_catalog_qwen_requests(monkeypatch):
    async def unavailable_qwen(_images: list[str]) -> list[list[str]]:
        raise RuntimeError("未配置 Qwen API Key，请联系管理员。")

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_qwen_vl",
        unavailable_qwen,
    )


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
async def test_root_knowledge_point_names_are_unique_within_major(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "Knowledge Major"})).json()
    direction_a = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "方向A"},
        )
    ).json()
    direction_b = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "方向B"},
        )
    ).json()

    first = await admin_client.post(
        "/api/knowledge/knowledge-points",
        json={"direction_id": direction_a["id"], "name": "计算机网络"},
    )
    assert first.status_code == 201

    duplicate = await admin_client.post(
        "/api/knowledge/knowledge-points",
        json={"direction_id": direction_b["id"], "name": "计算机网络"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "该专业下已存在同名主知识点"


@pytest.mark.asyncio
async def test_root_knowledge_point_options_include_major_aggregated_details(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "Aggregated Major"})).json()
    direction_a = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "方向A"},
        )
    ).json()
    direction_b = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "方向B"},
        )
    ).json()
    await admin_client.post(
        "/api/knowledge/knowledge-points",
        json={"direction_id": direction_a["id"], "name": "操作系统", "difficulty": "中级"},
    )
    await admin_client.post(
        "/api/knowledge/knowledge-points",
        json={"direction_id": direction_b["id"], "name": "计算机网络", "difficulty": "初级"},
    )

    response = await admin_client.get("/api/knowledge/root-knowledge-points")

    assert response.status_code == 200
    items = [item for item in response.json() if item["major_id"] == major["id"]]
    assert [item["name"] for item in items] == ["操作系统", "计算机网络"]
    assert {item["direction_name"] for item in items} == {"方向A", "方向B"}
    assert all(item["parent_id"] is None for item in items)
    assert all("question_count" in item for item in items)


@pytest.mark.asyncio
async def test_update_knowledge_point_can_move_root_under_another_root(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "Move Root Major"})).json()
    direction_a = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "方向A"},
        )
    ).json()
    direction_b = (
        await admin_client.post(
            "/api/knowledge/directions",
            json={"major_id": major["id"], "name": "方向B"},
        )
    ).json()
    source = (
        await admin_client.post(
            "/api/knowledge/knowledge-points",
            json={"direction_id": direction_a["id"], "name": "Python 数据分析"},
        )
    ).json()
    child = (
        await admin_client.post(
            "/api/knowledge/knowledge-points",
            json={
                "direction_id": direction_a["id"],
                "parent_id": source["id"],
                "name": "NumPy 基础",
            },
        )
    ).json()
    target = (
        await admin_client.post(
            "/api/knowledge/knowledge-points",
            json={"direction_id": direction_b["id"], "name": "卫生信息管理"},
        )
    ).json()

    response = await admin_client.put(
        f"/api/knowledge/knowledge-points/{source['id']}",
        json={"parent_id": target["id"]},
    )

    assert response.status_code == 200
    old_tree = (await admin_client.get(f"/api/knowledge/directions/{direction_a['id']}/tree")).json()
    assert old_tree["nodes"] == []
    new_tree = (await admin_client.get(f"/api/knowledge/directions/{direction_b['id']}/tree")).json()
    by_id = {node["id"]: node["data"] for node in new_tree["nodes"]}
    assert by_id[source["id"]]["parent_id"] == target["id"]
    assert by_id[source["id"]]["direction_id"] == direction_b["id"]
    assert by_id[child["id"]]["direction_id"] == direction_b["id"]


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


def test_parse_catalog_paths_from_recognized_text():
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


def test_catalog_photo_prompt_keeps_two_column_reading_order():
    from app.learning.service import _CATALOG_VL_PROMPT

    assert "先完整读取最左栏的所有条目，再依次读取右侧各栏" in _CATALOG_VL_PROMPT
    assert "必须从该栏最上方第一条带编号目录行开始" in _CATALOG_VL_PROMPT
    assert "右栏顶部的放大复核裁片" in _CATALOG_VL_PROMPT
    assert "最上方和最下方的带编号目录行" in _CATALOG_VL_PROMPT
    assert "跳过学习目标、小结、实训" in _CATALOG_VL_PROMPT


def test_catalog_photo_keeps_consecutive_decimal_siblings_at_same_level():
    from app.learning.service import _merge_catalog_paths

    paths = _merge_catalog_paths(
        [
            [
                ["第2章 数据的读取与处理"],
                ["第2章 数据的读取与处理", "2.2 处理数据"],
                ["第2章 数据的读取与处理", "2.2 处理数据", "2.2.2 清洗数据"],
            ],
            [
                [
                    "第2章 数据的读取与处理",
                    "2.2.2 清洗数据",
                    "2.2.3 合并数据",
                ]
            ],
        ]
    )

    assert ["第2章 数据的读取与处理", "2.2 处理数据", "2.2.3 合并数据"] in paths
    assert [
        "第2章 数据的读取与处理",
        "2.2 处理数据",
        "2.2.2 清洗数据",
        "2.2.3 合并数据",
    ] not in paths


def test_catalog_photo_restores_parent_when_decimal_number_has_no_space():
    from app.learning.service import _merge_catalog_paths

    paths = _merge_catalog_paths(
        [
            [
                ["第2章 数据的读取与处理"],
                ["第2章 数据的读取与处理", "2.2处理数据"],
                ["第2章 数据的读取与处理", "2.2处理数据", "2.2.2清洗数据"],
            ],
            [["2.2.3合并数据"]],
        ]
    )

    assert [
        "第2章 数据的读取与处理",
        "2.2 处理数据",
        "2.2.3 合并数据",
    ] in paths


@pytest.mark.asyncio
async def test_catalog_photo_restores_missing_intermediate_numbered_parents(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(_images: list[str]) -> list[list[str]]:
        return [
            ["第8章 互联网上的音频/视频服务"],
            ["第8章 互联网上的音频/视频服务", "8.2 流式存储音频/视频"],
            ["第8章 互联网上的音频/视频服务", "8.2.1 具有无文件的万维网服务器"],
            ["第8章 互联网上的音频/视频服务", "8.2.2 媒体服务器"],
            ["第8章 互联网上的音频/视频服务", "8.3 交互式音频/视频"],
        ]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(file_name="catalog.png", images=["image-1"])
    )

    assert response.paths == [
        ["第8章 互联网上的音频/视频服务"],
        ["第8章 互联网上的音频/视频服务", "8.2 流式存储音频/视频"],
        ["第8章 互联网上的音频/视频服务", "8.2 流式存储音频/视频", "8.2.1 具有无文件的万维网服务器"],
        ["第8章 互联网上的音频/视频服务", "8.2 流式存储音频/视频", "8.2.2 媒体服务器"],
        ["第8章 互联网上的音频/视频服务", "8.3 交互式音频/视频"],
    ]


def test_catalog_chapter_key_matches_arabic_and_chinese_chapter_numbering():
    from app.learning.service import _catalog_chapter_key_for_segment

    assert _catalog_chapter_key_for_segment("第6章 应用层") == "6"
    assert _catalog_chapter_key_for_segment("第六篇 计算机网络体系结构") == "6"
    assert _catalog_chapter_key_for_segment("第2编 数据结构") == "2"
    assert _catalog_chapter_key_for_segment("第3单元 网络协议") == "3"
    assert _catalog_chapter_key_for_segment("第4部分 操作系统") == "4"
    assert _catalog_chapter_key_for_segment("第十章 网络安全") == "10"
    assert _catalog_chapter_key_for_segment("第十一章 密码学基础") == "11"
    assert _catalog_chapter_key_for_segment("Chapter 10 Network Security") == "10"
    assert _catalog_chapter_key_for_segment("Unit 11 Cryptography") == "11"
    assert _catalog_chapter_key_for_segment("Part III Application Layer") == "3"
    assert _catalog_chapter_key_for_segment("10.1 网络安全概述") == "10"
    assert _catalog_chapter_key_for_segment("11.2.3 对称加密") == "11"


def test_catalog_line_level_supports_common_chinese_and_english_directory_formats():
    from app.learning.service import _catalog_line_level

    assert _catalog_line_level("第六篇 计算机网络体系结构") == (1, "第六篇 计算机网络体系结构")
    assert _catalog_line_level("第2节 运输层协议") == (2, "第2节 运输层协议")
    assert _catalog_line_level("Chapter 10 Network Security") == (1, "Chapter 10 Network Security")
    assert _catalog_line_level("Unit 11 Cryptography") == (1, "Unit 11 Cryptography")
    assert _catalog_line_level("Section 11.2 Symmetric Encryption") == (2, "Section 11.2 Symmetric Encryption")


@pytest.mark.asyncio
async def test_catalog_photo_uses_qwen_vision_first(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_qwen_vl(_images: list[str]) -> list[list[str]]:
        return [
            ["第1章 数据库系统概述"],
            ["第1章 数据库系统概述", "1.1 数据模型"],
            ["第1章 数据库系统概述", "1.2 数据独立性"],
        ]

    async def fake_recognize_catalog_with_deepseek_vl(_images: list[str]) -> list[list[str]]:
        raise AssertionError("Qwen 可用时不应调用 DeepSeek")

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_qwen_vl",
        fake_recognize_catalog_with_qwen_vl,
    )
    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(file_name="catalog.png", images=["data:image/png;base64,ZmFrZQ=="])
    )

    assert response.paths == [
        ["第1章 数据库系统概述"],
        ["第1章 数据库系统概述", "1.1 数据模型"],
        ["第1章 数据库系统概述", "1.2 数据独立性"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_falls_back_to_deepseek_when_qwen_unavailable(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_qwen_vl(_images: list[str]) -> list[list[str]]:
        raise RuntimeError("未配置 Qwen API Key，请联系管理员。")

    async def fake_recognize_catalog_with_deepseek_vl(_images: list[str]) -> list[list[str]]:
        return [["第1章 数据库系统概述", "1.1 数据模型"]]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )
    monkeypatch.setattr("app.learning.service._recognize_catalog_with_qwen_vl", fake_recognize_catalog_with_qwen_vl)

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(file_name="catalog.png", images=["data:image/png;base64,ZmFrZQ=="])
    )

    assert response.paths == [["第1章 数据库系统概述", "1.1 数据模型"]]


@pytest.mark.asyncio
async def test_catalog_photo_treats_text_only_deepseek_model_as_unavailable(monkeypatch):
    from app.config import settings
    from app.learning.service import _is_provider_unavailable_error, _recognize_catalog_with_deepseek_vl

    monkeypatch.setattr(settings, "deepseek_api_key", "fake-key")
    monkeypatch.setattr(settings, "deepseek_model_name", "deepseek-flash")

    with pytest.raises(RuntimeError) as exc_info:
        await _recognize_catalog_with_deepseek_vl(["data:image/png;base64,ZmFrZQ=="])

    assert "视觉模型未配置" in str(exc_info.value)
    assert _is_provider_unavailable_error(exc_info.value)


@pytest.mark.asyncio
async def test_catalog_photo_falls_back_to_deepseek_when_qwen_times_out(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_qwen_vl(_images: list[str]) -> list[list[str]]:
        await asyncio.sleep(0.05)
        return [["不应该使用这个结果"]]

    async def fake_recognize_catalog_with_deepseek_vl(_images: list[str]) -> list[list[str]]:
        return [["第1章 数据库系统概述", "1.1 数据模型"]]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )
    monkeypatch.setattr("app.learning.service._recognize_catalog_with_qwen_vl", fake_recognize_catalog_with_qwen_vl)
    monkeypatch.setattr("app.learning.service._CATALOG_SINGLE_IMAGE_TIMEOUT_SECONDS", 0.01)

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(file_name="catalog.png", images=["data:image/png;base64,ZmFrZQ=="])
    )

    assert response.paths == [["第1章 数据库系统概述", "1.1 数据模型"]]


@pytest.mark.asyncio
async def test_catalog_photo_recognizes_each_image_separately_and_merges_paths(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    calls: list[list[str]] = []

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        calls.append(images)
        assert len(images) == 1
        if images[0] == "image-1":
            return [
                ["第1章 数据库系统概述"],
                ["第1章 数据库系统概述", "1.1 数据模型"],
            ]
        if images[0] == "image-2":
            return [
                ["第1章 数据库系统概述", "1.1 数据模型"],
                ["第1章 数据库系统概述", "1.2 数据独立性"],
            ]
        return [["第2章 关系数据库"]]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["image-1", "image-2", "image-3"],
        )
    )

    assert sorted(calls) == [["image-1"], ["image-2"], ["image-3"]]
    assert response.paths == [
        ["第1章 数据库系统概述"],
        ["第1章 数据库系统概述", "1.1 数据模型"],
        ["第1章 数据库系统概述", "1.2 数据独立性"],
        ["第2章 关系数据库"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_recognizes_columns_strictly_in_reading_order(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    left_column_finished = asyncio.Event()
    calls: list[list[str]] = []

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        calls.append(images)
        if images == ["left-column"]:
            await left_column_finished.wait()
            return [
                ["第2章 数据的读取与处理"],
                ["第2章 数据的读取与处理", "2.2 处理数据"],
                ["第2章 数据的读取与处理", "2.2 处理数据", "2.2.2 清洗数据"],
            ]
        if images == ["right-column-top"]:
            return [["2.2.3 合并数据"]]
        if images == ["right-column"]:
            return [["第3章 Matplotlib 数据可视化基础"]]
        return [["第4章 用 seaborn 绘制进阶图形"]]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    task = asyncio.create_task(
        recognize_catalog_structure_from_images(
            CatalogPhotoRecognizeRequest(
                file_name="catalog.png",
                images=["left-column", "right-column-top", "right-column", "next-page"],
                image_groups=[
                    ["left-column", "right-column-top", "right-column"],
                    ["next-page"],
                ],
            )
        )
    )
    await asyncio.sleep(0.01)
    calls_before_left_column_finishes = calls.copy()
    left_column_finished.set()
    response = await task

    assert calls_before_left_column_finishes == [["left-column"]]
    assert calls == [["left-column"], ["right-column-top"], ["right-column"], ["next-page"]]
    assert response.paths == [
        ["第2章 数据的读取与处理"],
        ["第2章 数据的读取与处理", "2.2 处理数据"],
        ["第2章 数据的读取与处理", "2.2 处理数据", "2.2.2 清洗数据"],
        ["第2章 数据的读取与处理", "2.2 处理数据", "2.2.3 合并数据"],
        ["第3章 Matplotlib 数据可视化基础"],
        ["第4章 用 seaborn 绘制进阶图形"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_keeps_chapter_started_in_right_column(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        match images:
            case ["page-one-left"]:
                return [
                    ["第2章 数据的读取与处理"],
                    ["第2章 数据的读取与处理", "2.2 处理数据"],
                    ["第2章 数据的读取与处理", "2.2 处理数据", "2.2.2 清洗数据"],
                ]
            case ["page-one-right"]:
                return [
                    ["2.2.3 合并数据"],
                    ["第3章 Matplotlib 数据可视化基础"],
                    ["第4章 用 seaborn 绘制进阶图形", "4.1 熟悉 seaborn 绘图基础"],
                ]
            case ["page-two-left"]:
                return [
                    ["4.1.3 熟悉 seaborn 的调色板"],
                    ["4.2 绘制关系图"],
                ]
        raise AssertionError(f"unexpected images: {images}")

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["page-one-left", "page-one-right", "page-two-left"],
            image_groups=[
                ["page-one-left", "page-one-right"],
                ["page-two-left"],
            ],
        )
    )

    assert response.paths == [
        ["第2章 数据的读取与处理"],
        ["第2章 数据的读取与处理", "2.2 处理数据"],
        ["第2章 数据的读取与处理", "2.2 处理数据", "2.2.2 清洗数据"],
        ["第2章 数据的读取与处理", "2.2 处理数据", "2.2.3 合并数据"],
        ["第3章 Matplotlib 数据可视化基础"],
        ["第4章 用 seaborn 绘制进阶图形", "4.1 熟悉 seaborn 绘图基础"],
        ["第4章 用 seaborn 绘制进阶图形", "4.1 熟悉 seaborn 绘图基础", "4.1.3 熟悉 seaborn 的调色板"],
        ["第4章 用 seaborn 绘制进阶图形", "4.2 绘制关系图"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_keeps_first_chapter_title_when_continuation_page_repeats_it_wrongly(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images == ["page-one"]:
            return [
                ["第4章 用 seaborn 绘制进阶图形"],
                ["第4章 用 seaborn 绘制进阶图形", "4.1 熟悉 seaborn 绘图基础"],
                ["第4章 用 seaborn 绘制进阶图形", "4.1 熟悉 seaborn 绘图基础", "4.1.2 了解 seaborn 的绘图风格"],
            ]
        if images == ["page-two-left"]:
            return [
                ["第4章 绘制图形"],
                ["第4章 绘制图形", "4.2 绘制关系图"],
                ["第4章 绘制图形", "4.2 绘制关系图", "4.2.5 绘制关系网格组合图"],
            ]
        raise AssertionError(f"unexpected images: {images}")

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.pdf",
            images=["page-one", "page-two-left"],
        )
    )

    assert response.paths == [
        ["第4章 用 seaborn 绘制进阶图形"],
        ["第4章 用 seaborn 绘制进阶图形", "4.1 熟悉 seaborn 绘图基础"],
        ["第4章 用 seaborn 绘制进阶图形", "4.1 熟悉 seaborn 绘图基础", "4.1.2 了解 seaborn 的绘图风格"],
        ["第4章 用 seaborn 绘制进阶图形", "4.2 绘制关系图"],
        ["第4章 用 seaborn 绘制进阶图形", "4.2 绘制关系图", "4.2.5 绘制关系网格组合图"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_merges_cross_page_children_back_under_previous_parents(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-1":
            return [
                ["第4章 网络层"],
                ["第4章 网络层", "4.2 网际协议 IP"],
                ["第4章 网络层", "4.2 网际协议 IP", "4.2.3 IP地址与MAC地址"],
            ]
        return [
            ["4.2.4 地址解析协议 ARP"],
            ["4.2.5 IP 数据报的格式"],
            ["4.3 IP 层转发分组的过程"],
        ]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["image-1", "image-2"],
        )
    )

    assert response.paths == [
        ["第4章 网络层"],
        ["第4章 网络层", "4.2 网际协议 IP"],
        ["第4章 网络层", "4.2 网际协议 IP", "4.2.3 IP地址与MAC地址"],
        ["第4章 网络层", "4.2 网际协议 IP", "4.2.4 地址解析协议 ARP"],
        ["第4章 网络层", "4.2 网际协议 IP", "4.2.5 IP 数据报的格式"],
        ["第4章 网络层", "4.3 IP 层转发分组的过程"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_skips_appendix_and_exercise_paths_when_merging(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-1":
            return [
                ["第4章 网络层"],
                ["第4章 网络层", "4.2 网际协议 IP"],
                ["第4章 网络层", "4.2 网际协议 IP", "4.2.4 地址解析协议 ARP"],
            ]
        return [
            ["第4章 网络层", "4.2 网际协议 IP", "4.2.5 IP 数据报的格式"],
            ["第4章 网络层", "4.2 网际协议 IP", "习题"],
            ["附录A 常见协议端口号"],
            ["Chapter 11 Cryptography", "Exercises"],
            ["第4章 网络层", "本章小结"],
            ["第4章 网络层", "小结"],
            ["第4章 网络层", "实训"],
            ["第4章 网络层", "实训 1 读取数据"],
            ["第4章 网络层", "练习题"],
            ["第4章 网络层", "4.3 IP 层转发分组的过程"],
        ]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["image-1", "image-2"],
        )
    )

    assert response.paths == [
        ["第4章 网络层"],
        ["第4章 网络层", "4.2 网际协议 IP"],
        ["第4章 网络层", "4.2 网际协议 IP", "4.2.4 地址解析协议 ARP"],
        ["第4章 网络层", "4.2 网际协议 IP", "4.2.5 IP 数据报的格式"],
        ["第4章 网络层", "4.3 IP 层转发分组的过程"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_reattaches_same_page_sections_when_chapter_heading_arrives_late(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-1":
            return [
                ["第5章 运输层"],
                ["第5章 运输层", "5.9 TCP的运输连接管理"],
                ["第5章 运输层", "5.9 TCP的运输连接管理", "5.9.3 TCP的有限状态机"],
            ]
        return [
            ["6.1 域名系统 DNS"],
            ["6.1 域名系统 DNS", "6.1.1 域名系统概述"],
            ["6.2 文件传送协议"],
            ["6.4 万维网 WWW"],
            ["第6章 应用层"],
            ["第6章 应用层", "6.5 电子邮件"],
            ["第6章 应用层", "6.5 电子邮件", "6.5.2 简单邮件传送协议 SMTP"],
        ]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["image-1", "image-2"],
        )
    )

    assert response.paths == [
        ["第5章 运输层"],
        ["第5章 运输层", "5.9 TCP的运输连接管理"],
        ["第5章 运输层", "5.9 TCP的运输连接管理", "5.9.3 TCP的有限状态机"],
        ["第6章 应用层"],
        ["第6章 应用层", "6.1 域名系统 DNS"],
        ["第6章 应用层", "6.1 域名系统 DNS", "6.1.1 域名系统概述"],
        ["第6章 应用层", "6.2 文件传送协议"],
        ["第6章 应用层", "6.4 万维网 WWW"],
        ["第6章 应用层", "6.5 电子邮件"],
        ["第6章 应用层", "6.5 电子邮件", "6.5.2 简单邮件传送协议 SMTP"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_reattaches_sections_for_double_digit_chapters(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-1":
            return [
                ["第9章 网络管理"],
                ["第9章 网络管理", "9.4 SNMP 协议"],
            ]
        return [
            ["10.1 网络安全概述"],
            ["10.2 防火墙"],
            ["第十章 网络安全"],
            ["第十章 网络安全", "10.3 入侵检测"],
            ["11.1 密码学概述"],
            ["第十一章 密码学基础"],
            ["第十一章 密码学基础", "11.2 对称加密"],
        ]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["image-1", "image-2"],
        )
    )

    assert response.paths == [
        ["第9章 网络管理"],
        ["第9章 网络管理", "9.4 SNMP 协议"],
        ["第十章 网络安全"],
        ["第十章 网络安全", "10.1 网络安全概述"],
        ["第十章 网络安全", "10.2 防火墙"],
        ["第十章 网络安全", "10.3 入侵检测"],
        ["第十一章 密码学基础"],
        ["第十一章 密码学基础", "11.1 密码学概述"],
        ["第十一章 密码学基础", "11.2 对称加密"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_supports_part_unit_and_english_chapter_anchors(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-1":
            return [
                ["2.1 栈与队列"],
                ["2.2 树与二叉树"],
                ["第2编 数据结构基础"],
                ["第2编 数据结构基础", "2.3 图"],
            ]
        return [
            ["11.1 Symmetric Encryption"],
            ["11.2 Asymmetric Encryption"],
            ["Chapter 11 Cryptography"],
            ["Chapter 11 Cryptography", "11.3 Hash Functions"],
        ]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["image-1", "image-2"],
        )
    )

    assert response.paths == [
        ["第2编 数据结构基础"],
        ["第2编 数据结构基础", "2.1 栈与队列"],
        ["第2编 数据结构基础", "2.2 树与二叉树"],
        ["第2编 数据结构基础", "2.3 图"],
        ["Chapter 11 Cryptography"],
        ["Chapter 11 Cryptography", "11.1 Symmetric Encryption"],
        ["Chapter 11 Cryptography", "11.2 Asymmetric Encryption"],
        ["Chapter 11 Cryptography", "11.3 Hash Functions"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_reattaches_previous_page_sections_when_chapter_anchor_appears_later(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-1":
            return [
                ["第2章 物理层"],
                ["第2章 物理层", "2.4 信道复用技术"],
                ["第2章 物理层", "2.4 信道复用技术", "2.4.3 码分复用"],
                ["3.1 数据链路层概述"],
                ["3.2 差错检测"],
                ["3.3 点对点协议 PPP"],
                ["3.4 局域网"],
            ]
        return [
            ["第3章 数据链路层"],
            ["第3章 数据链路层", "3.5 高速以太网"],
            ["第3章 数据链路层", "3.5.4 使用以太网进行宽带接入"],
            ["第4章 网络层"],
            ["第4章 网络层", "4.2 网际协议 IP"],
        ]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["image-1", "image-2"],
        )
    )

    assert response.paths == [
        ["第2章 物理层"],
        ["第2章 物理层", "2.4 信道复用技术"],
        ["第2章 物理层", "2.4 信道复用技术", "2.4.3 码分复用"],
        ["第3章 数据链路层"],
        ["第3章 数据链路层", "3.1 数据链路层概述"],
        ["第3章 数据链路层", "3.2 差错检测"],
        ["第3章 数据链路层", "3.3 点对点协议 PPP"],
        ["第3章 数据链路层", "3.4 局域网"],
        ["第3章 数据链路层", "3.5 高速以太网"],
        ["第3章 数据链路层", "3.5 高速以太网", "3.5.4 使用以太网进行宽带接入"],
        ["第4章 网络层"],
        ["第4章 网络层", "4.2 网际协议 IP"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_reattaches_deep_sections_when_previous_chapter_prefix_leaks(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-1":
            return [
                ["第2章 物理层"],
                ["第2章 物理层", "2.6 宽带接入技术"],
            ]
        return [
            ["第2章 物理层", "2.6 宽带接入技术", "3.1.1 数据链路和帧"],
            ["第2章 物理层", "2.6 宽带接入技术", "3.2.3 PPP 协议的工作状态"],
            ["第3章 数据链路层"],
            ["第3章 数据链路层", "3.1 数据链路层的几个共同问题"],
            ["第3章 数据链路层", "3.2 点对点协议 PPP"],
        ]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )

    response = await recognize_catalog_structure_from_images(
        CatalogPhotoRecognizeRequest(
            file_name="catalog.png",
            images=["image-1", "image-2"],
        )
    )

    assert response.paths == [
        ["第2章 物理层"],
        ["第2章 物理层", "2.6 宽带接入技术"],
        ["第3章 数据链路层"],
        ["第3章 数据链路层", "3.1 数据链路层的几个共同问题"],
        ["第3章 数据链路层", "3.1 数据链路层的几个共同问题", "3.1.1 数据链路和帧"],
        ["第3章 数据链路层", "3.2 点对点协议 PPP"],
        ["第3章 数据链路层", "3.2 点对点协议 PPP", "3.2.3 PPP 协议的工作状态"],
    ]


@pytest.mark.asyncio
async def test_catalog_photo_timeout_points_to_specific_image(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-2":
            await asyncio.sleep(0.05)
        return [["第1章 数据库系统概述"]]

    async def fake_recognize_catalog_with_qwen_vl(images: list[str]) -> list[list[str]]:
        if images[0] == "image-2":
            await asyncio.sleep(0.05)
        return [["第1章 数据库系统概述"]]

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )
    monkeypatch.setattr("app.learning.service._recognize_catalog_with_qwen_vl", fake_recognize_catalog_with_qwen_vl)
    monkeypatch.setattr("app.learning.service._CATALOG_SINGLE_IMAGE_TIMEOUT_SECONDS", 0.01)

    with pytest.raises(RuntimeError, match="第 2 张图片识别超时"):
        await recognize_catalog_structure_from_images(
            CatalogPhotoRecognizeRequest(
                file_name="catalog.png",
                images=["image-1", "image-2"],
            )
        )


@pytest.mark.asyncio
async def test_catalog_photo_returns_friendly_error_when_all_engines_missing(monkeypatch):
    from app.learning.schemas import CatalogPhotoRecognizeRequest
    from app.learning.service import recognize_catalog_structure_from_images

    async def fake_recognize_catalog_with_deepseek_vl(_images: list[str]) -> list[list[str]]:
        raise RuntimeError("未配置 DeepSeek API Key，请联系管理员。")

    async def fake_recognize_catalog_with_qwen_vl(_images: list[str]) -> list[list[str]]:
        raise RuntimeError("未配置 Qwen API Key，请联系管理员。")

    monkeypatch.setattr(
        "app.learning.service._recognize_catalog_with_deepseek_vl",
        fake_recognize_catalog_with_deepseek_vl,
    )
    monkeypatch.setattr("app.learning.service._recognize_catalog_with_qwen_vl", fake_recognize_catalog_with_qwen_vl)

    with pytest.raises(RuntimeError, match="目录识别服务暂不可用，请联系管理员处理"):
        await recognize_catalog_structure_from_images(
            CatalogPhotoRecognizeRequest(file_name="catalog.png", images=["data:image/png;base64,ZmFrZQ=="])
        )
