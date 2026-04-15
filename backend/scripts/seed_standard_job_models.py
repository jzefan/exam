"""Seed script: inserts standard job models for the job model module."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from sqlalchemy import select

from app.auth import models as auth_models  # noqa: F401
from app.database import async_session
from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelVersion,
    Skill,
    SkillKnowledgePoint,
)
from app.rbac.models import Organization

STANDARD_MODELS = [
    {
        "job_role": "Java 后端工程师",
        "industry_name": "软件和信息服务",
        "direction_name": "工业软件",
        "job_family": "后端开发",
        "version_note": "平台标准岗位模型，可作为企业快速生成的基底。",
        "dimensions": [
            {
                "name": "核心开发能力",
                "skills": [
                    {
                        "name": "Java 核心编程",
                        "level": "L3",
                        "knowledge_points": ["Java 语法基础", "集合框架", "异常处理"],
                    },
                    {
                        "name": "Spring Boot 接口开发",
                        "level": "L3",
                        "knowledge_points": ["Spring Boot 基础", "RESTful API", "接口设计"],
                    },
                ],
            },
        ],
    },
    {
        "job_role": "数据分析师",
        "industry_name": "数字经济",
        "direction_name": "数据服务",
        "job_family": "数据分析",
        "version_note": "平台标准岗位模型，可作为企业快速生成的基底。",
        "dimensions": [
            {
                "name": "数据分析能力",
                "skills": [
                    {
                        "name": "SQL 分析",
                        "level": "L3",
                        "knowledge_points": ["SQL 查询", "聚合分析", "数据清洗"],
                    },
                    {
                        "name": "可视化表达",
                        "level": "L2",
                        "knowledge_points": ["指标设计", "图表表达", "分析结论输出"],
                    },
                ],
            },
        ],
    },
    {
        "job_role": "设备运维工程师",
        "industry_name": "高端装备",
        "direction_name": "智能制造",
        "job_family": "运维保障",
        "version_note": "平台标准岗位模型，可作为企业快速生成的基底。",
        "dimensions": [
            {
                "name": "设备保障能力",
                "skills": [
                    {
                        "name": "设备点检",
                        "level": "L3",
                        "knowledge_points": ["巡检流程", "点检记录", "异常上报"],
                    },
                    {
                        "name": "故障诊断",
                        "level": "L3",
                        "knowledge_points": ["故障定位", "安全规范", "维护记录"],
                    },
                ],
            },
        ],
    },
    {
        "job_role": "大模型集群研发和运维工程师",
        "industry_name": "人工智能",
        "direction_name": "架构",
        "job_family": "基础设施",
        "version_note": "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "集群与系统基础",
                        "level": "L3",
                        "knowledge_points": [
                            "Linux 系统操作与管理",
                            "Docker 与 Kubernetes 容器管理",
                            "GPU 架构特性与高并发处理",
                            "系统监控与性能调优知识",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "集群运维与优化",
                        "level": "L3",
                        "knowledge_points": [
                            "Linux 命令行系统管理与故障排除",
                            "网络配置与复杂网络问题排查",
                            "Shell 或 Python 自动化运维脚本编写",
                            "Prometheus 与 Grafana 监控配置",
                            "深度学习框架和 GPU 使用优化",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "集群部署实践",
                        "level": "L3",
                        "knowledge_points": [
                            "GPU 集群部署管理与优化经验",
                            "系统故障处理与快速恢复",
                            "面向业务需求的资源管理与调度策略",
                            "技术文档与系统优化报告编写",
                            "新技术与新产品动态跟踪评估",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "深度学习框架研发工程师",
        "industry_name": "人工智能",
        "direction_name": "架构",
        "job_family": "框架研发",
        "version_note": "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "深度学习框架原理",
                        "level": "L3",
                        "knowledge_points": [
                            "PaddlePaddle 与 PyTorch 工作原理",
                            "CPU GPU FPGA ASIC 多元计算架构",
                            "分布式计算同步与异步通信原理",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "框架开发与性能优化",
                        "level": "L3",
                        "knowledge_points": [
                            "C++ 与 Python 框架开发",
                            "编译系统开发与算法加速",
                            "框架性能分析工具定位瓶颈",
                            "底层算子实现与优化",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "分布式训练系统实践",
                        "level": "L3",
                        "knowledge_points": [
                            "深度学习引擎与底层算子开发优化",
                            "大规模训练通信与同步问题解决",
                            "计算加速解决方案设计",
                            "任务执行效率分析与优化",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "大模型算法工程师",
        "industry_name": "人工智能",
        "direction_name": "算法",
        "job_family": "算法研发",
        "version_note": "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "大模型算法基础",
                        "level": "L3",
                        "knowledge_points": [
                            "机器学习与深度学习基础理论",
                            "Transformer 模型架构",
                            "优化算法与数值计算基础",
                            "软件工程复用与模块化设计",
                            "模型可解释性与公平性",
                            "云平台与容器化部署基础",
                            "计算机系统与网络通信基础",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "模型训练与分析实现",
                        "level": "L3",
                        "knowledge_points": [
                            "Python 与 C++ 算法实现",
                            "PaddlePaddle 与 PyTorch 模型构建训练",
                            "NumPy 与 Pandas 数据分析处理",
                            "GPU 并行计算与 CUDA 编程基础",
                            "Matplotlib 与 Seaborn 结果展示",
                            "Git 与 GitHub 或 GitLab 版本管理",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "大模型项目落地实践",
                        "level": "L3",
                        "knowledge_points": [
                            "数据收集预处理模型设计训练评估部署全流程",
                            "模型调优与超参数优化",
                            "项目计划进度监控与资源协调",
                            "新理论与新方法工程化应用",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "大模型策略研发工程师",
        "industry_name": "人工智能",
        "direction_name": "算法",
        "job_family": "策略研发",
        "version_note": "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "策略研发基础",
                        "level": "L3",
                        "knowledge_points": [
                            "大模型技术原理与应用场景",
                            "自然语言处理与深度学习知识",
                            "大模型策略研发流程与方法论",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "模型策略优化",
                        "level": "L3",
                        "knowledge_points": [
                            "C++ 与 Python 编程基础",
                            "常用机器学习算法框架应用",
                            "数据结构与算法设计能力",
                            "自然语言处理技术与机器学习算法",
                            "基于产品策略的模型迭代优化",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "策略落地实践",
                        "level": "L3",
                        "knowledge_points": [
                            "大模型策略研发与优化经验",
                            "大模型相关项目实践",
                            "团队协作完成项目交付",
                            "业务需求评估与方案优化",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "大模型数据工程师",
        "industry_name": "人工智能",
        "direction_name": "数据",
        "job_family": "数据工程",
        "version_note": "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "大模型数据基础",
                        "level": "L3",
                        "knowledge_points": [
                            "大模型工作原理与训练方法",
                            "数据采集存储清洗原理与方法",
                            "数据标注分析管理流程与规范",
                            "数据治理与数据安全基础",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "数据处理与质量优化",
                        "level": "L3",
                        "knowledge_points": [
                            "数据库操作与存储管理",
                            "Pandas 与 NumPy 数据清洗预处理",
                            "数据特征分析与清洗规则优化",
                            "公开数据抓取与数据采集质量提升",
                            "Python 自动化脚本处理分析数据",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "数据流程工程实践",
                        "level": "L3",
                        "knowledge_points": [
                            "数据采集清洗标注分析经验",
                            "数据治理与数据安全项目经验",
                            "自动化数据处理流程建立",
                            "工作进度安排与项目实施",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "大模型评测工程师",
        "industry_name": "人工智能",
        "direction_name": "评测",
        "job_family": "模型评测",
        "version_note": "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "评测理论基础",
                        "level": "L3",
                        "knowledge_points": [
                            "大模型工作原理训练方法与评估标准",
                            "ChatGPT 与 Transformer 架构知识",
                            "BLEU ROUGE PERPLEXITY 等评价指标",
                            "性能测试功能测试指标测试原理与方法",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "评测方案与自动化执行",
                        "level": "L3",
                        "knowledge_points": [
                            "全面评测计划和策略制定",
                            "统计学与数据挖掘分析测试结果",
                            "Python 与 Java 自动化测试脚本编写",
                            "测试工具和框架执行测试用例并产出报告",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "模型评测改进实践",
                        "level": "L3",
                        "knowledge_points": [
                            "模型理解推理与 agent 等能力评估",
                            "不同场景优劣分析",
                            "基于评测结果提出模型结构和训练策略改进建议",
                            "团队协作与沟通能力",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "大模型提示词工程师",
        "industry_name": "人工智能",
        "direction_name": "应用",
        "job_family": "提示词工程",
        "version_note": "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "提示词设计基础",
                        "level": "L3",
                        "knowledge_points": [
                            "大模型工作原理和训练方法",
                            "Zero-shot Few-shot Instruction Prompting 策略",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "提示词分析与优化",
                        "level": "L3",
                        "knowledge_points": [
                            "文本分析处理并抽取关键信息",
                            "需求分析并转化为有效提示词设计",
                            "GPT 文心一言等模型工具调用与调试优化",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "提示词迭代实践",
                        "level": "L3",
                        "knowledge_points": [
                            "面向业务场景设计有效提示词策略",
                            "根据用户查询和模型回答结果持续优化提示词",
                            "与研发团队和产品团队协作保证提示词有效性与一致性",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "大模型应用开发工程师",
        "industry_name": "人工智能",
        "direction_name": "应用",
        "job_family": "应用开发",
        "version_note": "来源：T/MIITEC 023-2024《大模型技术与应用产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "大模型应用开发基础",
                        "level": "L3",
                        "knowledge_points": [
                            "大模型应用开发整体流程",
                            "SFT RLHF LoRA 等微调技术",
                            "Agent 和 RAG 技术原理与使用方法",
                            "机器学习与深度学习理论基础",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "应用系统构建",
                        "level": "L3",
                        "knowledge_points": [
                            "Llama 文心大模型等开源模型及 API 使用",
                            "数据清洗转换标注",
                            "大模型训练技术与效果持续提升",
                            "PaddlePaddle 与 PyTorch 模型训练微调优化",
                            "LangChain 与 Gradio 等常用工具",
                            "数据安全相关知识",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "应用方案落地实践",
                        "level": "L3",
                        "knowledge_points": [
                            "从需求分析到模型部署全流程经验",
                            "基于业务需求设计合理应用方案",
                            "跨团队高效沟通推进项目进展",
                            "通过创新提升大模型应用效果和效率",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "开源开发者",
        "industry_name": "开源",
        "direction_name": "开发",
        "job_family": "开源开发",
        "version_note": "来源：T/MIITEC 018-2024《开源人才能力要求与评价规范》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "开源基础认知",
                        "level": "L3",
                        "knowledge_points": [
                            "基础计算机和软件知识",
                            "基础软件工程和信息系统项目管理知识",
                            "开源运动的起源发展历史和价值意义",
                            "开源世界的重要角色和主流项目",
                            "开源许可证类型与开源贡献基础知识",
                            "开源社区基础交流互动和决策流程",
                            "社区中的角色和贡献路径",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "协作平台基础使用",
                        "level": "L3",
                        "knowledge_points": [
                            "Markdown 基础操作",
                            "Git 分布式协作基础操作",
                            "GitHub Gitee AtomGit 等协作平台基础操作",
                            "参与社区沟通以及项目贡献基础流程和方法",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "开源参与实践",
                        "level": "L3",
                        "knowledge_points": [
                            "主流开源协作平台项目参与经验",
                            "开源项目贡献经验",
                            "代码和非代码类贡献实践",
                            "PR 合并 issue 回复和文档修复更新等协作经验",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "开源研发工程师",
        "industry_name": "开源",
        "direction_name": "开发",
        "job_family": "开源研发",
        "version_note": "来源：T/MIITEC 018-2024《开源人才能力要求与评价规范》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "开源研发体系知识",
                        "level": "L3",
                        "knowledge_points": [
                            "开源和闭源研发模式区别",
                            "面向上游的开源研发原则",
                            "开源社区构成和协作方法",
                            "开源软件版本控制相关知识流程和工具",
                            "开源项目管理知识",
                            "计算机软件知识",
                            "软件工程和信息系统项目管理知识",
                            "开源软件安全漏洞相关支持",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "开源研发协作技能",
                        "level": "L3",
                        "knowledge_points": [
                            "指导和帮助外部开发者的方法流程和原则",
                            "单元集成端到端等测试方法",
                            "至少一种编程语言及其生态深入了解",
                            "Git 等版本控制工具使用和分支管理",
                            "合并冲突解决",
                            "社区内有效沟通和协作的方法流程和规则",
                            "代码审查和建议反馈流程和方法",
                            "代码 API 和框架文档流程和方法",
                            "CI CD 及相关自动化工具使用方法",
                            "开源软件全生命周期安全治理基本流程工具和方法",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "开源项目研发实践",
                        "level": "L3",
                        "knowledge_points": [
                            "主流开源协作平台项目开发经验",
                            "较高的开源社区影响力",
                            "活跃于开源项目社区",
                            "较高的贡献和维护经验",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "开源合规协作者",
        "industry_name": "开源",
        "direction_name": "合规",
        "job_family": "开源合规",
        "version_note": "来源：T/MIITEC 018-2024《开源人才能力要求与评价规范》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "开源合规基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "开源相关知识产权基础知识",
                            "开源许可证概念分类和兼容性",
                            "常见许可证内容与相关合规义务",
                            "开源贡献机制和相关协议",
                            "常见开源合规相关风险",
                            "端到端开源合规流程",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "合规工具与初步判断",
                        "level": "L3",
                        "knowledge_points": [
                            "常见开源合规工具使用",
                            "相关合规报告结论理解",
                            "常见许可证义务识别",
                            "根据场景判断是否需要专业合规人员介入",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "协作合规实践",
                        "level": "L3",
                        "knowledge_points": [
                            "开源协作平台协作经验",
                            "GitHub 和 AtomGit 等平台参与经验",
                            "面向项目协作执行开源合规支持",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "开源合规经理",
        "industry_name": "开源",
        "direction_name": "合规",
        "job_family": "开源合规管理",
        "version_note": "来源：T/MIITEC 018-2024《开源人才能力要求与评价规范》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "开源合规治理知识",
                        "level": "L3",
                        "knowledge_points": [
                            "开源精神内核与底层逻辑",
                            "开源许可模式和许可证选择使用判断",
                            "开源合规相关法律政策标准和最佳实践",
                            "对开源合规相关风险进行分析研判并提出解决建议",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "合规规划与制度设计",
                        "level": "L3",
                        "knowledge_points": [
                            "常见开源合规工具与专业意见输出",
                            "开源相关各类法律协议前定方法和流程",
                            "结合具体业务制定开源合规计划流程和指引",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "开源合规管理实践",
                        "level": "L3",
                        "knowledge_points": [
                            "主流开源协作平台协作和合规经验",
                            "面向组织推动开源合规机制落地",
                            "结合法务业务和工程团队协同推进合规治理",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "开源社区运营经理",
        "industry_name": "开源",
        "direction_name": "运营",
        "job_family": "社区运营",
        "version_note": "来源：T/MIITEC 018-2024《开源人才能力要求与评价规范》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "社区治理与运营知识",
                        "level": "L3",
                        "knowledge_points": [
                            "开源社区治理和运营基本方法",
                            "不同社区治理和运营方式差异",
                            "开源社区基本决策原则",
                            "透明度共识决策社区参与度",
                            "开源社区角色结构和成长核心团队贡献者用户等",
                            "不同角色职责和权责",
                            "社区人员工作量评估与资源任务分配",
                            "常用沟通渠道设计和建立",
                            "社区中各类事项决策流程制定",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "社区运营执行技能",
                        "level": "L3",
                        "knowledge_points": [
                            "开源社区沟通议事决策工具和使用方法",
                            "主流开源社区推广渠道工具方法及流程",
                            "开发者生命周期运营策略",
                            "招募培养活跃和退出等机制设计",
                            "角色职责范围和权限设计方法流程原则",
                            "社区人员激励体系设计和实施工具方法流程原则",
                            "贡献者认可和激励计划设计",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "社区治理运营实践",
                        "level": "L3",
                        "knowledge_points": [
                            "中小型开源社区治理架构参与和构建经验",
                            "开源社区治理运营及相关体系建设经验",
                            "推动社区活跃度和协作效率提升的实践",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "开源专家",
        "industry_name": "开源",
        "direction_name": "战略",
        "job_family": "开源战略",
        "version_note": "来源：T/MIITEC 018-2024《开源人才能力要求与评价规范》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "开源战略治理知识",
                        "level": "L3",
                        "knowledge_points": [
                            "开源社区不同角色职责和权责",
                            "开源社区各项决策流程原则和方法",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "开源战略设计与统筹",
                        "level": "L3",
                        "knowledge_points": [
                            "根据需求制定开源战略并将其落实到开放社区和公共事务规划统筹中",
                            "开源开发模式整体流程",
                            "开源开发成本和收益评估",
                            "开源治理模式和成熟度模型",
                            "根据发展更新治理模式和方法",
                            "常见开源许可适用范围和选择标准",
                            "根据发展需求和演化进行调整",
                            "开源合规治理整体流程和规范",
                            "对开源合规规划和进程给予指导",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "开源战略落地实践",
                        "level": "L3",
                        "knowledge_points": [
                            "大中小型开源社区治理架构经验",
                            "活跃开源项目长期贡献和维护经验",
                            "面向生态拓展制定和推进开源战略实践",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "服装制版师",
        "industry_name": "服装产业",
        "direction_name": "设计",
        "job_family": "版型设计",
        "version_note": "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "服装结构与制版知识",
                        "level": "L3",
                        "knowledge_points": [
                            "服装缝制基本工艺流程",
                            "裁剪缝制熨烫等基础工序",
                            "服装结构知识与版型设计中的结构问题分析",
                            "道缝转移和平衡感调整",
                            "服装结构原理和方法",
                            "不同方法进行制版",
                            "各类服装尺码标准",
                            "国家标准国际标准及品牌特有尺码体系",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "制版设计与数字化建模",
                        "level": "L3",
                        "knowledge_points": [
                            "服装制版软件使用",
                            "高效精确绘制服装结构图",
                            "服装工业化样版设计与制作",
                            "特殊体型样版调整和修正",
                            "服装版型三维建模",
                            "对版型结构平衡面料垂度和处理进行建模分析",
                            "根据面料特性调整版型设计",
                            "版型调整以及输出",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "版型开发实践",
                        "level": "L3",
                        "knowledge_points": [
                            "在版型设计中兼顾设计精确和实际生产可行性经验",
                            "服装版型人体工学解决方案经验",
                            "服装样版图精确修正经验",
                            "减少生产过程误差",
                            "生产前道质量控制体系管理经验",
                            "对行业趋势新技术新材料敏感并持续提升",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "服装模板制作师",
        "industry_name": "服装产业",
        "direction_name": "设计",
        "job_family": "模板设计",
        "version_note": "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "模板结构与标准知识",
                        "level": "L3",
                        "knowledge_points": [
                            "服装结构知识与结构问题分析",
                            "服装结构原理和方法",
                            "不同方法进行制版",
                            "裁剪线缝制标识尺寸等模板标准信息",
                            "服装模板制作过程国家行业企业质量标准和流程规范",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "CAD 模板设计优化",
                        "level": "L3",
                        "knowledge_points": [
                            "CAD 软件绘图编辑标注功能",
                            "根据实际需要选择软件版本和插件",
                            "服装模板修正和优化技术",
                            "根据面料特性和需求调整模板尺寸和版型结构",
                            "保障服装穿着效果和舒适度",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "模板制作与调试实践",
                        "level": "L3",
                        "knowledge_points": [
                            "精确测量工具和方法应用经验",
                            "根据面料特性调整构件尺寸和形状",
                            "切割设备和工具使用经验",
                            "根据图样和组装说明进行组装操作经验",
                            "面料和缝制设备测试经验",
                            "根据测试发现问题及时调整模板设计",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "服装裁剪工",
        "industry_name": "服装产业",
        "direction_name": "制造",
        "job_family": "裁剪加工",
        "version_note": "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "裁剪工艺基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "各类纺织品特性",
                            "色差对称性和图案识别",
                            "服装裁剪基本原理和流程",
                            "排料铺料划板裁剪和标记捆扎技术要求",
                            "各类裁剪设备工作原理和常见机型特点",
                            "基础维护和故障排查",
                            "品质标准和检验方法",
                            "识别解决生产过程质量问题",
                            "安全生产法规和操作规程",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "排料裁片处理技能",
                        "level": "L3",
                        "knowledge_points": [
                            "基本排料方法和技巧",
                            "对不对称对条对花格面料排版实践",
                            "按照排版要求对材料进行合理布局",
                            "铺料工艺技术要求",
                            "确保布面平整无错位",
                            "根据不同生产条件和面料性能选择裁剪加工方式和设备",
                            "样片检验内容和方法",
                            "避免瑕疵衣片投入后续缝制工序",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "裁剪生产实践",
                        "level": "L3",
                        "knowledge_points": [
                            "在实际生产条件下兼顾效率和面料损耗制定裁剪方案经验",
                            "根据生产计划和任务分配安排工作进度",
                            "工艺改进和技术创新经验",
                            "不断优化生产流程和提高产品质量",
                            "严格执行质量控制标准和自检互检",
                            "设备故障和材料短缺等突发事件快速处置经验",
                            "与团队成员良好沟通协作解决技术问题",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "服装制作工",
        "industry_name": "服装产业",
        "direction_name": "制造",
        "job_family": "服装缝制",
        "version_note": "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "缝制工艺与质量知识",
                        "level": "L3",
                        "knowledge_points": [
                            "各类纺织品特性",
                            "厚度材质强度弹性等差异",
                            "组织缝制工序与各部件缝制组装整理技术要求",
                            "各类缝纫设备工作原理和常见机型特点",
                            "品质标准和检验方法",
                            "识别解决生产质量问题",
                            "安全生产法规和操作规程",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "缝制作业执行",
                        "level": "L3",
                        "knowledge_points": [
                            "综合考虑生产条件和效率制定合理缝纫方案",
                            "基础缝纫技巧",
                            "缝纫机和衣料特性匹配",
                            "压边线和车线技巧",
                            "定规来辅助缝制直线",
                            "各类缝纫机轨迹线张力参数调整",
                            "基础手缝技巧",
                            "完成打扣假缝和锁边等工序",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "缝制生产实践",
                        "level": "L3",
                        "knowledge_points": [
                            "根据生产计划和任务分配安排工作进度",
                            "与团队成员沟通协作提升生产效率",
                            "工艺改进和技术创新经验",
                            "通过实践优化生产流程和提高产品质量",
                            "严格执行质量控制标准和成品自检互检",
                            "设备故障和材料短缺等突发事件快速处置经验",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "服装缝盘工",
        "industry_name": "服装产业",
        "direction_name": "制造",
        "job_family": "针织缝盘",
        "version_note": "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "毛衫缝盘基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "不同类型纱线特性",
                            "羊毛羊绒棉纱化学纤维纱线手感弹性耐磨性",
                            "毛衫针织结构与平针罗纹提花等组织",
                            "毛衫缝盘工艺流程",
                            "毛衫缝盘机使用",
                            "调节机器操作方法和维护保养",
                            "毛衫多部位按缝技巧",
                            "衫边链夹装和纽扣缝合方法",
                            "毛衫通用质量标准",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "缝盘设备与工艺操作",
                        "level": "L3",
                        "knowledge_points": [
                            "熟练使用缝盘机并根据缝制要求调节参数",
                            "识别毛衫针织结构类型并选择合适缝制方法",
                            "弹性纱织面料缝合过程原始弹性和形状保持",
                            "缝盘机日常保养技能",
                            "控制缝线和针距技巧",
                            "无痕缝合技术",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "毛衫缝盘生产实践",
                        "level": "L3",
                        "knowledge_points": [
                            "从裁片准备到质检的毛衫缝盘全工艺流程经验",
                            "缝盘成品检测经验",
                            "确保产品质量符合要求",
                            "缝盘工艺改进经验",
                            "优化缝合方法和设备设置",
                            "在生产中引入新技术或材料提升效率和质量",
                            "与服装生产前端和后端协作经验",
                            "环保意识与生产废料污染物合理处理",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "服装整烫工",
        "industry_name": "服装产业",
        "direction_name": "制造",
        "job_family": "整烫定型",
        "version_note": "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "整烫原理与面料知识",
                        "level": "L3",
                        "knowledge_points": [
                            "各类纺织品特性",
                            "不同成分纺织品吸湿性耐受温度纤维强度",
                            "根据面料特性选择整烫方式温度压力",
                            "服装整烫基本原理和流程",
                            "前熨烫粘合熨烫中间熨烫和成品熨烫方法",
                            "各类熨烫设备工作原理和常见机型特点",
                            "基础维护和故障排查",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "整烫设备操作与手工技巧",
                        "level": "L3",
                        "knowledge_points": [
                            "根据生产通知单工艺单及排料要求制定整烫方案",
                            "蒸斗吸风烫台智能熨烫定型设备操作",
                            "根据产品要求调整设备温度压力时间等参数",
                            "手工熨烫技巧",
                            "分缝倒缝平烫扣烫缩烫拔烫等复杂推归拔等操作",
                            "不同材质和款式服装整烫要求和技巧",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "整烫质量控制实践",
                        "level": "L3",
                        "knowledge_points": [
                            "工艺改进和技术创新经验",
                            "通过实践不断优化生产流程和提高产品质量",
                            "严格执行质量控制标准和成品自检互检操作经验",
                            "设备故障和材料短缺等突发事件快速处置经验",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "服装生产线管理员",
        "industry_name": "服装产业",
        "direction_name": "运营服务类",
        "job_family": "生产管理",
        "version_note": "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "生产流程与现场管理知识",
                        "level": "L3",
                        "knowledge_points": [
                            "各类服装生产工艺流程",
                            "解读并绘制各种服装生产工序流程图",
                            "IE 方法",
                            "工位分析",
                            "layout 布局分析",
                            "报动分析和时间分析",
                            "科学合理地对各工序人员调配",
                            "产品质量标准和检验方法",
                            "识别解决生产过程质量问题",
                            "办公软件和 ERP 系统",
                            "安全生产法规和操作规程",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "生产组织与设备配置",
                        "level": "L3",
                        "knowledge_points": [
                            "根据生产通知单工艺单及排料要求制定合理生产工序流程",
                            "熟练操作裁剪缝制整烫设备和相关工具",
                            "根据产品要求配备不同专用设备及工具",
                            "先进智能生产设备选择",
                            "自动化生产设备模板机及专业设备配置",
                            "提高生产效率和良品率",
                            "服装生产工艺和原辅料管理流程",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "生产线统筹实践",
                        "level": "L3",
                        "knowledge_points": [
                            "生产计划制定和任务分配经验",
                            "合理安排工作进度确保按时完成任务",
                            "解决生产线不平衡问题保持平衡率稳定经验",
                            "工艺改进和技术创新经验",
                            "不断优化生产流程和提高产品质量",
                            "设备故障和材料短缺等生产线突发事件快速处置经验",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "服装生产数据分析师",
        "industry_name": "服装产业",
        "direction_name": "数据分析",
        "job_family": "生产数据分析",
        "version_note": "来源：T/MIITEC 024-2024《服装产业智能制造人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "生产统计与数据体系知识",
                        "level": "L3",
                        "knowledge_points": [
                            "基本统计学概念",
                            "均值方差标准差回归分析假设检验",
                            "描述性分析探索性数据分析 EDA",
                            "回归分析等基本数据分析方法",
                            "缝制生产线各工艺流程",
                            "裁剪缝制整烫质检和包装等环节",
                            "生产设备功能和生产数据及其影响",
                            "关系型数据库原理",
                            "SQL 数据查询管理和分析",
                            "数据收集和处理相关法律法规",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "生产数据分析与优化",
                        "level": "L3",
                        "knowledge_points": [
                            "从生产设备传感器和 ERP 收集数据并整合到统一分析平台",
                            "数据可视化工具使用",
                            "Tableau Power BI Matplotlib Seaborn",
                            "图表和仪表盘创建",
                            "模型评估",
                            "交叉验证和 A B 测试",
                            "确保模型准确性和稳定性并持续改进",
                            "分析优化生产流程",
                            "识别生产瓶颈和低效环节并提出改进方案",
                            "精益生产和六西格玛等流程优化工具和方法",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "生产数据系统实践",
                        "level": "L3",
                        "knowledge_points": [
                            "设计和实施实时数据采集系统经验",
                            "从生产线传感器设备和 ERP 自动化获取数据",
                            "建立和维护数据监控系统经验",
                            "设置关键生产参数阈值并异常告警",
                            "通过数据分析监控和评估生产效率经验",
                            "识别低效工序或操作并提出改进建议",
                            "结合历史数据和预测模型制定产能和生产计划",
                            "协调整合质量管理系统和库存管理系统实现数据互通和整体优化",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "细胞治疗药物研发研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "药物研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "细胞治疗药物基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "细胞生物学免疫细胞生物学分子生物学和生物化学基础知识",
                            "药理学毒理学肿瘤学生物信息学和生物统计学基本知识",
                            "细胞治疗药物临床前与临床研究的法规政策和标准",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "细胞治疗研发技术",
                        "level": "L3",
                        "knowledge_points": [
                            "基因编辑与递送系统使用优化与开发等分子生物学和生物化学方法",
                            "细胞分离培养纯化鉴定与质控等细胞工程与制备工艺技术",
                            "细胞治疗相关的蛋白基因外泌体等技术的技术操作及工艺技术",
                            "药物和类器官试验平台的使用与优化方法",
                            "利用生物信息学和生物统计学方法分析挖掘数据的能力",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "细胞治疗项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "针对细胞治疗药物开发制定临床前和临床研究方案",
                            "建立免疫原性安全性细胞质量和效能评估指标",
                            "研发过程中及时发现和解决各类技术难题",
                            "团队合作推动项目进展",
                            "按要求进行药物研发和申报并熟悉注册申报资料准备和提交流程",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "蛋白药物研发研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "药物研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "蛋白药物研发知识",
                        "level": "L3",
                        "knowledge_points": [
                            "分子生物学生物化学细胞生物学微生物与生化药学药学免疫学药物制剂药代动力学发酵工程生物信息学等基础学科知识",
                            "药物化学和药理学知识以及药物作用机制和药效评价方法",
                            "蛋白质结构与功能关系知识和药物分子设计优化",
                            "抗体药物研发相关免疫原理和技术",
                            "基因工程和蛋白质工程原理与方法",
                            "蛋白药物研发注册法规和流程要求",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "蛋白药物设计与表达纯化",
                        "level": "L3",
                        "knowledge_points": [
                            "靶点发现技术与生物信息学高通量筛选方法",
                            "药物分子设计软件进行结构设计和模拟",
                            "蛋白表达系统选择和优化并构建高效表达载体",
                            "蛋白表达和纯化技术包括层析超滤透析等",
                            "体外功能筛选实验技术评估药物分子的有效性和安全性",
                            "实验结果数据分析与质量控制方法",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "蛋白药物研发项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "独立承担蛋白药物研发项目设计实施和管理",
                            "制定合理实验方案和进度计划并严格执行",
                            "研发过程中及时发现和解决各类技术难题",
                            "与检测制剂注册等团队协同推进项目",
                            "确保研发过程符合相关要求并熟悉申报资料准备和提交流程",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "偶联药物研发研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "药物研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "偶联药物研发知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药物化学生物化学和分子生物学知识以及偶联药物化学结构和作用机制",
                            "抗体工程学和抗体结构功能制备方法以及抗体与药物偶联原理",
                            "核素化学和放射性药物学知识以及核素偶联药物研发安全规范",
                            "小分子药物化学和小分子偶联药物涉及的合成结构优化和活性评价",
                            "细胞生物学和药理学以及偶联药物细胞水平和体内作用效果和药代动力学特性",
                            "偶联药物研发注册法规和流程要求",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "偶联工艺与质量分析",
                        "level": "L3",
                        "knowledge_points": [
                            "偶联路线设计和优化技术并根据不同药物特性选择偶联方式和连接子",
                            "偶联工艺开发和放大能力",
                            "抗体纯化和修饰技术确保质量和活性适合偶联反应",
                            "核素偶联药物核素标记技术和放射性检测方法",
                            "分析化学技术进行高效液相色谱质谱等质量控制和分析",
                            "数据处理统计分析并评估实验结果可靠性和有效性",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "偶联药物项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "独立承担偶联药物研发项目规划执行和管理",
                            "制定详细实验方案和进度计划并按计划推进",
                            "研发过程中及时发现解决技术难题和工艺问题",
                            "与抗体核素合成化学等不同专业人员协同完成任务",
                            "确保研发过程符合相关要求并熟悉申报资料准备和提交流程",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "疫苗开发研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "药物研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "疫苗研发基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "病原生物学和免疫学基础知识",
                            "细胞生物学蛋白质化学药理学毒理学和流行病学基本知识",
                            "药药剂学和疫苗递送系统的基本知识",
                            "国内外疫苗研发的法规政策标准和注册要求",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "疫苗开发与评估技术",
                        "level": "L3",
                        "knowledge_points": [
                            "生物信息学和计算机模拟技术等疫苗靶点筛选与优化方法",
                            "分子生物学技术细胞培养与细胞功能评价技术免疫学检测技术动物实验技术等实验技能",
                            "基因编辑技术和重组 DNA 技术等基因工程方法",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "疫苗项目推进实践",
                        "level": "L3",
                        "knowledge_points": [
                            "能够制定疫苗临床前研究和临床研究方案",
                            "建立疫苗免疫原性安全性有效性和生产质量评估指标",
                            "团队协作推进项目进展",
                            "研发过程中及时发现和解决技术难题和工艺问题",
                            "熟悉疫苗注册申报资料准备和提交流程",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "核酸药物研发研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "药物研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "核酸药物研发知识",
                        "level": "L3",
                        "knowledge_points": [
                            "分子生物学与生物化学基础知识",
                            "药代动力学药效动力学细胞生物学和免疫学基本知识",
                            "核酸药物临床前和临床研究的标准法规与伦理要求",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "核酸设计与递送技术",
                        "level": "L3",
                        "knowledge_points": [
                            "核酸药物设计合成化学修饰活性检测与分析等技术",
                            "开发核酸药物递送系统和纳米制剂的能力",
                            "基因编辑技术与生物信息学数据分析方法",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "核酸药物项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "针对核酸药物靶点筛选与优化设计并实施临床前和临床转化研究方案",
                            "建立核酸药物质量控制与表征安全性和免疫原性评估指标",
                            "团队协作推进项目进展并及时解决技术难题",
                            "确保核酸药物研发过程符合相关要求并熟悉申报流程",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "合成生物学研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "药物研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "合成生物学基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "分子生物学遗传学生物化学等基础学科知识",
                            "合成生物学理论和方法包括基因合成基因编辑代谢工程生物系统设计等",
                            "微生物学发酵工程相关领域知识和不同微生物特性与应用场景",
                            "生物信息学知识和生物信息学工具进行基因序列分析设计",
                            "化学工程材料科学交叉学科知识",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "基因回路与代谢优化技术",
                        "level": "L3",
                        "knowledge_points": [
                            "基因编辑技术如 CRISPR Cas9 等对目标菌株进行改造",
                            "基因合成和克隆技术构建新的基因回路和生物系统",
                            "代谢途径设计和优化技术提高目标产物产量和质量",
                            "发酵技术和工艺放大技术确保产品工程化制备",
                            "分析化学和生物检测技术进行质量检测和性能评估",
                            "编程和数据分析能力进行生物信息学数据分析",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "合成生物学项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "独立承担合成生物学项目设计实施和管理",
                            "根据项目需求制定合理实验方案和进度计划并严格执行",
                            "项目实施过程中及时发现并解决技术难题和工程问题",
                            "与不同专业领域人员协同推进项目",
                            "了解产业化流程和要求并将实验室成果转化为实际产品",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "微生物分析研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "质量分析",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "微生物分析知识",
                        "level": "L3",
                        "knowledge_points": [
                            "国内外微生物分析领域法规政策",
                            "微生物检测与分析基本原理和方法",
                            "微生物限度细菌内毒素等检查方法及确认过程",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "微生物实验与数据处理",
                        "level": "L3",
                        "knowledge_points": [
                            "微生物培养分离纯化鉴定等基本技能",
                            "微生物实验室常用分析仪器及设备使用维护",
                            "使用数据分析软件对实验数据进行处理和分析",
                            "申报材料撰写相关体系文件或 SOP 编写整理",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "微生物分析项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "独立承担微生物分析项目设计实施和管理",
                            "根据项目需求制定合理实验方案和进度计划",
                            "及时发现和解决技术难题和工程问题并为组织提供微生物分析服务",
                            "了解微生物产品产业化流程和要求并将实验室成果转化为实际产品",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "细胞培养工程师",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "生产工艺",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "细胞培养基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "细胞生物学知识和不同类型细胞结构功能生理特性",
                            "分子生物学和遗传学理解细胞内基因表达信号传导与功能关系",
                            "生物化学知识包括细胞代谢途径酶促反应",
                            "免疫学知识尤其是免疫细胞培养时的免疫反应机制",
                            "微生物学知识用于预防和处理细胞培养中的污染问题",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "细胞培养与环境控制技术",
                        "level": "L3",
                        "knowledge_points": [
                            "细胞种子库构建细胞传代冻存复苏等基本操作",
                            "细胞鉴定和细胞检测如形态观察免疫荧光染色流式细胞术等",
                            "细胞培养环境控制包括温度湿度气体浓度等参数调节",
                            "培养基制备和优化并根据不同细胞类型进行系统优化",
                            "处理细胞培养污染生长缓慢分化异常等常见问题",
                            "生物反应器与相关设备操作维护",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "细胞培养工艺实践",
                        "level": "L3",
                        "knowledge_points": [
                            "独立制定细胞培养方案和工艺流程",
                            "根据项目需求和实验目的安排进度和规模",
                            "及时发现并采取措施解决培养过程问题",
                            "与科研技术产业人员协作完成相关项目",
                            "关注细胞培养技术发展动态持续改进效率质量和成本控制",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "蛋白纯化工程师",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "生产工艺",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "蛋白纯化基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "蛋白质化学知识包括蛋白质结构理化性质和功能",
                            "生物化学知识包括酶促反应代谢途径和翻译后修饰作用",
                            "分子生物学知识理解蛋白表达和蛋白质合成过程",
                            "色谱原理包括离子交换疏水和亲和色谱的分离机制",
                            "有机化学和无机化学知识用于选择缓冲液体系保证稳定性和活性",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "蛋白纯化与分析技术",
                        "level": "L3",
                        "knowledge_points": [
                            "色谱分离超滤透析沉淀等蛋白纯化技术",
                            "分子量测定等电点分析活性检测等性质分析能力",
                            "根据蛋白来源性质和纯化目标设计纯化流程和步骤",
                            "色谱仪超滤系统离心机等纯化设备操作维护",
                            "纯化过程实验数据分析总结和效果评估",
                            "蛋白纯化过程质量控制方法确保纯化后蛋白符合质量标准",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "蛋白纯化工艺实践",
                        "level": "L3",
                        "knowledge_points": [
                            "从小试工艺开发到大规模纯化生产各流程实践",
                            "熟悉蛋白常规检测方法并能独立承担纯化任务",
                            "根据蛋白性质制定纯化工艺并完成中试放大与成本优化",
                            "在蛋白纯化过程中及时发现并解决降解杂质去除不彻底等技术难题",
                            "与科研技术产业人员协作完成蛋白纯化相关项目",
                            "将实验室规模纯化工艺转化为大规模生产工艺并提升效率质量和成本控制",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "生物药品制品制剂研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "制剂研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "生物制剂研发基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "基因工程蛋白质工程发酵工程细胞工程与酶工程等专业理论知识",
                            "生物药品制品制剂的最新研究成果和发展动态",
                            "生物制剂质量控制要求与法律法规知识",
                            "生物学化学药学及制剂研发质量分析和车间生产专业知识",
                            "生物制剂新技术新标准新方法和数字化技术应用能力",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "生物制剂处方与检测技术",
                        "level": "L3",
                        "knowledge_points": [
                            "生物制剂分类应用领域及管理规范",
                            "生物制剂处方设计制备与工艺放大能力",
                            "理化微生物免疫及分子生物学检测能力",
                            "文献检索与报告撰写能力",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "生物制剂项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "为生物药品制品中试及放大生产提供技术支持",
                            "制定处方组成工艺参数及质量控制项目的方案计划",
                            "在项目实施过程中及时发现并解决技术难题",
                            "与科研技术产业人员协作完成制剂相关项目",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "生物药品制品药物分析研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "药物分析",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "生物药品分析基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "蛋白质核酸糖类等生物大分子的结构功能及代谢过程",
                            "生物药品定性和定量分析方法",
                            "生物药品纯度杂质稳定性等检测方法和标准",
                            "FDA EMA ICH 等生物药品研发法规和国际标准",
                            "生物药品生产过程作用机制药物代谢药效学及潜在毒性反应",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "生物药品检测与数据分析技术",
                        "level": "L3",
                        "knowledge_points": [
                            "HPLC LC-MS 电泳 ELISA 等分析技术",
                            "无菌操作相关实验技能",
                            "实验数据处理分析软件应用",
                            "数据库管理与文献检索能力",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "生物药品分析项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "为生物药品制品药物分析提供咨询服务",
                            "在项目实施过程中及时发现并解决技术难题",
                            "与科研技术产业人员协作完成药物分析项目",
                            "生物药品制品药物分析项目规划与实施能力",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "生物药品制品质量管理专员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "质量管理",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "生物药品质量管理基础",
                        "level": "L3",
                        "knowledge_points": [
                            "生物制药行业法规和标准如 GMP 与 ICH 指南",
                            "生物药品生产流程和质量控制原理",
                            "质量管理体系构建和维护及质量手册操作规程编制",
                            "供应商质量审核分类复核和评估说明方法",
                            "物料供应商资质审核和物料供应商质量评价流程",
                            "变更控制原则方法及对原材料设备工艺变更影响评估",
                            "供应商质量投诉处理整改追踪程序和方法",
                            "WMS 和 QMS 的使用和管理",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "质量检验与系统应用技术",
                        "level": "L3",
                        "knowledge_points": [
                            "常用实验室仪器设备使用维护如 HPLC 与 GC",
                            "实验操作技能确保检验任务准确性和可靠性",
                            "计算机操作系统和办公软件及电子表格数据库数据处理分析",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "生物药品质量管理实践",
                        "level": "L3",
                        "knowledge_points": [
                            "组织流程建立和讨论并优化质量管理体系",
                            "生产过程监控偏差调查处理成品审核放行验证跟进年度回顾等质量管理能力",
                            "原辅料中间品成品检验与记录填写及国内外药监管理部门审计认证工作能力",
                            "接受收方审核产品开发部转移的分析方法并完成方法学转移工作",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "基因治疗药物研发研究员",
        "industry_name": "生物医药",
        "direction_name": "生物药品制品制造",
        "job_family": "药物研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "基因治疗研发基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "分子生物学生物化学细胞生物学微生物与生化药学药学免疫学药物制剂药代动力学发酵工程和生物信息学等基础知识",
                            "基因治疗药物临床前和临床研究的标准法规与伦理要求",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "基因治疗设计与递送技术",
                        "level": "L3",
                        "knowledge_points": [
                            "基因治疗药物设计合成化学修饰活性检测分析等遗传学免疫学分子生物学和生物化学技术",
                            "基因治疗药物病毒与非病毒递送系统能力",
                            "基因编辑技术与生物信息学数据分析方法",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "基因治疗项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "针对目标疾病的遗传缺陷和基因突变设计治疗靶点及方案",
                            "组织实施临床前和临床转化研究",
                            "建立基因治疗药物质量控制与表征安全性和有效性评估指标",
                            "与科研技术产业人员协作推进项目进展",
                            "在基因治疗药物研发过程中及时发现并解决技术难题和工艺问题",
                            "了解药品研发法规和规范确保研发过程符合相关要求",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "化学药品研发研究员",
        "industry_name": "生物医药",
        "direction_name": "化学药品与原料药制造",
        "job_family": "药物研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "化学药研发基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "化学药品研发相关法规要求和伦理标准",
                            "化学药品设计原理定量构效关系合成方法和作用机制",
                            "化学药品工艺流程合成放大及生产原则工艺验证相关标准和规范",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "化学药研发与分析技术",
                        "level": "L3",
                        "knowledge_points": [
                            "化学药品合成分离纯化和质量分析能力",
                            "化学药品各类生产和分析仪器的基础操作",
                            "数据分析工具和软件并使用相关软件进行统计和模拟",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "化学药研发项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "制定化学药品合成方案和生产工艺优化等项目咨询计划和方案",
                            "化学药品分析和质量评估方面经验",
                            "项目管理和执行能力合理规划实验进度和资源",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "化学药品制剂研究员",
        "industry_name": "生物医药",
        "direction_name": "化学药品与原料药制造",
        "job_family": "制剂研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "化学制剂基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药品注册相关法规和文件要求",
                            "药物制剂基本原理和方法",
                            "化学生物学等多领域知识并能够综合运用",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "制剂设计与分析设备应用",
                        "level": "L3",
                        "knowledge_points": [
                            "独立完成制剂制备质量控制及稳定性研究的实验能力",
                            "药品制剂处方工艺设计优化",
                            "高效液相色谱气相色谱及紫外可见分光度计等制剂分析仪器使用",
                            "药品制剂常见生产设备操作及设备原理运行规程",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "化学制剂项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "工艺规程质量标准岗位操作标准等工艺文件编制与产品质量监控",
                            "洁净区程序和卫生管理",
                            "项目管理和执行能力并与其他团队成员高效沟通协作",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "化学药品分析研究员",
        "industry_name": "生物医药",
        "direction_name": "化学药品与原料药制造",
        "job_family": "药物分析",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "化学药分析基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药物分析的基本原理和方法",
                            "药品监督管理部门药品注册和申报相关规定和技术要求",
                            "中国药典的基本组成和药品质量标准要求",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "化学分析方法与仪器应用",
                        "level": "L3",
                        "knowledge_points": [
                            "高效液相色谱气相色谱紫外可见分光光度计等现代分析仪器操作",
                            "药品常用现代分析仪器日常维护和校验",
                            "独立开发和验证分析方法能力",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "化学药分析项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "稳定性研究和质量标准建立",
                            "系统记录实验数据并撰写技术报告和申报材料",
                            "项目管理和执行能力并有效组织管理咨询项目",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "诊断试剂研发工程师",
        "industry_name": "生物医药",
        "direction_name": "化学药品与原料药制造",
        "job_family": "研发工程",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "诊断试剂研发基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "诊断试剂研发相关法规要求国际标准及伦理规范",
                            "诊断试剂原理设计方法临床应用流程及性能评估标准",
                            "诊断试剂开发过程中的质量控制稳定性测试及产品验证规范",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "试剂开发与数据分析技术",
                        "level": "L3",
                        "knowledge_points": [
                            "诊断试剂研发合成优化和性能测试技术",
                            "使用相关软件进行试剂研发过程中的数据分析与模拟",
                            "临床试验设计和实施流程并协助完成试剂临床验证与注册资料编写",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "诊断试剂项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "从需求分析到产品开发的全流程工作能力包括试剂配方设计生产工艺优化试生产及临床验证",
                            "制定诊断试剂生产工艺方案并进行优化",
                            "项目管理能力并有效协调研发生产及临床验证团队工作",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "化学药品质量管理专员",
        "industry_name": "生物医药",
        "direction_name": "化学药品与原料药制造",
        "job_family": "质量管理",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "化学药质量管理基础",
                        "level": "L3",
                        "knowledge_points": [
                            "化学药品质量管理体系相关规定如 GMP 和 ISO",
                            "药品检验及质量控制相关知识及原理",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "药品质检与合规技术",
                        "level": "L3",
                        "knowledge_points": [
                            "一般药品质量检验技术",
                            "依据 GMP 及 SOP 完成相关检验工作记录",
                            "独立开发和验证分析方法并进行稳定性研究和质量研究",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "化学药质量管理实践",
                        "level": "L3",
                        "knowledge_points": [
                            "生产过程监控偏差调查处理成品审核放行验证跟进年度回顾等相关质量管理能力",
                            "原辅料中间品成品检验与记录填写及外部药品监督管理部门审计认证工作能力",
                            "解决问题能力与资料归档整理能力",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "制药装备研发工程师",
        "industry_name": "生物医药",
        "direction_name": "生物医药关键装备与原辅料制造",
        "job_family": "装备研发",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "制药装备设计基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "制药工艺学和制药设备工程设计基础知识",
                            "制药工程机械工作原理及应用",
                            "药品生产质量管理规范 GMP 及国际标准要求",
                            "材料科学基础和设备材料特性适用性",
                            "化学反应工程流体力学热力学等化工原理和物理化学基础",
                            "自动化控制理论 PLC 与 SCADA 系统应用",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "制药装备设计与仿真技术",
                        "level": "L3",
                        "knowledge_points": [
                            "CAD CAM CAE 辅助设计工具进行产品设计与仿真",
                            "机械结构强度分析疲劳寿命预测",
                            "三维建模软件如 SolidWorks AutoCAD Inventor CATIA 等",
                            "机械传动系统设计与优化提高设备性能",
                            "电气控制系统设计与调试能力支持设备综合设计",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "制药装备研发项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "独立完成制药设备从概念设计到详细设计的全流程经验",
                            "协调多部门合作推动项目从设计阶段到定制运行阶段",
                            "现场安装调试及故障诊断处理能力确保设备正常运行",
                            "根据客户反馈和技术发展改进设备或开发新产品",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "制药装备生产工程师",
        "industry_name": "生物医药",
        "direction_name": "生物医药关键装备与原辅料制造",
        "job_family": "生产工艺",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "制药装备生产基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "制药机械基本构造和工作原理及各类制药设备生产流程",
                            "药品生产质量管理规范 GMP 及国际标准和药监机构要求",
                            "机械制造工艺及材料选择原则和常用材料加工特性适用范围",
                            "设备组装技术标准和机械部件之间配合精度",
                            "生产计划制定与执行原理及生产调度基本方法",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "装备组装与调试技术",
                        "level": "L3",
                        "knowledge_points": [
                            "使用生产设备和工具进行机械组装",
                            "设备调试与性能测试能力并进行初步故障排查",
                            "阅读并理解机械图纸和技术文件",
                            "生产管理软件如 ERP 系统操作",
                            "沟通协调技巧并参与不同部门协作",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "装备生产项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "根据生产计划安排合理调配生产线资源",
                            "监督并指导生产线工人正确安装和调试设备",
                            "跟踪生产进度及时解决生产过程问题",
                            "协助研发部门进行新产品试生产并提供生产可行性反馈",
                            "持续改进生产线效率并提出合理改进建议",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "药用辅料及包装材料研发工程师",
        "industry_name": "生物医药",
        "direction_name": "生物医药关键装备与原辅料制造",
        "job_family": "研发工程",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "药辅包材研发基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药用辅料及包装材料基础理论和药学化学高分子材料机械等专业知识",
                            "药用辅料及包装材料分类性能规格及其在药品稳定性中的影响和稳定性研究方法理论",
                            "药用辅料及包装材料质量标准和检测方法的质量研究理论",
                            "药品包装技术及包装材料选择依据和应用条件",
                            "药用辅料药包材生产质量管理规范 GMP 国际标准及药监机构要求",
                            "文件检索阅读能力试验方法设计和报告管理能力",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "药辅包材开发与验证技术",
                        "level": "L3",
                        "knowledge_points": [
                            "药用辅料及包装材料配方设计小试实验与仪器设备操作",
                            "试验结果数据处理能力并能够撰写实验报告",
                            "中试放大及生产工艺验证能力并撰写工艺操作规程",
                            "质量标准和方法开发制剂应用性能测试稳定性研究能力",
                            "了解药用辅料及包装材料市场需求和应用特点",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "药辅包材研发项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "药用辅料及包装材料生产车间工艺设计设备选型并解决中试和放大验证问题",
                            "在工艺路线开发和实施方案实施过程中完成药用辅料及包装材料项目经验",
                            "药用辅料及包装材料生产工艺验证能力确保流程符合 GMP 要求",
                            "与生产质量等部门协作推进项目并保证 CDE 登记材料符合要求",
                            "持续改进意识并在生产实践中发现和改进工艺流程不足提升效率和质量",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "药用辅料及包装材料生产工程师",
        "industry_name": "生物医药",
        "direction_name": "生物医药关键装备与原辅料制造",
        "job_family": "生产工艺",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "药辅包材生产基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药用辅料及包装材料基础知识及其在药品中的作用和性能",
                            "药品生产质量管理规范 GMP 国际标准及药监机构要求",
                            "药用辅料及包装材料生产工艺流程包括原材料处理加工包装等",
                            "设备选型工艺验证和设备验证基本原则及技术要求",
                            "生产过程常见质量问题及解决方法",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "药辅包材生产与优化技术",
                        "level": "L3",
                        "knowledge_points": [
                            "根据生产工艺需求规划生产线布局支持生产线设计",
                            "生产设备选型及配置理解设备技术参数和性能指标",
                            "设备验证及工艺验证能力并制定验证方案支持设备验证和工艺验证",
                            "生产工艺优化与改进提高生产效率和产品质量",
                            "解决生产过程技术问题并进行故障排查和处理确保顺利运行",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "药辅包材生产项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "根据生产工艺要求设计生产线并进行设备选型支持生产线设计",
                            "组织和实施生产过程中的设备验证和工艺验证",
                            "在生产过程中发现问题并提出改进方案推动技术创新",
                            "在生产过程中发现问题并采取相应措施解决问题",
                            "参与技术革新项目提升生产线技术水平和生产能力支持技术创新",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "药用辅料及包装材料质检工程师",
        "industry_name": "生物医药",
        "direction_name": "生物医药关键装备与原辅料制造",
        "job_family": "质量管理",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "药辅包材质检基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药用辅料及包装材料理化性质及质量控制标准",
                            "药品生产质量管理规范 GMP 和国内外药品质量管理体系要求",
                            "药用辅料及包装材料质量检测方法及相关法规要求",
                            "环境监测基本理论与实践包括微生物监测和无菌环境控制",
                            "药品质量管理体系如 ISO9001 ISO13485 及其实施要求",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "药辅包材检验与监测技术",
                        "level": "L3",
                        "knowledge_points": [
                            "药用辅料及包装材料物理化学微生物等方面的质量检验",
                            "制定和验证检验方法能力确保方法准确性和可靠性",
                            "实验室仪器设备如 HPLC GC 电子显微镜等使用",
                            "数据统计分析并对检验结果进行评价和解释",
                            "环境监测技术并进行无菌环境监测与控制",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "药辅包材质检项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "根据质量标准和检验规程开展日常质量检验工作",
                            "建立和完善药用辅料及包装材料质量管理体系并支持运行",
                            "组织实施环境监测计划确保生产环境符合质量要求",
                            "解决质量问题并分析处理预防再发生支持全程质量控制",
                            "参与质量管理体系内部及外部审计准备并确保体系持续改进",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "临床研究员",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "临床研究",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "临床研究基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "临床试验基本原则设计类型及适用性",
                            "药物体内吸收分布代谢排泄过程和药代动力学模型",
                            "临床试验法规指导原则及国际标准",
                            "研究领域内相关疾病的生物学和病理学理解",
                            "评估临床研究有效性与安全性的能力",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "临床数据与报告技术",
                        "level": "L3",
                        "knowledge_points": [
                            "结果数据统计分析并设计合理统计计划和分析策略",
                            "临床数据管理流程包括数据收集清理和验证",
                            "撰写高质量临床试验报告研究论文和技术文档",
                            "报告审核流程确保报告内容完整性和合规性",
                            "临床试验管理软件使用",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "临床项目推进实践",
                        "level": "L3",
                        "knowledge_points": [
                            "项目管理技能协调团队资源时间管理和任务分配",
                            "高效沟通协作能力",
                            "质量控制流程内部核和风险评估",
                            "培训和指导团队成员能力",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "AI+临床研究工程师",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "临床研究",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "AI 临床研究基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药物 ADMET 性质及其在临床药物开发中的重要性",
                            "药物递送系统基本原理及不同剂型性质和生物利用度优化",
                            "AI 技术在药物研发中应用尤其是 ADMET 预测和药物剂型优化",
                            "药物动力学和药代动力学基础知识并结合临床需求优化药物生物学性能",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "AI 建模与药物性质预测技术",
                        "level": "L3",
                        "knowledge_points": [
                            "机器学习和深度学习算法如回归分析随机森林神经网络等用于药物 ADMET 性质预测",
                            "TensorFlow PyTorch scikit-learn 等 AI 工具和平台用于 ADMET 数据建模和预测",
                            "药物剂型分析工具和模拟方法通过 AI 技术预测不同剂型中的稳定性和释放特性",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "AI 临床转化实践",
                        "level": "L3",
                        "knowledge_points": [
                            "提升 ADMET 性质预测准确性并通过 AI 模型优化药物吸收代谢毒性等属性",
                            "开发新型药物递送系统并通过 AI 技术辅助选择最佳方案和剂型",
                            "与药学制剂学临床研究团队协同工作推动 AI 技术在药物开发过程中的应用与实施",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "临床协调员",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "临床运营",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "临床协调基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "理解并执行 GCP 准则确保临床试验符合国际标准",
                            "临床数据收集和分析基本原则",
                            "试验药物或治疗方法基本原理及可能副作用",
                            "如何识别和报告药物副作用或不良事件并掌握 GCP 与 HIPAA 等法规",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "临床系统与文档管理技术",
                        "level": "L3",
                        "knowledge_points": [
                            "临床试验相关软件如 CRF 设计工具在设置采集数据条目中的应用",
                            "临床系统如 eEDC CTMS EMR 在数据收集及追踪中的应用",
                            "统计分析软件在数据审核分析及质量控制中的应用",
                            "临床文档管理与版本控制能力",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "临床协调执行实践",
                        "level": "L3",
                        "knowledge_points": [
                            "参与临床试验项目实践经验",
                            "评估临床试验项目风险能力",
                            "应对重大突发公共卫生事件等突发事件经验",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "临床监察员",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "临床运营",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "临床监察基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药品临床试验管理规范 GCP 及相关法规并按要求进行监查工作",
                            "临床试验流程及项目管理知识理解关键节点和风险管理措施",
                            "病例报告表 CRF 和原始数据核查流程确保数据准确性和完整性",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "监查执行与问题分析技术",
                        "level": "L3",
                        "knowledge_points": [
                            "根据试验方案执行定期监查包括中心筛选启动进度跟踪和关闭访视",
                            "与临床试验基地主要研究者及各方沟通协调并解决试验过程问题",
                            "分析和解决监查中发现问题并独立撰写监查报告确保符合试验设计方案和法规要求",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "临床监查项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "执行常规监查和制定访视计划并根据试验进度调整频率和时间安排",
                            "临床试验项目现场管理经验确保数据完整性与可溯性并对严重不良事件进行追踪和汇报",
                            "协调研究中心和相关团队合作确保试验资料安全存档和管理",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "AI+药物发现工程师",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "药物发现",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "AI 药物发现基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药物发现基本原理包括靶点验证先导化合物筛选及优化关键环节",
                            "生物医学化学药物学药物动力学和药物代谢基础知识",
                            "机器学习和深度学习在药物发现中的应用特别是靶点预测和分子优化领域",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "分子建模与 AI 筛选技术",
                        "level": "L3",
                        "knowledge_points": [
                            "药物分子建模虚拟筛选和药物靶点对接技术及软件使用",
                            "各种 AI 算法技术应用于药物筛选先导化合物发现及优化",
                            "晶体结构预测技术并结合分子模拟和机器学习方法预测晶体结构及稳定性",
                            "数据挖掘与分析能力处理大规模分子数据集基因组数据及临床数据",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "AI 药物发现项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "通过 AI 技术和大数据分析识别和验证疾病相关治疗靶点",
                            "分子对接结构优化 QSAR 建模等能力推动先导化合物发现与优化",
                            "药物发现过程中的跨学科协作能力并与生物学家化学家临床专家共同推进研发",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "生物信息工程师",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "生物信息",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "生物信息基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "生物学基础知识包括细胞生物学遗传学分子生物学生物化学等",
                            "Python R C++ 或 Java 等编程语言及机器学习和深度学习算法",
                            "概率论数理统计生物统计学等统计学知识",
                            "医学相关知识包括基础医学临床医学及流行病学等",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "生物数据分析与软件开发技术",
                        "level": "L3",
                        "knowledge_points": [
                            "数据分析能力熟练掌握各种生物信息学软件和工具并对生物大数据进行深入挖掘和分析",
                            "编程语言进行算法开发数据处理和软件开发并能基于人工智能技术自动化处理和分析生物信息数据",
                            "数据结构与算法数据库管理并构建和维护生物信息数据库确保准确性和完整性",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "生物信息应用实践",
                        "level": "L3",
                        "knowledge_points": [
                            "利用生物信息学技术分析目标蛋白质结构和功能开发药物分子计算模型并加速新药发现",
                            "利用机器学习算法分析电子健康记录等临床数据开发疾病风险进程和响应疗效预测模型支持临床决策",
                            "个性化医疗方案制定和靶向治疗优化经验通过患者基因信息大数据分析为医生提供建议",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "模式动物研究员",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "研究支持",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "模式动物研究基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "模式动物研究基本理论和相关实验技术",
                            "动物生理学病理学及相关生物学知识",
                            "实验动物伦理规范和相关法律法规",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "模型构建与统计分析技术",
                        "level": "L3",
                        "knowledge_points": [
                            "实验动物繁殖饲养及管理技术",
                            "动物模型构建方法和常用实验室技术",
                            "数据统计分析和可视化能力并能编写科学论文和报告",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "模式动物项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "模式动物实验设计与项目实施经验",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "药品数据专员",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "数据管理",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "药品数据基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "药学基础知识包括药物分子设计药理学药剂学和药物安全性评价知识",
                            "设计和分析临床试验基础知识了解 I 到 IV 期试验流程和数据需求",
                            "生物统计学和实验设计方法并能够对临床试验数据进行基本分析",
                            "数据库管理系统和数据分析工具使用",
                            "药品监管要求及药品上市许可和备案程序具体要求",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "临床数据处理与标准管理技术",
                        "level": "L3",
                        "knowledge_points": [
                            "药学相关实验设计和实施能力及药学信息数据分析能力",
                            "数据库管理和部分编程语言应用于数据分析建模和自动化任务",
                            "通过管理系统进行临床试验数据跟踪和管理并以评估验证及归纳总结撰写调研报告和立项报告",
                            "基本数据挖掘技术并从复杂数据集中分析提取关键信息监控数据处理流程",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "药品数据项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "使用多种模型和平台实施数据清洗和验证流程确保新药研发信息药理学药动学及安全性等数据准确完整一致",
                            "与团队合作进行药学数据需求分析确保数据系统功能满足业务需求",
                            "利用多种工具包括最新人工智能应用进行药物生命周期管理及上市到全生命周期数据分析与管理",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "药物警戒专员",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "药物警戒",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "药物警戒基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "临床医学流行病学等相关专业基础知识和药学专业理论知识",
                            "药学和医学数据统计分析能力",
                            "药品监管和药品不良反应报告等相关法规标准操作规程 SOP",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "警戒数据分析与报告技术",
                        "level": "L3",
                        "knowledge_points": [
                            "流行病学中的统计学技术在药物警戒信息整合处理和数据分析中的应用",
                            "医学统计软件使用技能药物警戒数据库系统使用和 Word Excel 等办公软件",
                            "撰写药物警戒相关年度工作报告并熟练阅读和书写英文文献和报告能力",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "药物警戒执行实践",
                        "level": "L3",
                        "knowledge_points": [
                            "审查评估并处理所有服务项目药物警戒相关安全数据和信息经验",
                            "独立完成药物警戒相关工作包括不良事件识别处理和报告药物安全培训管理",
                            "对收集到的数据进行收集录入澄清随访质量复核提交等并管理药物警戒档案",
                            "协助编写药物安全性总结资料并协助上级进行风险管理和安全监管提供常规咨询及投诉记录跟踪等",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "产品注册与法规专员",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "注册法规",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "注册法规基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "生物医药产品注册流程与法规体系包括国内外药品管理法和医疗器械管理条例等",
                            "生物医药产品开发审批流程和临床试验设计数据统计分析及报告撰写规范",
                            "生物医药领域新技术新工艺及其安全性有效性评价标准",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "注册申报与文档分析技术",
                        "level": "L3",
                        "knowledge_points": [
                            "CTMS 和电子申报系统等生物医药产品注册相关软件工具",
                            "文献检索与数据分析能力并准确评估产品科学价值与市场前景",
                            "中英文双语能力和英文阅读写作能力以便处理国际注册文件交流与审核",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "注册推进项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "参与生物医药产品从研发到注册上市全周期经验了解各阶段关键节点与合规要求",
                            "主导或参与至少一项生物医药产品注册申报工作经验熟悉资料准备审核与提交流程",
                            "沟通协调与项目管理能力并有效协调部门资源推动注册项目高效推进",
                        ],
                    }
                ],
            },
        ],
    },
    {
        "job_role": "市场推广专员",
        "industry_name": "生物医药",
        "direction_name": "生物医药相关服务",
        "job_family": "市场推广",
        "version_note": "来源：T/MIITEC 026-2025《生物医药产业人才岗位能力要求》",
        "dimensions": [
            {
                "name": "专业知识",
                "skills": [
                    {
                        "name": "生物医药市场基础知识",
                        "level": "L3",
                        "knowledge_points": [
                            "生物医药产业相关术语基本概念原理和技术并准确解释产品的生物医学原理",
                            "生物医药产品临床应用适应症禁忌症等并为医生患者提供专业临床咨询",
                            "生物医药行业最新动态政策法规新技术等并为市场推广策略提供前瞻性建议",
                        ],
                    }
                ],
            },
            {
                "name": "技术技能",
                "skills": [
                    {
                        "name": "市场分析与推广沟通技术",
                        "level": "L3",
                        "knowledge_points": [
                            "市场调研工具和方法收集并分析市场信息竞品信息客户需求",
                            "数据分析能力并运用统计学方法和数据分析工具对市场数据深入挖掘和分析",
                            "沟通协调能力并与医生患者合作伙伴等建立有效沟通渠道确保市场推广活动顺利进行",
                            "熟练掌握 PPT Excel 等办公软件并制作精美市场推广材料和报告",
                            "持续学习能力不断关注行业动态和新技术发展",
                        ],
                    }
                ],
            },
            {
                "name": "工程实践",
                "skills": [
                    {
                        "name": "市场推广项目实践",
                        "level": "L3",
                        "knowledge_points": [
                            "活动策划和执行经验根据市场调研结果和客户需求制定市场推广计划并有效执行推广活动",
                            "客户服务意识和服务能力建立并维护良好客户关系定期回访客户了解客户需求并提供个性化方案",
                            "销售支持经验并与销售团队紧密合作为销售团队提供产品知识和市场推广策略培训",
                            "生物医药市场进行深入调研经验包括竞争对手分析目标客户群体画像构建",
                            "处理客户反馈和投诉经验为改进产品和服务提供依据",
                        ],
                    }
                ],
            },
        ],
    },
]


async def seed() -> None:
    async with async_session() as db:
        org = (await db.execute(select(Organization).order_by(Organization.created_at.asc()).limit(1))).scalar_one_or_none()
        if org is None:
            print("Error: No organization found. Please create an organization first.")
            return

        created_count = 0

        for definition in STANDARD_MODELS:
            existing = (
                await db.execute(
                    select(JobModel).where(
                        JobModel.job_role == definition["job_role"],
                        JobModel.model_type == "standard",
                    )
                )
            ).scalar_one_or_none()

            if existing is not None:
                print(f"Skipping existing standard model: {definition['job_role']}")
                continue

            model = JobModel(
                job_role=definition["job_role"],
                model_type="standard",
                status="published",
                job_family=definition["job_family"],
                industry_name=definition["industry_name"],
                direction_name=definition["direction_name"],
                org_id=org.id,
            )
            db.add(model)
            await db.flush()

            version = JobModelVersion(
                job_model_id=model.id,
                version=1,
                version_note=definition["version_note"],
                is_current=True,
                source_type="manual",
                raw_content={
                    "job_role": definition["job_role"],
                    "dimensions": definition["dimensions"],
                },
            )
            db.add(version)
            await db.flush()

            model.current_version_id = version.id
            model.current_version = version
            await db.flush()

            for dim_index, dimension_data in enumerate(definition["dimensions"]):
                dimension = CompetencyDimension(
                    model_version_id=version.id,
                    name=dimension_data["name"],
                    sort_order=dim_index,
                )
                db.add(dimension)
                await db.flush()

                for skill_index, skill_data in enumerate(dimension_data["skills"]):
                    skill = Skill(
                        dimension_id=dimension.id,
                        name=skill_data["name"],
                        level=skill_data["level"],
                        sort_order=skill_index,
                        item_source="standard",
                    )
                    db.add(skill)
                    await db.flush()

                    for kp_index, kp_name in enumerate(skill_data["knowledge_points"]):
                        db.add(
                            SkillKnowledgePoint(
                                skill_id=skill.id,
                                name=kp_name,
                                sort_order=kp_index,
                                item_source="standard",
                            )
                        )

            created_count += 1
            print(f"Created standard model: {definition['job_role']}")

        await db.commit()
        print(f"Done. Created {created_count} standard job models.")


if __name__ == "__main__":
    asyncio.run(seed())
