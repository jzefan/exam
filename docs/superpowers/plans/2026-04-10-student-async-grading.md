# Student Async Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement objective-immediate scoring, subjective AI async scoring, teacher confirmation, and student notification popup.

**Architecture:** Extend `ExamStudent` into the single source of truth for grading status, reuse existing `GradingTask` infrastructure for subjective/code scoring, and surface the new status and unread notifications through student APIs and student shell UI. Keep objective scoring synchronous in `submit_exam`, and asynchronously backfill subjective results plus confirmation state afterward.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Alembic, React, Refine, Vitest, Testing Library

---
