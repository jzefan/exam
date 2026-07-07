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

## Verification Defaults

- Frontend: run focused Vitest tests first, then `pnpm build`; use Playwright or Browser verification when interaction or responsive behavior changed.
- Backend: run focused pytest tests with `PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest`, then broader checks only when justified.
- Database changes: inspect Alembic heads before adding migrations and avoid destructive operations against shared or production data.
- Deployment changes: validate Docker Compose configuration and deployment scripts without rebuilding, pruning, migrating, or connecting to production unless explicitly requested.
