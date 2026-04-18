# Knowledge Catalog Multi-Image Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support uploading multiple catalog photos, reordering them before recognition, and sending the ordered image list as one combined catalog recognition request.

**Architecture:** Keep the backend contract unchanged around ordered `images: string[]`, and move the new behavior into the catalog-photo dialog plus its file-extraction helper. The dialog owns image list state, drag-reorder state, deletion, and passes the final ordered data URLs to the existing recognition endpoint.

**Tech Stack:** React, TypeScript, existing shadcn UI primitives, native HTML drag and drop, pdfjs-dist.

---

### Task 1: Expand file extraction to multi-file input

**Files:**
- Modify: `frontend/src/pages/knowledge/import-knowledge-photo-utils.ts`

- [ ] Accept `FileList | File[]` instead of a single `File`.
- [ ] Convert image files into ordered image entries and expand PDF pages into ordered image entries.
- [ ] Return a flat ordered list that the dialog can render and reorder.

### Task 2: Upgrade the catalog photo dialog to manage an ordered image list

**Files:**
- Modify: `frontend/src/pages/knowledge/KnowledgeCatalogPhotoDialog.tsx`

- [ ] Replace single-file state with ordered image-entry state.
- [ ] Allow selecting multiple image files and appending additional files on later picks.
- [ ] Show uploaded image/page count and a thumbnail list.
- [ ] Add drag-and-drop reorder and per-item delete.
- [ ] Send the ordered `images` array to `onRecognize`.

### Task 3: Verify and polish

**Files:**
- Modify: `frontend/src/pages/knowledge/KnowledgeCatalogPhotoDialog.tsx`
- Modify: `frontend/src/pages/knowledge/import-knowledge-photo-utils.ts`

- [ ] Run ESLint on the touched files.
- [ ] Check that empty, loading, and reordered states still read clearly.
