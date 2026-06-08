import uuid
from types import SimpleNamespace

from app.papers.service import (
    _build_generation_plan,
    _build_slot_ai_prompt,
    build_paper_generation_profile,
)
from app.questions.similarity import questions_are_too_similar


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


def test_slot_ai_prompt_uses_source_question_context_and_scope_rules():
    question = SimpleNamespace(
        type="code",
        difficulty=3,
        title="判断闰年",
        content={"text": "编写 Python 程序，输入年份并判断是否为闰年。"},
        options=None,
        answer={"text": "year = int(input())"},
        analysis="考查条件判断。",
        knowledge_points=[SimpleNamespace(name="程序流程控制")],
    )
    slot = SimpleNamespace(question=question, score_override=None)

    selected_question = SimpleNamespace(
        title="统计列表中的偶数数量",
        content={"text": "编写 Python 程序，统计列表中的偶数数量。"},
        options=None,
    )

    prompt = _build_slot_ai_prompt("请参考源试卷结构生成新题。", slot, [selected_question])

    assert "同一门课程、同一主知识点和同一子知识点" in prompt
    assert "不得迁移到语文、英语、文学、历史、常识或其它无关学科" in prompt
    assert "严禁生成与本卷已选题、源题重复或基本近似的题目" in prompt
    assert "本卷已选题摘要" in prompt
    assert "统计列表中的偶数数量" in prompt
    assert "源题题型：code" in prompt
    assert "源题知识点：程序流程控制" in prompt
    assert "编写 Python 程序" in prompt
    assert "若源题是编程题，新题也必须是编程任务" in prompt
    assert len(prompt) <= 1900


def test_generation_plan_allocates_type_and_knowledge_point_quotas():
    kp_loop = uuid.uuid4()
    kp_function = uuid.uuid4()

    def item(order: int, question_type: str, kp_id: uuid.UUID, kp_name: str):
        return SimpleNamespace(
            order=order,
            question_id=uuid.uuid4(),
            score_override=10,
            question=SimpleNamespace(
                type=question_type,
                difficulty=3,
                title=f"{kp_name}-{question_type}",
                content={"text": "源题内容"},
                options=None,
                answer={"text": "答案"},
                analysis="解析",
                score=10,
                knowledge_points=[SimpleNamespace(id=kp_id, name=kp_name)],
            ),
        )

    source_items = [
        item(0, "choice", kp_loop, "循环结构"),
        item(1, "choice", kp_loop, "循环结构"),
        item(2, "code", kp_function, "函数设计"),
    ]

    plan = _build_generation_plan(
        source_items,
        total_count=6,
        root_knowledge_point_id=None,
    )

    assert plan.type_distribution == {"choice": 4, "code": 2}
    assert plan.knowledge_distribution == {"循环结构": 4, "函数设计": 2}
    assert len(plan.slots) == 6
    assert [slot.question_type for slot in plan.slots].count("choice") == 4
    assert [slot.question_type for slot in plan.slots].count("code") == 2
    assert [slot.knowledge_key for slot in plan.slots].count(str(kp_loop)) == 4
    assert [slot.knowledge_key for slot in plan.slots].count(str(kp_function)) == 2

    loop_slot = next(slot for slot in plan.slots if slot.knowledge_key == str(kp_loop))
    prompt = _build_slot_ai_prompt("请参考源试卷结构生成新题。", loop_slot, [])

    assert "后端已完成本次模拟卷配额设计" in prompt
    assert "整卷题型配额为 choice 4题、code 2题" in prompt
    assert "整卷知识点配额为 循环结构 4题、函数设计 2题" in prompt
    assert "当前题型 choice 为第 1/4 题" in prompt
    assert "当前知识点「循环结构」为第 1/4 题" in prompt
    assert "必须按照这个题型和知识点生成" in prompt


def test_generation_plan_can_prefer_root_knowledge_point():
    root_id = uuid.uuid4()
    child_id = uuid.uuid4()
    source_item = SimpleNamespace(
        order=0,
        question_id=uuid.uuid4(),
        score_override=10,
        question=SimpleNamespace(
            type="choice",
            difficulty=3,
            title="源题",
            content={"text": "源题内容"},
            options=None,
            answer={"text": "答案"},
            analysis="解析",
            score=10,
            knowledge_points=[SimpleNamespace(id=child_id, name="子知识点")],
        ),
    )

    plan = _build_generation_plan(
        [source_item],
        total_count=2,
        root_knowledge_point_id=root_id,
        prefer_root_knowledge_point=True,
    )

    assert plan.knowledge_distribution == {"课程主知识": 2}
    assert all(slot.knowledge_point_ids == [root_id] for slot in plan.slots)
    assert all(slot.knowledge_label == "课程主知识" for slot in plan.slots)


def test_questions_are_too_similar_detects_reworded_duplicates():
    original = {
        "title": "判断闰年",
        "content": {"text": "编写 Python 程序，输入年份并判断是否为闰年。"},
        "options": None,
    }
    near_duplicate = {
        "title": "闰年判断程序",
        "content": {"text": "请编写一个 Python 程序，读取一个年份，判断该年份是否为闰年。"},
        "options": None,
    }
    distinct = {
        "title": "统计偶数数量",
        "content": {"text": "编写 Python 程序，统计列表中偶数的个数。"},
        "options": None,
    }

    assert questions_are_too_similar(original, near_duplicate)
    assert not questions_are_too_similar(original, distinct)
