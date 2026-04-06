#!/bin/bash

# Script to create a comprehensive demo job model via API
# Usage: TOKEN="your_access_token" ./create_demo_model.sh
# Or: ./create_demo_model.sh your_access_token
# Or: ./create_demo_model.sh (will try to get token automatically)

set -e

API_BASE="http://localhost:8000/api"

# Helper function to extract JSON field
extract_field() {
    echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | cut -d'"' -f4
}

# Try to get/create token
if [ -z "$TOKEN" ] && [ -z "$1" ]; then
    echo "🔐 Getting authorization token..."

    # Try to login with a test user (admin:admin is common default)
    LOGIN_RESPONSE=$(curl -s -X POST \
        "${API_BASE}/auth/login" \
        -H "Content-Type: application/json" \
        -d '{
            "username": "admin",
            "password": "admin"
        }' 2>/dev/null || echo "{}")

    TOKEN=$(extract_field "$LOGIN_RESPONSE" "access_token")

    if [ -z "$TOKEN" ]; then
        echo "❌ Could not auto-login. Token required."
        echo ""
        echo "Usage:"
        echo "  TOKEN=\"your_token\" bash backend/scripts/create_demo_model.sh"
        echo "  OR"
        echo "  bash backend/scripts/create_demo_model.sh \"your_token\""
        echo ""
        echo "To get your access token:"
        echo "  1. Open http://localhost:4000 in your browser"
        echo "  2. Open Developer Tools (F12)"
        echo "  3. Go to Application → Local Storage"
        echo "  4. Find 'access_token' value"
        exit 1
    fi
else
    TOKEN=${TOKEN:-$1}
fi

echo "🚀 Creating comprehensive demo job model..."
echo "Token: ${TOKEN:0:20}..."
echo ""

# Step 1: Create project
echo "📦 Creating project..."
PROJECT_RESPONSE=$(curl -s -X POST \
    "${API_BASE}/job-models/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
        "name": "2024年技术部门招聘",
        "industry": "Technology",
        "description": "2024年度技术部门在线招聘平台的岗位能力模型建设"
    }')

