#!/usr/bin/env python3
"""Create demo job model via API calls."""

import json
import subprocess
import sys

# Demo model data structure with nested dimensions, skills, and knowledge points
demo_model = {
    "name": "2024年技术部门招聘",
    "industry": "Technology",
    "description": "2024年度技术部门在线招聘平台的岗位能力模型建设",
    "job_role": "高级后端工程师",
    "version_note": "初始版本",
    "source_type": "manual",
    "dimensions": [
        {
            "name": "技术能力",
            "description": "后端工程师需要掌握的核心技术能力",
            "sort_order": 0,
            "skills": [
                {
                    "name": "后端开发基础",
                    "level": "L4",
                    "description": "掌握多种编程语言和开发框架",
                    "sort_order": 0,
                    "knowledge_points": [
                        {
                            "name": "Python高级编程",
                            "difficulty": "高级",
                            "teaching_suggestion": "学习Python异步编程、元编程等高级特性",
                            "sort_order": 0,
                        },
                        {
                            "name": "Go并发编程",
                            "difficulty": "高级",
                            "teaching_suggestion": "深入学习Goroutine、Channel、并发控制",
                            "sort_order": 1,
                        },
                        {
                            "name": "Java企业应用",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习Spring Boot框架、依赖注入、事务管理",
                            "sort_order": 2,
                        },
                        {
                            "name": "API设计与RESTful",
                            "difficulty": "高级",
                            "teaching_suggestion": "掌握RESTful设计原则、API版本管理、错误处理",
                            "sort_order": 3,
                        },
                    ],
                },
                {
                    "name": "数据库设计",
                    "level": "L4",
                    "description": "深入理解数据库设计和优化",
                    "sort_order": 1,
                    "knowledge_points": [
                        {
                            "name": "关系型数据库设计",
                            "difficulty": "高级",
                            "teaching_suggestion": "学习范式化、反范式化、索引优化",
                            "sort_order": 0,
                        },
                        {
                            "name": "SQL优化与性能调优",
                            "difficulty": "高级",
                            "teaching_suggestion": "掌握查询优化、执行计划分析、慢查询处理",
                            "sort_order": 1,
                        },
                        {
                            "name": "NoSQL数据库选型",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习MongoDB、Redis、Cassandra等各类数据库",
                            "sort_order": 2,
                        },
                        {
                            "name": "分布式数据库",
                            "difficulty": "高级",
                            "teaching_suggestion": "理解一致性模型、分片策略、多主复制",
                            "sort_order": 3,
                        },
                    ],
                },
                {
                    "name": "系统架构设计",
                    "level": "L4",
                    "description": "设计和构建可扩展、高可用的系统",
                    "sort_order": 2,
                    "knowledge_points": [
                        {
                            "name": "微服务架构",
                            "difficulty": "高级",
                            "teaching_suggestion": "学习服务拆分、通信协议、服务治理",
                            "sort_order": 0,
                        },
                        {
                            "name": "高并发系统设计",
                            "difficulty": "高级",
                            "teaching_suggestion": "掌握限流、缓存、异步处理、负载均衡",
                            "sort_order": 1,
                        },
                        {
                            "name": "容错与可用性",
                            "difficulty": "高级",
                            "teaching_suggestion": "学习熔断、降级、重试、超时控制",
                            "sort_order": 2,
                        },
                        {
                            "name": "系统监控与日志",
                            "difficulty": "中级",
                            "teaching_suggestion": "掌握Prometheus、ELK、分布式追踪等工具",
                            "sort_order": 3,
                        },
                    ],
                },
            ],
        },
        {
            "name": "工程实践",
            "description": "软件工程方面的专业能力",
            "sort_order": 1,
            "skills": [
                {
                    "name": "代码质量",
                    "level": "L4",
                    "description": "编写高质量、易维护的代码",
                    "sort_order": 0,
                    "knowledge_points": [
                        {
                            "name": "代码审查与规范",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习编码规范、设计模式、代码审查流程",
                            "sort_order": 0,
                        },
                        {
                            "name": "单元测试与集成测试",
                            "difficulty": "高级",
                            "teaching_suggestion": "掌握TDD、Mock、测试覆盖率分析",
                            "sort_order": 1,
                        },
                        {
                            "name": "代码重构与优化",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习重构技巧、性能优化、代码小步快走",
                            "sort_order": 2,
                        },
                    ],
                },
                {
                    "name": "开发工具与流程",
                    "level": "L3",
                    "description": "掌握现代开发工具和工作流",
                    "sort_order": 1,
                    "knowledge_points": [
                        {
                            "name": "版本控制与Git",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习Git工作流、分支策略、冲突解决",
                            "sort_order": 0,
                        },
                        {
                            "name": "CI/CD流程",
                            "difficulty": "中级",
                            "teaching_suggestion": "掌握Jenkins/GitLab CI、自动化测试、灰度发布",
                            "sort_order": 1,
                        },
                        {
                            "name": "容器化与K8s",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习Docker、Kubernetes基本概念和操作",
                            "sort_order": 2,
                        },
                    ],
                },
                {
                    "name": "文档与沟通",
                    "level": "L3",
                    "description": "清晰地传达技术方案和设计",
                    "sort_order": 2,
                    "knowledge_points": [
                        {
                            "name": "技术文档编写",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习API文档、架构文档、设计文档的编写",
                            "sort_order": 0,
                        },
                        {
                            "name": "设计评审与方案讨论",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习技术演讲、方案论证、充分听取意见",
                            "sort_order": 1,
                        },
                    ],
                },
            ],
        },
        {
            "name": "软实力",
            "description": "综合素质和职业发展能力",
            "sort_order": 2,
            "skills": [
                {
                    "name": "团队协作",
                    "level": "L3",
                    "description": "与团队高效协作，为他人赋能",
                    "sort_order": 0,
                    "knowledge_points": [
                        {
                            "name": "跨部门沟通",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习有效沟通技巧、同理心、冲突解决",
                            "sort_order": 0,
                        },
                        {
                            "name": "知识分享与培养",
                            "difficulty": "中级",
                            "teaching_suggestion": "学习mentor新人、组织分享会、文档沉淀",
                            "sort_order": 1,
                        },
                    ],
                },
                {
                    "name": "责任心与主动性",
                    "level": "L4",
                    "description": "主动承担责任，追求卓越",
                    "sort_order": 1,
                    "knowledge_points": [
                        {
                            "name": "技术债管理",
                            "difficulty": "中级",
                            "teaching_suggestion": "识别技术债、评估影响、推进解决",
                            "sort_order": 0,
                        },
                        {
                            "name": "问题解决能力",
                            "difficulty": "高级",
                            "teaching_suggestion": "学习问题定位、根因分析、制定解决方案",
                            "sort_order": 1,
                        },
                        {
                            "name": "持续学习与自我提升",
                            "difficulty": "中级",
                            "teaching_suggestion": "制定学习计划、跟踪技术动态、参加社区",
                            "sort_order": 2,
                        },
                    ],
                },
            ],
        },
    ],
}


