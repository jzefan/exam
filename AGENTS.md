# Project Agent Instructions

## Skill Usage

- Do not use any `superpowers:*` skills for this project.
- If a task would normally trigger a `superpowers:*` skill, handle it with the standard project workflow instead.
- Other project-local skills, such as `.agents/skills/shadcn`, may still be used when directly relevant.

## Plugin Workflow

- Use the Browser plugin to verify known local frontend routes after meaningful UI changes, especially mobile exam-taking flows. Prefer it over Chrome or generic computer-use automation for localhost work.
- Use the Build Web Apps plugin for React, Vite, responsive UI, Playwright, and browser-debugging tasks. Preserve the existing React 19, Tailwind, Radix, and shadcn patterns.
- Use the GitHub plugin only for explicit repository, issue, pull request, review-comment, CI, commit, push, or publish requests. Never stage or publish unrelated changes from this frequently dirty worktree.
- Use Codex Security only when security review is explicitly requested. Prioritize RBAC, public exam links, uploads and document parsing, secrets, SQLAlchemy queries, Docker and Nginx configuration, and judge/LSP code-execution boundaries.
- Do not use cloud-service plugins such as Vercel, Netlify, Neon, Supabase, Sentry, or Figma unless the repository adopts that service or the user explicitly requests it.

## AI UI Design Rules

- UI 设计默认收敛、克制、常规。尺寸与间距应根据界面类型、信息密度、平台习惯、使用频率和视觉层级判断，不写死统一规格，也不主动放大。辅助入口、设置、开关和工具按钮不应抢占视觉中心。常见功能必须使用大众通用、用户一眼可识别的图标隐喻，优先使用成熟图标库、系统图标或行业通用符号；不得为了差异化自创奇怪图标，自定义图标也必须保持常见轮廓、比例和语义。除非明确要求强调，否则优先通过位置、分组、轻微颜色、hover、tooltip、分隔线和状态反馈表达层级，避免夸张尺寸、重色块、大圆角、厚边框、强阴影、装饰性渐变和营销页式布局。实现后必须与同屏元素对比检查；若显得突兀、过大、过重或破坏信息密度，应主动收敛。
- UI 文案只显示完成任务所需的最少内容和元素，避免解释性、重复或啰嗦的文案。

## PageIntroHeader Sticky 规范

`PageIntroHeader` 组件启用 sticky 时**必须**用 `embedded` 模式 + `ml-[calc(50%-50vw)] w-screen`，**禁止**用 `fullBleed`。

```tsx
// ✅ 正确
<PageIntroHeader
  embedded
  className="sticky top-0 z-20 -mt-6 mb-6 ml-[calc(50%-50vw)] w-screen"
/>

// ❌ 错误：fullBleed + sticky → left-1/2 变为 sticky 偏移，header 移出视口
<PageIntroHeader fullBleed className="sticky top-0 z-20 mb-6" />

// ❌ 错误：-mx-4 只能延伸到 Layout max-w-screen-xl(1280px)，视口更宽时两侧留白
<PageIntroHeader embedded className="sticky top-0 z-20 -mt-6 -mx-4 sm:-mx-6" />
```

原理：`fullBleed` 生成 `relative left-1/2 -ml-[50vw] w-screen`，tailwind-merge 将 `relative` 改为 `sticky` 后 `left: 50%` 变为吸附偏移量导致偏移。`ml-[calc(50%-50vw)]` 用 margin 代替 left，不受 sticky 影响。

## Planning

- 多步任务、跨模块改动、有架构取舍 → 先出方案再动手。
- 小改动（改文案、调样式、修一个已定位的 bug）→ 直接改完收工，不要为它写计划、建 todo。
- 方向走偏了立刻停下重新规划，不要硬推。

## 分级验证（核心规则）

**验证强度跟着「改动影响面」走，不跟着改动行数，也不跟着仪式感走。默认取最低档，只有确实碰到共享代码才升级。**

| 档位 | 什么改动 | 要做到 | 不必做 |
|---|---|---|---|
| **L0 界面微调** | 文案、样式、间距、颜色、图标、单个页面的展示细节 | 改的文件能编译；能开页面就扫一眼 | ❌ 不跑测试套件　❌ 不补新测试　❌ 不建 todo |
| **L1 单页逻辑** | 某页交互逻辑、局部组件、单个 API 调用 | 相关文件类型检查 + 该模块已有测试 | ❌ 不跑全量回归　❌ 不起服务做端到端 |
| **L2 跨模块** | 后端接口、数据模型、权限、多页共用的 store / 组件 / 工具函数 | 相关模块测试 + 真实走一遍主流程 | — |
| **L3 高危** | 部署配置、数据迁移、批量改写、不可逆操作 | 全量验证 + 备份 + 明确回滚方式 | — |

- 只有用户明确要求时才跑全量回归。
- **禁止为了"看起来很严谨"而堆测试**：一次界面微调后面跟着一长串回归用例，是浪费，不是负责。
- 但"不测"不等于"不报"：跑了什么、没跑什么、为什么不需要跑，如实说清。错误必须暴露，不许静默失败。
- 判不准档位时按低档执行，并在回复里说明判断依据。
- **`exam-local-e2e-verify` 技能是 L2/L3 工具**：需要真实浏览器 / 真实链路 / 第三方会话时才用它，一次只挑其中一条路子；L0/L1 不要进。

### 各档具体命令

- **L0**：`cd frontend && npx tsc -b`（或后端同层类型/语法检查）。够。
- **L1**：`npx tsc -b` + `pnpm exec vitest run <改动模块的测试路径>`；后端 `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest <路径>`。
- **L2**：L1 的命令 + 真实走一遍主流程（起自己的 4100/8100，不碰用户的 4000/8000，见 `exam-local-e2e-verify`）。
- **L3**：全量 `pnpm exec vitest run` / 全量 pytest，加备份与回滚说明。**注意** `vitest run` 会把 `src/test/e2e/*.spec.ts`（Playwright 用例）一起收集并必然失败，统计时扣掉；既有失败基线见 `exam-local-e2e-verify`。
- 数据库：加迁移前先 `alembic heads`；不对共享 / 生产库做破坏性操作。
- 部署：只校验 Compose 与脚本，不重建、不 prune、不迁移、不连生产，除非明确要求。
- 沙箱里 `pnpm build` 会因清 `dist` 被拦而报失败，这不是代码错；要真实结论用 `npx vite build --outDir .build-check --emptyOutDir`。
