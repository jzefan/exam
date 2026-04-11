# Student Top Nav Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move student navigation into the top header and center student content in a 1200px viewport.

**Architecture:** Update the shared student shell so the header owns primary navigation and the content viewport owns width constraints. Keep page-level content structure intact, only removing conflicting student-page max-width wrappers where needed.

**Tech Stack:** React, React Router, Vitest, Testing Library, Tailwind/Uno utility classes

---

### Task 1: Lock the new shell behavior with tests

**Files:**
- Modify: `frontend/src/components/student-layout.test.tsx`

- [ ] Add a failing test that expects the student shell to render top navigation links and use a centered 1200px content container.
- [ ] Run: `cd frontend && pnpm test src/components/student-layout.test.tsx --run`
- [ ] Confirm the test fails for the expected layout assertion.

### Task 2: Move student navigation into the header

**Files:**
- Modify: `frontend/src/components/student-layout.tsx`

- [ ] Move `工作台 / 我的考试 / 错题回顾` from the sidebar into the header after the logo.
- [ ] Remove the old sidebar structure and keep the right side for theme customization and account actions.
- [ ] Make the main content container use `max-w-[1200px] mx-auto`.

### Task 3: Remove conflicting student-page width caps

**Files:**
- Modify: `frontend/src/pages/student/my-exams.tsx`
- Modify: `frontend/src/pages/student/wrong-answers.tsx`

- [ ] Replace page-local `max-w-4xl` / `max-w-5xl` wrappers with shell-friendly full-width containers.
- [ ] Keep page internals unchanged aside from width constraints.

### Task 4: Verify

**Files:**
- Test: `frontend/src/components/student-layout.test.tsx`
- Test: `frontend/src/pages/student/my-exams.test.tsx`

- [ ] Run: `cd frontend && pnpm test src/components/student-layout.test.tsx src/pages/student/my-exams.test.tsx --run`
- [ ] Run: `cd frontend && pnpm exec tsc --noEmit`
- [ ] Confirm all checks pass.
