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