def get_auth_token():
    """Get auth token from the running app or via CLI."""
    # Try to read from localStorage if browser is available
    # Otherwise, use credentials to login
    print("Getting auth token...")

    # Try to get from environment variable if set
    token = None

    # For now, we'll try to login with default credentials
    # Assuming there's a test user available
    login_response = subprocess.run(
        [
            "curl",
            "-s",
            "-X",
            "POST",
            "http://localhost:8000/api/auth/login",
            "-H",
            "Content-Type: application/json",
            "-d",
            '{"username":"admin","password":"123456"}',
        ],
        capture_output=True,
        text=True,
    )

    if login_response.returncode == 0:
        try:
            data = json.loads(login_response.stdout)
            token = data.get("access_token")
            if token:
                print(f"✓ Got auth token: {token[:20]}...")
                return token
        except json.JSONDecodeError:
            pass

    print("Could not get auth token automatically.")
    print("Make sure you're logged in to the app.")
    token = input("Enter your access token (from browser dev tools > Application > localStorage): ").strip()
    return token


def create_project_and_model(token):
    """Create project and model via API."""
    # Step 1: Create project
    project_data = {
        "name": demo_model["name"],
        "industry": demo_model["industry"],
        "description": demo_model["description"],
    }

    print("\n📦 Creating project...")
    project_response = subprocess.run(
        [
            "curl",
            "-s",
            "-X",
            "POST",
            "http://localhost:8000/api/job-models/projects",
            "-H",
            "Content-Type: application/json",
            "-H",
            f"Authorization: Bearer {token}",
            "-d",
            json.dumps(project_data),
        ],
        capture_output=True,
        text=True,
    )

    if project_response.returncode != 0:
        print(f"❌ Failed to create project: {project_response.stderr}")
        return False

    try:
        project = json.loads(project_response.stdout)
        project_id = project["id"]
        print(f"✓ Created project: {project['name']} (ID: {project_id})")
    except (json.JSONDecodeError, KeyError) as e:
        print(f"❌ Invalid response: {project_response.stdout}")
        return False

    # Step 2: Create job model with all dimensions, skills, and knowledge points
    model_data = {
        "job_role": demo_model["job_role"],
        "version_note": demo_model["version_note"],
        "source_type": demo_model["source_type"],
        "dimensions": demo_model["dimensions"],
    }

    print(f"\n📋 Creating job model with nested structure...")
    model_response = subprocess.run(
        [
            "curl",
            "-s",
            "-X",
            "POST",
            f"http://localhost:8000/api/job-models/projects/{project_id}/models",
            "-H",
            "Content-Type: application/json",
            "-H",
            f"Authorization: Bearer {token}",
            "-d",
            json.dumps(model_data),
        ],
        capture_output=True,
        text=True,
    )

    if model_response.returncode != 0:
        print(f"❌ Failed to create model: {model_response.stderr}")
        return False

    try:
        model = json.loads(model_response.stdout)
        model_id = model["id"]
        print(f"✓ Created job model: {model['job_role']} (ID: {model_id})")
        print(f"  - Dimensions: {len(model.get('dimensions', []))}")

        total_skills = 0
        total_kps = 0
        for dim in model.get("dimensions", []):
            skills = dim.get("skills", [])
            total_skills += len(skills)
            for skill in skills:
                total_kps += len(skill.get("knowledge_points", []))

        print(f"  - Skills: {total_skills}")
        print(f"  - Knowledge Points: {total_kps}")

        return True
    except (json.JSONDecodeError, KeyError) as e:
        print(f"❌ Invalid response: {model_response.stdout}")
        return False


if __name__ == "__main__":
    print("🚀 Creating comprehensive demo job model...\n")

    token = get_auth_token()
    if not token:
        print("❌ Could not get auth token. Exiting.")
        sys.exit(1)

    success = create_project_and_model(token)

    if success:
        print("\n✅ Demo job model created successfully!")
        print("\n📂 Navigate to: http://localhost:4000/job-models")
        print("   Click on the job model to view and edit it in the editor.")
    else:
        print("\n❌ Failed to create demo model. Check the errors above.")
        sys.exit(1)
