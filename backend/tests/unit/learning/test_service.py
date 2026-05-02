"""Unit tests for knowledge management service — pure functions only."""

import uuid

from app.learning.service import (
    _merge_catalog_paths,
    _restore_catalog_decimal_parents_from_all_paths,
    build_flow_data,
    has_cycle,
)


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


def test_restore_catalog_decimal_parents_prefers_matching_chapter_anchor_over_leaked_path():
    paths = [
        ["第6章 应用层", "6.1 域名系统 DNS"],
        ["第5章 运输层", "5.9 TCP的运输连接管理", "6.1 域名系统 DNS"],
        ["第6章 应用层", "6.1.1 域名系统概述"],
    ]

    assert _restore_catalog_decimal_parents_from_all_paths(paths) == [
        ["第6章 应用层", "6.1 域名系统 DNS"],
        ["第5章 运输层", "5.9 TCP的运输连接管理", "6.1 域名系统 DNS"],
        ["第6章 应用层", "6.1 域名系统 DNS", "6.1.1 域名系统概述"],
    ]


def test_merge_catalog_paths_recovers_chapter_six_when_previous_chapter_prefix_leaks():
    image_paths = [
        [
            ["第5章 运输层"],
            ["第5章 运输层", "5.9 TCP的运输连接管理"],
            ["第5章 运输层", "5.9 TCP的运输连接管理", "5.9.3 TCP的有限状态机"],
        ],
        [
            ["第5章 运输层", "5.9 TCP的运输连接管理", "6.1 域名系统 DNS"],
            ["第5章 运输层", "5.9 TCP的运输连接管理", "6.1 域名系统 DNS", "6.1.1 域名系统概述"],
            ["第5章 运输层", "5.9 TCP的运输连接管理", "6.2 文件传送协议"],
            ["第5章 运输层", "5.9 TCP的运输连接管理", "6.4 万维网 WWW"],
            ["第6章 应用层"],
            ["第6章 应用层", "6.5 电子邮件"],
            ["第6章 应用层", "6.5 电子邮件", "6.5.2 简单邮件传送协议 SMTP"],
        ],
    ]

    assert _merge_catalog_paths(image_paths) == [
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


def test_merge_catalog_paths_recovers_chapter_three_from_mixed_leaked_and_clean_sections():
    image_paths = [
        [
            ["第2章 物理层"],
            ["第2章 物理层", "2.4 信道复用技术"],
            ["第2章 物理层", "2.4 信道复用技术", "2.4.3 码分复用"],
            ["第2章 物理层", "2.4 信道复用技术", "3.1 数据链路层概述"],
            ["3.2 差错检测"],
            ["第2章 物理层", "2.4 信道复用技术", "3.3 点对点协议 PPP"],
            ["3.3 点对点协议 PPP", "3.3.5 以太网的 MAC 层"],
            ["3.4 扩展的以太网"],
        ],
        [
            ["第3章 数据链路层"],
            ["第3章 数据链路层", "3.5 高速以太网"],
            ["第3章 数据链路层", "3.5 高速以太网", "3.5.4 使用以太网进行宽带接入"],
            ["第4章 网络层"],
        ],
    ]

    assert _merge_catalog_paths(image_paths) == [
        ["第2章 物理层"],
        ["第2章 物理层", "2.4 信道复用技术"],
        ["第2章 物理层", "2.4 信道复用技术", "2.4.3 码分复用"],
        ["第3章 数据链路层"],
        ["第3章 数据链路层", "3.1 数据链路层概述"],
        ["第3章 数据链路层", "3.2 差错检测"],
        ["第3章 数据链路层", "3.3 点对点协议 PPP"],
        ["第3章 数据链路层", "3.3 点对点协议 PPP", "3.3.5 以太网的 MAC 层"],
        ["第3章 数据链路层", "3.4 扩展的以太网"],
        ["第3章 数据链路层", "3.5 高速以太网"],
        ["第3章 数据链路层", "3.5 高速以太网", "3.5.4 使用以太网进行宽带接入"],
        ["第4章 网络层"],
    ]


def test_merge_catalog_paths_keeps_dense_catalog_pages_with_many_siblings():
    image_paths = [
        [
            ["第1章 概述"],
            ["第1章 概述", "1.1 计算机网络在信息时代中的作用"],
            ["第1章 概述", "1.2 互联网概述"],
            ["第1章 概述", "1.2 互联网概述", "1.2.1 网络的网络"],
            ["第1章 概述", "1.2 互联网概述", "1.2.2 互联网基础结构发展的三个阶段"],
            ["第1章 概述", "1.3 互联网的组成"],
            ["第1章 概述", "1.3 互联网的组成", "1.3.1 互联网的边缘部分"],
            ["第1章 概述", "1.3 互联网的组成", "1.3.2 互联网的核心部分"],
            ["第1章 概述", "1.4 计算机网络在我国的发展"],
            ["第1章 概述", "1.5 计算机网络的类别"],
            ["第1章 概述", "1.5 计算机网络的类别", "1.5.1 计算机网络的定义"],
            ["第1章 概述", "1.6 计算机网络的性能"],
            ["第1章 概述", "1.6 计算机网络的性能", "1.6.1 计算机网络的性能指标"],
            ["第1章 概述", "1.7 计算机网络体系结构"],
            ["第1章 概述", "1.7 计算机网络体系结构", "1.7.5 TCP/IP 的体系结构"],
            ["本章的重要概念"],
            ["习题"],
            ["第2章 物理层"],
            ["第2章 物理层", "2.1 物理层的基本概念"],
            ["第2章 物理层", "2.2 数据通信的基础知识"],
            ["第2章 物理层", "2.2 数据通信的基础知识", "2.2.1 数据通信系统的模型"],
            ["第2章 物理层", "2.3 物理层下面的传输媒体"],
            ["第2章 物理层", "2.4 信道复用技术"],
            ["第2章 物理层", "2.4 信道复用技术", "2.4.1 频分复用、时分复用和统计时分复用"],
            ["第2章 物理层", "2.4 信道复用技术", "2.4.2 波分复用"],
            ["第2章 物理层", "2.4 信道复用技术", "2.4.3 码分复用"],
        ],
        [
            ["第2章 物理层", "2.5 数字传输系统"],
            ["第2章 物理层", "2.6 宽带接入技术"],
            ["第2章 物理层", "2.6 宽带接入技术", "2.6.1 ADSL 技术"],
            ["第2章 物理层", "2.6 宽带接入技术", "2.6.2 光纤同轴混合网"],
            ["第3章 数据链路层"],
            ["第3章 数据链路层", "3.1 数据链路层的几个共同问题"],
        ],
    ]

    merged = _merge_catalog_paths(image_paths)

    assert ["第1章 概述", "1.1 计算机网络在信息时代中的作用"] in merged
    assert ["第1章 概述", "1.7 计算机网络体系结构", "1.7.5 TCP/IP 的体系结构"] in merged
    assert ["第2章 物理层", "2.4 信道复用技术", "2.4.1 频分复用、时分复用和统计时分复用"] in merged
    assert ["第2章 物理层", "2.6 宽带接入技术", "2.6.2 光纤同轴混合网"] in merged
    assert ["第3章 数据链路层", "3.1 数据链路层的几个共同问题"] in merged
    assert all("习题" not in segment and "本章的重要概念" not in segment for path in merged for segment in path)
    assert len([path for path in merged if path[0] == "第1章 概述"]) == 15
    assert len([path for path in merged if path[0] == "第2章 物理层"]) == 13
