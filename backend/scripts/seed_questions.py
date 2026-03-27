"""Seed script: inserts demo tags, knowledge points, and questions."""

import asyncio
import sys
from pathlib import Path

# Allow running from project root: python scripts/seed_questions.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from sqlalchemy import select

from app.auth.models import User
from app.database import async_session
from app.questions.models import KnowledgePoint, Question, QuestionType, Tag, TagType


async def seed() -> None:
    async with async_session() as session:
        # --- Get first user as creator ---
        result = await session.execute(select(User).where(User.deleted_at.is_(None)).limit(1))
        user = result.scalar_one_or_none()
        if user is None:
            print("ERROR: No users found. Create a user first.")
            return

        # Check if already seeded
        existing = await session.execute(select(Tag).limit(1))
        if existing.scalar_one_or_none():
            print("Seed data already exists, skipping.")
            return

        print(f"Using creator: {user.full_name} ({user.id})")

        # --- Tags ---
        tags_data = [
            ("数据结构", TagType.KNOWLEDGE),
            ("算法", TagType.KNOWLEDGE),
            ("操作系统", TagType.KNOWLEDGE),
            ("计算机网络", TagType.KNOWLEDGE),
            ("计算机科学", TagType.SUBJECT),
            ("软件工程", TagType.SUBJECT),
            ("期末考试", TagType.PURPOSE),
            ("练习", TagType.PURPOSE),
            ("面试题", TagType.CUSTOM),
            ("重点", TagType.CUSTOM),
        ]
        tags: dict[str, Tag] = {}
        for name, tag_type in tags_data:
            tag = Tag(name=name, type=tag_type)
            session.add(tag)
            tags[name] = tag
        await session.flush()
        print(f"Created {len(tags)} tags")

        # --- Knowledge Points ---
        kps_data = [
            ("排序算法", None, "冒泡、快速、归并、堆排序等"),
            ("链表", None, "单链表、双链表、循环链表"),
            ("二叉树", None, "遍历、平衡树、搜索树"),
            ("进程管理", None, "进程调度、同步、死锁"),
            ("内存管理", None, "分页、分段、虚拟内存"),
        ]
        kps: dict[str, KnowledgePoint] = {}
        for name, parent, desc in kps_data:
            kp = KnowledgePoint(name=name, parent_id=parent, description=desc)
            session.add(kp)
            kps[name] = kp
        await session.flush()
        print(f"Created {len(kps)} knowledge points")

        # --- Questions ---
        questions_data = [
            # Choice questions
            {
                "type": QuestionType.CHOICE,
                "title": "以下哪种排序算法的平均时间复杂度为O(nlogn)？",
                "content": {"text": "以下哪种排序算法的平均时间复杂度为O(nlogn)？"},
                "options": {"A": "冒泡排序", "B": "快速排序", "C": "插入排序", "D": "选择排序"},
                "answer": {"correct": "B"},
                "analysis": "快速排序的平均时间复杂度为O(nlogn)，最坏情况为O(n²)。",
                "difficulty": 2,
                "score": 5.0,
                "tags": ["算法", "数据结构", "练习"],
                "kps": ["排序算法"],
            },
            {
                "type": QuestionType.CHOICE,
                "title": "TCP协议属于OSI模型的哪一层？",
                "content": {"text": "TCP协议属于OSI模型的哪一层？"},
                "options": {"A": "物理层", "B": "数据链路层", "C": "网络层", "D": "传输层"},
                "answer": {"correct": "D"},
                "analysis": "TCP是传输层协议，提供可靠的端到端通信。",
                "difficulty": 1,
                "score": 5.0,
                "tags": ["计算机网络", "练习"],
                "kps": [],
            },
            {
                "type": QuestionType.CHOICE,
                "title": "在完全二叉树中，若节点总数为n，则叶子节点数为？",
                "content": {"text": "在完全二叉树中，若节点总数为n，则叶子节点数为？"},
                "options": {"A": "n/2", "B": "⌊n/2⌋", "C": "⌈n/2⌉", "D": "(n+1)/2"},
                "answer": {"correct": "C"},
                "analysis": "完全二叉树的叶子节点数为⌈n/2⌉。",
                "difficulty": 3,
                "score": 5.0,
                "tags": ["数据结构", "期末考试"],
                "kps": ["二叉树"],
            },
            {
                "type": QuestionType.CHOICE,
                "title": "哪种页面置换算法会产生Belady异常？",
                "content": {"text": "以下哪种页面置换算法可能会出现Belady异常现象？"},
                "options": {"A": "FIFO", "B": "LRU", "C": "OPT", "D": "LFU"},
                "answer": {"correct": "A"},
                "analysis": "FIFO页面置换算法可能出现Belady异常，即分配更多物理页框反而缺页率上升。",
                "difficulty": 4,
                "score": 5.0,
                "tags": ["操作系统", "期末考试", "重点"],
                "kps": ["内存管理"],
            },
            # True/False questions
            {
                "type": QuestionType.TRUE_FALSE,
                "title": "栈是一种先进先出(FIFO)的数据结构",
                "content": {"text": "栈是一种先进先出(FIFO)的数据结构。判断对错。"},
                "options": None,
                "answer": {"correct": False, "explanation": "栈是后进先出(LIFO)的数据结构"},
                "analysis": "栈(Stack)遵循后进先出(LIFO)原则，队列(Queue)才是先进先出(FIFO)。",
                "difficulty": 1,
                "score": 3.0,
                "tags": ["数据结构", "练习"],
                "kps": [],
            },
            {
                "type": QuestionType.TRUE_FALSE,
                "title": "死锁的四个必要条件缺一不可",
                "content": {"text": "产生死锁必须同时满足互斥、占有并等待、非抢占和循环等待四个条件。"},
                "options": None,
                "answer": {"correct": True},
                "analysis": "死锁的四个必要条件：互斥、占有并等待、非抢占、循环等待，四者缺一不可。",
                "difficulty": 2,
                "score": 3.0,
                "tags": ["操作系统", "练习"],
                "kps": ["进程管理"],
            },
            {
                "type": QuestionType.TRUE_FALSE,
                "title": "快速排序在最坏情况下时间复杂度为O(nlogn)",
                "content": {"text": "快速排序在最坏情况下的时间复杂度为O(nlogn)。"},
                "options": None,
                "answer": {"correct": False, "explanation": "最坏情况为O(n²)"},
                "analysis": "快速排序最坏情况（已排序数组，每次选首元素为pivot）时间复杂度为O(n²)。",
                "difficulty": 2,
                "score": 3.0,
                "tags": ["算法", "练习"],
                "kps": ["排序算法"],
            },
            # Fill-in questions
            {
                "type": QuestionType.FILL_IN,
                "title": "单链表中删除节点的时间复杂度",
                "content": {"text": "在已知前驱节点的情况下，单链表中删除一个节点的时间复杂度为____。"},
                "options": None,
                "answer": {"correct": "O(1)"},
                "analysis": "已知前驱节点时，只需修改前驱的next指针，时间复杂度为O(1)。",
                "difficulty": 2,
                "score": 5.0,
                "tags": ["数据结构", "练习"],
                "kps": ["链表"],
            },
            {
                "type": QuestionType.FILL_IN,
                "title": "二叉树的前序遍历顺序",
                "content": {"text": "二叉树的前序遍历顺序为：____→左子树→右子树。"},
                "options": None,
                "answer": {"correct": "根节点"},
                "analysis": "前序遍历(Pre-order)：根→左→右；中序：左→根→右；后序：左→右→根。",
                "difficulty": 1,
                "score": 5.0,
                "tags": ["数据结构", "练习"],
                "kps": ["二叉树"],
            },
            {
                "type": QuestionType.FILL_IN,
                "title": "进程的三种基本状态",
                "content": {"text": "进程的三种基本状态分别是：就绪态、运行态和____。"},
                "options": None,
                "answer": {"correct": "阻塞态"},
                "analysis": "进程三态：就绪(Ready)、运行(Running)、阻塞/等待(Blocked/Waiting)。",
                "difficulty": 1,
                "score": 5.0,
                "tags": ["操作系统", "练习"],
                "kps": ["进程管理"],
            },
            # Short answer questions
            {
                "type": QuestionType.SHORT_ANSWER,
                "title": "简述快速排序的基本思想",
                "content": {"text": "请简述快速排序算法的基本思想及其平均时间复杂度。"},
                "options": None,
                "answer": {"points": ["选择基准元素(pivot)", "将数组分为小于和大于pivot的两部分", "递归排序两部分", "平均时间复杂度O(nlogn)"]},
                "analysis": "快排核心是分治思想：选pivot，partition分区，递归。平均O(nlogn)，最坏O(n²)。",
                "difficulty": 3,
                "score": 10.0,
                "tags": ["算法", "数据结构", "期末考试"],
                "kps": ["排序算法"],
            },
            {
                "type": QuestionType.SHORT_ANSWER,
                "title": "解释虚拟内存的概念及其优点",
                "content": {"text": "请解释虚拟内存的概念，并说明其至少两个优点。"},
                "options": None,
                "answer": {"points": ["虚拟内存是一种内存管理技术", "将物理内存和磁盘结合使用", "优点：突破物理内存限制", "优点：提供内存保护和隔离"]},
                "analysis": "虚拟内存通过页表映射，让每个进程拥有独立的地址空间，按需调页。",
                "difficulty": 3,
                "score": 10.0,
                "tags": ["操作系统", "期末考试"],
                "kps": ["内存管理"],
            },
            {
                "type": QuestionType.SHORT_ANSWER,
                "title": "比较数组和链表的优缺点",
                "content": {"text": "请从时间复杂度和空间利用率两个角度，比较数组和链表的优缺点。"},
                "options": None,
                "answer": {"points": ["数组：随机访问O(1)，插入删除O(n)", "链表：随机访问O(n)，插入删除O(1)", "数组空间连续，可能浪费", "链表空间灵活，额外存储指针"]},
                "analysis": None,
                "difficulty": 2,
                "score": 10.0,
                "tags": ["数据结构", "面试题"],
                "kps": ["链表"],
            },
            # Essay questions
            {
                "type": QuestionType.ESSAY,
                "title": "论述操作系统中进程同步的几种机制",
                "content": {"text": "请详细论述操作系统中实现进程同步的主要机制，包括信号量、管程、消息传递等，并比较它们的优缺点。"},
                "options": None,
                "answer": {"key_points": ["信号量机制（P/V操作）", "管程（Monitor）", "消息传递", "各机制的优缺点比较"]},
                "analysis": None,
                "difficulty": 5,
                "score": 20.0,
                "tags": ["操作系统", "期末考试", "重点"],
                "kps": ["进程管理"],
            },
            {
                "type": QuestionType.ESSAY,
                "title": "讨论B树和B+树在数据库索引中的应用",
                "content": {"text": "请讨论B树和B+树的结构特点，以及为什么B+树更适合作为数据库索引结构。"},
                "options": None,
                "answer": {"key_points": ["B树结构特点", "B+树结构特点", "B+树叶子节点链表", "磁盘IO优化", "范围查询效率"]},
                "analysis": None,
                "difficulty": 4,
                "score": 20.0,
                "tags": ["数据结构", "期末考试", "重点"],
                "kps": ["二叉树"],
            },
            # Code questions
            {
                "type": QuestionType.CODE,
                "title": "实现二叉树的层序遍历",
                "content": {"text": "请用Python实现二叉树的层序遍历（广度优先遍历），返回每层节点值的列表。", "language": "python"},
                "options": None,
                "answer": {"code": "def level_order(root):\n    if not root:\n        return []\n    result, queue = [], [root]\n    while queue:\n        level = []\n        for _ in range(len(queue)):\n            node = queue.pop(0)\n            level.append(node.val)\n            if node.left: queue.append(node.left)\n            if node.right: queue.append(node.right)\n        result.append(level)\n    return result"},
                "analysis": "使用BFS，利用队列按层遍历。时间复杂度O(n)，空间复杂度O(n)。",
                "difficulty": 3,
                "score": 15.0,
                "tags": ["数据结构", "算法", "面试题"],
                "kps": ["二叉树"],
            },
            {
                "type": QuestionType.CODE,
                "title": "实现单链表的反转",
                "content": {"text": "请用Python实现单链表的反转（迭代方式）。", "language": "python"},
                "options": None,
                "answer": {"code": "def reverse_list(head):\n    prev, curr = None, head\n    while curr:\n        next_node = curr.next\n        curr.next = prev\n        prev = curr\n        curr = next_node\n    return prev"},
                "analysis": "迭代反转：维护prev和curr指针，逐个反转next指向。时间O(n)，空间O(1)。",
                "difficulty": 2,
                "score": 15.0,
                "tags": ["数据结构", "算法", "面试题"],
                "kps": ["链表"],
            },
            {
                "type": QuestionType.CODE,
                "title": "实现快速排序算法",
                "content": {"text": "请用Python实现快速排序算法。", "language": "python"},
                "options": None,
                "answer": {"code": "def quicksort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quicksort(left) + middle + quicksort(right)"},
                "analysis": "选中间元素作为pivot，将数组分为三部分递归排序。此版本简洁但非原地排序。",
                "difficulty": 3,
                "score": 15.0,
                "tags": ["算法", "期末考试", "面试题"],
                "kps": ["排序算法"],
            },
            {
                "type": QuestionType.CODE,
                "title": "实现生产者-消费者模型",
                "content": {"text": "请用Python的threading模块实现一个简单的生产者-消费者模型。", "language": "python"},
                "options": None,
                "answer": {"code": "import threading\nimport queue\n\ndef producer(q, n):\n    for i in range(n):\n        q.put(i)\n    q.put(None)\n\ndef consumer(q):\n    while True:\n        item = q.get()\n        if item is None:\n            break\n        print(f'Consumed: {item}')"},
                "analysis": "使用queue.Queue实现线程安全的生产者-消费者模型，Queue内部已实现锁机制。",
                "difficulty": 4,
                "score": 15.0,
                "tags": ["操作系统", "算法", "面试题"],
                "kps": ["进程管理"],
            },
        ]

        for qdata in questions_data:
            question = Question(
                type=qdata["type"],
                title=qdata["title"],
                content=qdata["content"],
                options=qdata["options"],
                answer=qdata["answer"],
                analysis=qdata["analysis"],
                difficulty=qdata["difficulty"],
                score=qdata["score"],
                created_by=user.id,
            )
            question.tags = [tags[t] for t in qdata["tags"]]
            question.knowledge_points = [kps[k] for k in qdata["kps"]]
            session.add(question)

        await session.commit()
        print(f"Created {len(questions_data)} questions")
        print("Seed complete!")


if __name__ == "__main__":
    asyncio.run(seed())
