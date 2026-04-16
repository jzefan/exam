"""
Manual extraction of big data job models from PDF text.
Based on the structure observed in the PDF.
"""

import json
from pathlib import Path

# Big Data Industry Job Models
BIG_DATA_MODELS = {
    "metadata": {
        "source": "T/MIITEC 006-2025《大数据产业人才岗位能力要求》",
        "industry": "大数据产业",
        "version_note": "来源：T/MIITEC 006-2025",
        "model_type": "standard"
    },
    "models": [
        {
            "job_role": "首席数据官",
            "direction_name": "数据治理",
            "dimensions": [
                {
                    "name": "专业知识",
                    "skills": [
                        {
                            "name": "数据战略规划",
                            "level": "L4",
                            "knowledge_points": [
                                "数据战略规划方法",
                                "数据资产管理",
                                "数据价值评估"
                            ]
                        },
                        {
                            "name": "数据治理体系",
                            "level": "L4",
                            "knowledge_points": [
                                "数据治理框架",
                                "数据标准规范",
                                "数据质量管理"
                            ]
                        }
                    ]
                },
                {
                    "name": "技术技能",
                    "skills": [
                        {
                            "name": "数据治理工具",
                            "level": "L3",
                            "knowledge_points": [
                                "数据治理平台使用",
                                "数据架构设计",
                                "数据质量监控"
                            ]
                        },
                        {
                            "name": "数据可视化",
                            "level": "L3",
                            "knowledge_points": [
                                "数据可视化工具",
                                "数据分析报告制作"
                            ]
                        }
                    ]
                },
                {
                    "name": "工程实践",
                    "skills": [
                        {
                            "name": "数据战略实施",
                            "level": "L4",
                            "knowledge_points": [
                                "企业级数据战略规划",
                                "数据治理体系建设",
                                "数据团队建设"
                            ]
                        }
                    ]
                }
            ]
        },
        {
            "job_role": "数据采集工程师",
            "direction_name": "数据预处理",
            "dimensions": [
                {
                    "name": "专业知识",
                    "skills": [
                        {
                            "name": "数据采集原理",
                            "level": "L3",
                            "knowledge_points": [
                                "文件采集、日志采集、消息采集、DPI采集",
                                "网络协议(TCP/IP、FTP、HTTP)",
                                "物联网协议(COAP、MQTT)"
                            ]
                        },
                        {
                            "name": "爬虫技术",
                            "level": "L3",
                            "knowledge_points": [
                                "HTML技术",
                                "正则表达式",
                                "爬虫原理"
                            ]
                        }
                    ]
                },
                {
                    "name": "技术技能",
                    "skills": [
                        {
                            "name": "编程语言",
                            "level": "L3",
                            "knowledge_points": [
                                "Python、GO、Java",
                                "标准SQL语言",
                                "MySQL、PostgreSQL"
                            ]
                        },
                        {
                            "name": "爬虫框架",
                            "level": "L3",
                            "knowledge_points": [
                                "Scrapy框架",
                                "二次开发能力"
                            ]
                        },
                        {
                            "name": "消息队列",
                            "level": "L3",
                            "knowledge_points": [
                                "Kafka、Flume、RocketMQ、RabbitMQ",
                                "数据汇聚方案"
                            ]
                        }
                    ]
                },
                {
                    "name": "工程实践",
                    "skills": [
                        {
                            "name": "数据采集方案",
                            "level": "L3",
                            "knowledge_points": [
                                "日志分析",
                                "网页数据爬取",
                                "数据库数据采集",
                                "传感器数据采集"
                            ]
                        }
                    ]
                }
            ]
        },