PROJECT_ID=$(echo $PROJECT_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$PROJECT_ID" ]; then
    echo "❌ Failed to create project"
    echo "Response: $PROJECT_RESPONSE"
    exit 1
fi

echo "✓ Created project (ID: $PROJECT_ID)"
echo ""

# Step 2: Create job model with all nested dimensions, skills, and knowledge points
echo "📋 Creating job model with comprehensive structure..."

# Read the dimensions data from a heredoc
read -r -d '' MODEL_JSON << 'EOF' || true
{
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
                        {"name": "Python高级编程", "difficulty": "高级", "teaching_suggestion": "学习Python异步编程、元编程等高级特性", "sort_order": 0},
                        {"name": "Go并发编程", "difficulty": "高级", "teaching_suggestion": "深入学习Goroutine、Channel、并发控制", "sort_order": 1},
                        {"name": "Java企业应用", "difficulty": "中级", "teaching_suggestion": "学习Spring Boot框架、依赖注入、事务管理", "sort_order": 2},
                        {"name": "API设计与RESTful", "difficulty": "高级", "teaching_suggestion": "掌握RESTful设计原则、API版本管理、错误处理", "sort_order": 3}
                    ]
                },
                {
                    "name": "数据库设计",
                    "level": "L4",
                    "description": "深入理解数据库设计和优化",
                    "sort_order": 1,
                    "knowledge_points": [
                        {"name": "关系型数据库设计", "difficulty": "高级", "teaching_suggestion": "学习范式化、反范式化、索引优化", "sort_order": 0},
                        {"name": "SQL优化与性能调优", "difficulty": "高级", "teaching_suggestion": "掌握查询优化、执行计划分析、慢查询处理", "sort_order": 1},
                        {"name": "NoSQL数据库选型", "difficulty": "中级", "teaching_suggestion": "学习MongoDB、Redis、Cassandra等各类数据库", "sort_order": 2},
                        {"name": "分布式数据库", "difficulty": "高级", "teaching_suggestion": "理解一致性模型、分片策略、多主复制", "sort_order": 3}
                    ]
                },
                {
                    "name": "系统架构设计",
                    "level": "L4",
                    "description": "设计和构建可扩展、高可用的系统",
                    "sort_order": 2,
                    "knowledge_points": [
                        {"name": "微服务架构", "difficulty": "高级", "teaching_suggestion": "学习服务拆分、通信协议、服务治理", "sort_order": 0},
                        {"name": "高并发系统设计", "difficulty": "高级", "teaching_suggestion": "掌握限流、缓存、异步处理、负载均衡", "sort_order": 1},
                        {"name": "容错与可用性", "difficulty": "高级", "teaching_suggestion": "学习熔断、降级、重试、超时控制", "sort_order": 2},
                        {"name": "系统监控与日志", "difficulty": "中级", "teaching_suggestion": "掌握Prometheus、ELK、分布式追踪等工具", "sort_order": 3}
                    ]
                }
            ]
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
                        {"name": "代码审查与规范", "difficulty": "中级", "teaching_suggestion": "学习编码规范、设计模式、代码审查流程", "sort_order": 0},
                        {"name": "单元测试与集成测试", "difficulty": "高级", "teaching_suggestion": "掌握TDD、Mock、测试覆盖率分析", "sort_order": 1},
                        {"name": "代码重构与优化", "difficulty": "中级", "teaching_suggestion": "学习重构技巧、性能优化、代码小步快走", "sort_order": 2}
                    ]
                },
                {
                    "name": "开发工具与流程",
                    "level": "L3",
                    "description": "掌握现代开发工具和工作流",
                    "sort_order": 1,
                    "knowledge_points": [
                        {"name": "版本控制与Git", "difficulty": "中级", "teaching_suggestion": "学习Git工作流、分支策略、冲突解决", "sort_order": 0},
                        {"name": "CI/CD流程", "difficulty": "中级", "teaching_suggestion": "掌握Jenkins/GitLab CI、自动化测试、灰度发布", "sort_order": 1},
                        {"name": "容器化与K8s", "difficulty": "中级", "teaching_suggestion": "学习Docker、Kubernetes基本概念和操作", "sort_order": 2}
                    ]
                },
                {
                    "name": "文档与沟通",
                    "level": "L3",
                    "description": "清晰地传达技术方案和设计",
                    "sort_order": 2,
                    "knowledge_points": [
                        {"name": "技术文档编写", "difficulty": "中级", "teaching_suggestion": "学习API文档、架构文档、设计文档的编写", "sort_order": 0},
                        {"name": "设计评审与方案讨论", "difficulty": "中级", "teaching_suggestion": "学习技术演讲、方案论证、充分听取意见", "sort_order": 1}
                    ]
                }
            ]
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
                        {"name": "跨部门沟通", "difficulty": "中级", "teaching_suggestion": "学习有效沟通技巧、同理心、冲突解决", "sort_order": 0},
                        {"name": "知识分享与培养", "difficulty": "中级", "teaching_suggestion": "学习mentor新人、组织分享会、文档沉淀", "sort_order": 1}
                    ]
                },
                {
                    "name": "责任心与主动性",
                    "level": "L4",
                    "description": "主动承担责任，追求卓越",
                    "sort_order": 1,
                    "knowledge_points": [
                        {"name": "技术债管理", "difficulty": "中级", "teaching_suggestion": "识别技术债、评估影响、推进解决", "sort_order": 0},
                        {"name": "问题解决能力", "difficulty": "高级", "teaching_suggestion": "学习问题定位、根因分析、制定解决方案", "sort_order": 1},
                        {"name": "持续学习与自我提升", "difficulty": "中级", "teaching_suggestion": "制定学习计划、跟踪技术动态、参加社区", "sort_order": 2}
                    ]
                }
            ]
        }
    ]
}
EOF

MODEL_RESPONSE=$(curl -s -X POST \
    "${API_BASE}/job-models/projects/${PROJECT_ID}/models" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "$MODEL_JSON")

MODEL_ID=$(echo $MODEL_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$MODEL_ID" ]; then
    echo "❌ Failed to create model"
    echo "Response: $MODEL_RESPONSE"
    exit 1
fi

echo "✓ Created job model (ID: $MODEL_ID)"
echo ""

# Parse the response to show stats
DIMENSIONS=$(echo $MODEL_RESPONSE | grep -o '"name":"[^"]*"' | wc -l)
echo "📊 Model Details:"
echo "  - Project: 2024年技术部门招聘"
echo "  - Job Title: 高级后端工程师"
echo "  - Dimensions: 4"
echo "  - Total Skills: 9"
echo "  - Total Knowledge Points: 25"
echo ""

echo "✅ Demo job model created successfully!"
echo ""
echo "📂 Navigate to the app:"
echo "   http://localhost:4000/job-models"
echo ""
echo "   Click on '高级后端工程师' to view and edit the model in the editor."
