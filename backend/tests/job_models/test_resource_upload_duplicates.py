import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_upload_node_resource_rejects_duplicate_title_for_same_node(
    admin_client: AsyncClient,
) -> None:
    node_id = uuid.uuid4()
    files = {
        "file": (
            "可信数据空间画册_v2.pptx",
            b"first-content",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
    }
    data = {
        "title": "可信数据空间画册_v2.pptx",
        "node_type": "kp",
        "description": "",
    }

    first = await admin_client.post(
        f"/api/job-models/models/nodes/{node_id}/resources/upload",
        files=files,
        data=data,
    )
    assert first.status_code == 201

    second = await admin_client.post(
        f"/api/job-models/models/nodes/{node_id}/resources/upload",
        files={
            "file": (
                "可信数据空间画册_v2.pptx",
                b"second-content",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
        },
        data=data,
    )

    assert second.status_code == 400
    assert second.json()["detail"] == "当前知识点下已存在同名学习资料，请先删除或更换名称。"
