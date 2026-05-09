import uuid

from app.papers.service import build_paper_generation_profile


def test_build_paper_generation_profile_inherits_type_distribution():
    source = [
        {"type": "choice", "difficulty": 2, "knowledge_point_ids": ["kp1"]},
        {"type": "choice", "difficulty": 4, "knowledge_point_ids": ["kp1"]},
        {"type": "short_answer", "difficulty": 3, "knowledge_point_ids": ["kp2"]},
    ]
    profile = build_paper_generation_profile(source, root_knowledge_point_id="kp-root", difficulty_strategy="similar")
    assert profile.total_count == 3
    assert profile.type_distribution == {"choice": 2, "short_answer": 1}
    assert profile.difficulty == 3
    assert profile.knowledge_point_ids == ["kp-root"]


def test_build_paper_generation_profile_applies_difficulty_strategy_with_bounds():
    source = [
        {"type": "choice", "difficulty": 5, "knowledge_point_ids": []},
        {"type": "short_answer", "difficulty": 5, "knowledge_point_ids": []},
    ]
    root_id = uuid.uuid4()

    harder = build_paper_generation_profile(source, root_knowledge_point_id=root_id, difficulty_strategy="harder")
    easier = build_paper_generation_profile(source, root_knowledge_point_id=None, difficulty_strategy="easier")

    assert harder.difficulty == 5
    assert harder.knowledge_point_ids == [root_id]
    assert easier.difficulty == 4
    assert easier.knowledge_point_ids == []
