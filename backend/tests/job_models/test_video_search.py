import pytest
from httpx import AsyncClient

from app.job_models import router as router_module


@pytest.fixture(autouse=True)
def _clear_bili_cache() -> None:
    router_module._bili_search_cache.clear()


@pytest.mark.asyncio
async def test_search_bilibili_videos_returns_results(
    admin_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_search(keyword: str, page: int) -> list[dict]:
        assert keyword == "函数"
        assert page == 1
        return [
            {
                "bvid": "BV123",
                "title": "<em class=\"keyword\">函数</em>入门",
                "author": "数学老师",
                "play": 12345,
                "duration": "12:30",
                "pic": "//i0.hdslb.com/bfs/archive/demo.jpg",
                "description": "函数基础",
            }
        ]

    monkeypatch.setattr(router_module, "_bilibili_search_via_library", fake_search)

    response = await admin_client.get("/api/job-models/models/search-videos", params={"keyword": "函数"})

    assert response.status_code == 200
    assert response.json() == [
        {
            "bvid": "BV123",
            "title": "函数入门",
            "author": "数学老师",
            "play": 12345,
            "duration": "12:30",
            "pic": "https://i0.hdslb.com/bfs/archive/demo.jpg",
            "description": "函数基础",
        }
    ]


@pytest.mark.asyncio
async def test_search_bilibili_videos_degrades_to_empty_list_when_blocked(
    admin_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_search(keyword: str, page: int) -> list[dict]:
        raise RuntimeError("风控拦截 -412")

    monkeypatch.setattr(router_module, "_bilibili_search_via_library", fake_search)

    response = await admin_client.get("/api/job-models/models/search-videos", params={"keyword": "函数"})

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_search_bilibili_videos_caches_results(
    admin_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    call_count = 0

    async def fake_search(keyword: str, page: int) -> list[dict]:
        nonlocal call_count
        call_count += 1
        return [
            {
                "bvid": "BV456",
                "title": "缓存测试",
                "author": "u",
                "play": 1,
                "duration": "1:00",
                "pic": "https://i0.hdslb.com/x.jpg",
                "description": "",
            }
        ]

    monkeypatch.setattr(router_module, "_bilibili_search_via_library", fake_search)

    r1 = await admin_client.get("/api/job-models/models/search-videos", params={"keyword": "缓存"})
    r2 = await admin_client.get("/api/job-models/models/search-videos", params={"keyword": "缓存"})

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert call_count == 1
