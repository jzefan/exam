"""Seed script: inserts 10 demo question banks."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from app.auth.models import User  # noqa: F401 — needed for relationship resolution
from app.database import async_session
from app.questions.models import QuestionBank


BANKS = [
    ("高等数学", "微积分、线性代数、概率论"),
    ("大学物理", "力学、热学、电磁学、光学"),
    ("数据结构", "线性表、树、图、排序与查找"),
    ("操作系统", "进程管理、内存管理、文件系统"),
    ("计算机网络", "TCP/IP、HTTP、路由与交换"),
    ("数据库原理", "关系模型、SQL、事务与并发控制"),
    ("编译原理", "词法分析、语法分析、代码生成"),
    ("软件工程", "需求分析、设计模式、测试方法"),
    ("人工智能导论", "搜索算法、机器学习基础、神经网络"),
    ("离散数学", "集合论、图论、数理逻辑"),
]


async def seed() -> None:
    async with async_session() as session:
        for name, desc in BANKS:
            session.add(QuestionBank(name=name, description=desc))
        await session.commit()
        print(f"Created {len(BANKS)} question banks.")


if __name__ == "__main__":
    asyncio.run(seed())
