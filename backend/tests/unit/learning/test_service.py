"""Unit tests for knowledge management service — pure functions only."""

import uuid

from app.learning.service import build_flow_data, has_cycle


def make_id() -> str:
    return str(uuid.uuid4())


def test_no_cycle_returns_false():
    a, b, c = make_id(), make_id(), make_id()
    edges = [(a, b), (b, c)]
    assert has_cycle(edges, new_from=a, new_to=c) is False


def test_direct_cycle_returns_true():
    a, b = make_id(), make_id()
    edges = [(a, b)]
    assert has_cycle(edges, new_from=b, new_to=a) is True


def test_transitive_cycle_returns_true():
    a, b, c = make_id(), make_id(), make_id()
    edges = [(a, b), (b, c)]
    assert has_cycle(edges, new_from=c, new_to=a) is True


def test_self_loop_returns_true():
    a = make_id()
    assert has_cycle([], new_from=a, new_to=a) is True


def test_single_root_node_position():
    root_id = make_id()
    nodes = [
        {
            "id": root_id,
            "parent_id": None,
            "direction_id": None,
            "name": "Root",
            "description": None,
            "tags": [],
            "difficulty": None,
            "question_count": 0,
        }
    ]
    result = build_flow_data(nodes, [])
    assert len(result["nodes"]) == 1
    assert result["nodes"][0]["position"]["x"] == 0
    assert result["nodes"][0]["position"]["y"] == 0
    assert result["edges"] == []


def test_parent_child_produces_smoothstep_edge():
    parent_id, child_id = make_id(), make_id()
    nodes = [
        {
            "id": parent_id,
            "parent_id": None,
            "direction_id": None,
            "name": "Parent",
            "description": None,
            "tags": [],
            "difficulty": None,
            "question_count": 0,
        },
        {
            "id": child_id,
            "parent_id": parent_id,
            "direction_id": None,
            "name": "Child",
            "description": None,
            "tags": [],
            "difficulty": None,
            "question_count": 0,
        },
    ]
    result = build_flow_data(nodes, [])
    assert len(result["edges"]) == 1
    assert result["edges"][0]["type"] == "smoothstep"
    assert result["edges"][0]["source"] == parent_id
    assert result["edges"][0]["target"] == child_id


def test_prerequisite_produces_prerequisite_edge():
    a_id, b_id = make_id(), make_id()
    nodes = [
        {
            "id": a_id,
            "parent_id": None,
            "direction_id": None,
            "name": "A",
            "description": None,
            "tags": [],
            "difficulty": None,
            "question_count": 0,
        },
        {
            "id": b_id,
            "parent_id": None,
            "direction_id": None,
            "name": "B",
            "description": None,
            "tags": [],
            "difficulty": None,
            "question_count": 0,
        },
    ]
    prereqs = [{"from_id": a_id, "to_id": b_id}]
    result = build_flow_data(nodes, prereqs)
    prereq_edges = [edge for edge in result["edges"] if edge["type"] == "prerequisite"]
    assert len(prereq_edges) == 1
    assert prereq_edges[0]["source"] == a_id
    assert prereq_edges[0]["target"] == b_id


def test_child_x_is_greater_than_parent_x():
    parent_id, child_id = make_id(), make_id()
    nodes = [
        {
            "id": parent_id,
            "parent_id": None,
            "direction_id": None,
            "name": "P",
            "description": None,
            "tags": [],
            "difficulty": None,
            "question_count": 0,
        },
        {
            "id": child_id,
            "parent_id": parent_id,
            "direction_id": None,
            "name": "C",
            "description": None,
            "tags": [],
            "difficulty": None,
            "question_count": 0,
        },
    ]
    result = build_flow_data(nodes, [])
    parent_node = next(node for node in result["nodes"] if node["id"] == parent_id)
    child_node = next(node for node in result["nodes"] if node["id"] == child_id)
    assert child_node["position"]["x"] > parent_node["position"]["x"]
