from scripts.seed_standard_job_models import STANDARD_MODELS


EXPECTED_LARGE_MODEL_ROLES = {
    "大模型集群研发和运维工程师": "架构",
    "深度学习框架研发工程师": "架构",
    "大模型算法工程师": "算法",
    "大模型策略研发工程师": "算法",
    "大模型数据工程师": "数据",
    "大模型评测工程师": "评测",
    "大模型提示词工程师": "应用",
    "大模型应用开发工程师": "应用",
}

EXPECTED_OPEN_SOURCE_ROLES = {
    "开源开发者": "开发",
    "开源研发工程师": "开发",
    "开源合规协作者": "合规",
    "开源合规经理": "合规",
    "开源社区运营经理": "运营",
    "开源专家": "战略",
}

EXPECTED_GARMENT_ROLES = {
    "服装制版师": "设计",
    "服装模板制作师": "设计",
    "服装裁剪工": "制造",
    "服装制作工": "制造",
    "服装缝盘工": "制造",
    "服装整烫工": "制造",
    "服装生产线管理员": "运营服务类",
    "服装生产数据分析师": "数据分析",
}

EXPECTED_BIOMEDICAL_ROLES = {
    "细胞治疗药物研发研究员": "生物药品制品制造",
    "蛋白药物研发研究员": "生物药品制品制造",
    "偶联药物研发研究员": "生物药品制品制造",
    "疫苗开发研究员": "生物药品制品制造",
    "核酸药物研发研究员": "生物药品制品制造",
    "合成生物学研究员": "生物药品制品制造",
    "微生物分析研究员": "生物药品制品制造",
    "细胞培养工程师": "生物药品制品制造",
    "蛋白纯化工程师": "生物药品制品制造",
    "生物药品制品制剂研究员": "生物药品制品制造",
    "生物药品制品药物分析研究员": "生物药品制品制造",
    "生物药品制品质量管理专员": "生物药品制品制造",
    "基因治疗药物研发研究员": "生物药品制品制造",
    "化学药品研发研究员": "化学药品与原料药制造",
    "化学药品制剂研究员": "化学药品与原料药制造",
    "化学药品分析研究员": "化学药品与原料药制造",
    "诊断试剂研发工程师": "化学药品与原料药制造",
    "化学药品质量管理专员": "化学药品与原料药制造",
    "制药装备研发工程师": "生物医药关键装备与原辅料制造",
    "制药装备生产工程师": "生物医药关键装备与原辅料制造",
    "药用辅料及包装材料研发工程师": "生物医药关键装备与原辅料制造",
    "药用辅料及包装材料生产工程师": "生物医药关键装备与原辅料制造",
    "药用辅料及包装材料质检工程师": "生物医药关键装备与原辅料制造",
    "临床研究员": "生物医药相关服务",
    "AI+临床研究工程师": "生物医药相关服务",
    "临床协调员": "生物医药相关服务",
    "临床监察员": "生物医药相关服务",
    "AI+药物发现工程师": "生物医药相关服务",
    "生物信息工程师": "生物医药相关服务",
    "模式动物研究员": "生物医药相关服务",
    "药品数据专员": "生物医药相关服务",
    "药物警戒专员": "生物医药相关服务",
    "产品注册与法规专员": "生物医药相关服务",
    "市场推广专员": "生物医药相关服务",
}


SOURCE_NOTE = "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》"
OPEN_SOURCE_SOURCE_NOTE = "来源：T/MIITEC 018-2024《开源人才能力要求与评价规范》"
GARMENT_SOURCE_NOTE = "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》"
BIOMEDICAL_SOURCE_NOTE = "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》"


def _find_model(job_role: str) -> dict | None:
    for model in STANDARD_MODELS:
        if model["job_role"] == job_role:
            return model
    return None


def _assert_three_dimensions_with_content(job_role: str) -> None:
    model = _find_model(job_role)

    assert model is not None
    assert [dimension["name"] for dimension in model["dimensions"]] == [
        "专业知识",
        "技术技能",
        "工程实践",
    ]

    for dimension in model["dimensions"]:
        assert dimension["skills"]
        for skill in dimension["skills"]:
            assert skill["level"] == "L3"
            assert skill["knowledge_points"]


def test_large_model_roles_are_seeded_with_expected_directions() -> None:
    for job_role, direction_name in EXPECTED_LARGE_MODEL_ROLES.items():
        model = _find_model(job_role)

        assert model is not None
        assert model["industry_name"] == "人工智能"
        assert model["direction_name"] == direction_name
        assert model["version_note"] == SOURCE_NOTE


def test_large_model_roles_have_three_core_dimensions_and_non_empty_content() -> None:
    for job_role in EXPECTED_LARGE_MODEL_ROLES:
        _assert_three_dimensions_with_content(job_role)


def test_open_source_roles_are_seeded_with_expected_directions() -> None:
    for job_role, direction_name in EXPECTED_OPEN_SOURCE_ROLES.items():
        model = _find_model(job_role)

        assert model is not None
        assert model["industry_name"] == "开源"
        assert model["direction_name"] == direction_name
        assert model["version_note"] == OPEN_SOURCE_SOURCE_NOTE


def test_open_source_roles_have_three_core_dimensions_and_non_empty_content() -> None:
    for job_role in EXPECTED_OPEN_SOURCE_ROLES:
        _assert_three_dimensions_with_content(job_role)


def test_garment_roles_are_seeded_with_expected_directions() -> None:
    for job_role, direction_name in EXPECTED_GARMENT_ROLES.items():
        model = _find_model(job_role)

        assert model is not None
        assert model["industry_name"] == "服装产业"
        assert model["direction_name"] == direction_name
        assert model["version_note"] == GARMENT_SOURCE_NOTE


def test_garment_roles_have_three_core_dimensions_and_non_empty_content() -> None:
    for job_role in EXPECTED_GARMENT_ROLES:
        _assert_three_dimensions_with_content(job_role)


def test_biomedical_roles_are_seeded_with_expected_directions() -> None:
    for job_role, direction_name in EXPECTED_BIOMEDICAL_ROLES.items():
        model = _find_model(job_role)

        assert model is not None
        assert model["industry_name"] == "生物医药"
        assert model["direction_name"] == direction_name
        assert model["version_note"] == BIOMEDICAL_SOURCE_NOTE


def test_biomedical_roles_have_three_core_dimensions_and_non_empty_content() -> None:
    for job_role in EXPECTED_BIOMEDICAL_ROLES:
        _assert_three_dimensions_with_content(job_role)
