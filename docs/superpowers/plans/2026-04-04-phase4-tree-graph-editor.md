# Phase 4: Competency Tree Editor + Graph View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement dual-view competency editor (tree + graph) with drag-drop, inline editing, and auto-save for refining auto-generated job models before publishing.

**Architecture:** 
- **Backend:** Endpoint updates for node CRUD (dimension/skill/knowledge_point edit/reorder)
- **Frontend:** React 19 + TypeScript + Refine, dual-view layout with @dnd-kit (tree drag-drop) and @xyflow/react (graph visualization)
- Two complementary views: tree view for daily editing (left), graph view for global visualization (right), properties panel (right sidebar)

**Tech Stack:** React 19, TypeScript, Refine framework, Radix UI, @dnd-kit, @xyflow/react, zustand (state), TanStack Query (data syncing)

---

## File Structure

### Backend (minimal additions)

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `backend/src/app/job_models/editor_service.py` | Node reordering, bulk operations |
| Modify | `backend/src/app/job_models/router.py` | Add reorder endpoint |
| Create | `backend/tests/job_models/test_editor_service.py` | Service tests |

### Frontend (new editor pages + components)

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/pages/job-models/editor/index.tsx` | Main editor page layout |
| Create | `frontend/src/pages/job-models/editor/tree-view.tsx` | Tree component (collapsible, drag-drop) |
| Create | `frontend/src/pages/job-models/editor/graph-view.tsx` | Graph component (@xyflow/react) |
| Create | `frontend/src/pages/job-models/editor/properties-panel.tsx` | Right sidebar node editor |
| Create | `frontend/src/pages/job-models/editor/toolbar.tsx` | View toggle, save, publish buttons |
| Create | `frontend/src/pages/job-models/editor/status-bar.tsx` | Bottom status (node count, version, last save) |
| Create | `frontend/src/pages/job-models/editor/context.ts` | React Context for shared state |
| Create | `frontend/src/components/job-models/tree-node.tsx` | Reusable tree node component |
| Create | `frontend/src/components/job-models/graph-node.tsx` | Reusable graph node component |
| Create | `frontend/src/hooks/useEditorState.ts` | Custom hook for editor state mgmt |
| Create | `frontend/src/hooks/useAutoSave.ts` | Custom hook for debounced save |
| Modify | `frontend/src/pages/job-models/[id]/index.tsx` | Link to editor page |

---

## Task Breakdown

### Task 1: Backend - Node Reordering + Bulk Operations

**Files:**
- Create: `backend/src/app/job_models/editor_service.py`
- Modify: `backend/src/app/job_models/router.py`
- Create: `backend/tests/job_models/test_editor_service.py`

- [ ] **Implement reorder service**

```python
async def reorder_dimensions(
    db: AsyncSession, model_id: uuid.UUID, order_map: dict[uuid.UUID, int]
) -> list[CompetencyDimension]:
    """Reorder dimensions within a model. order_map = {dim_id: new_sort_order}"""
    # Query all dimensions, update sort_order for each, commit

async def reorder_skills(
    db: AsyncSession, dimension_id: uuid.UUID, order_map: dict[uuid.UUID, int]
) -> list[Skill]:
    """Reorder skills within a dimension."""

async def reorder_knowledge_points(
    db: AsyncSession, skill_id: uuid.UUID, order_map: dict[uuid.UUID, int]
) -> list[SkillKnowledgePoint]:
    """Reorder knowledge points within a skill."""

async def move_skill_to_dimension(
    db: AsyncSession, skill_id: uuid.UUID, target_dimension_id: uuid.UUID
) -> Skill:
    """Move a skill from one dimension to another."""

async def bulk_set_skill_level(
    db: AsyncSession, skill_ids: list[uuid.UUID], level: str
) -> int:
    """Set level for multiple skills. Returns count updated."""

async def bulk_set_kp_difficulty(
    db: AsyncSession, kp_ids: list[uuid.UUID], difficulty: str
) -> int:
    """Set difficulty for multiple knowledge points. Returns count updated."""
```

- [ ] **Add router endpoints**

```python
@router.post("/models/{model_id}/reorder-dimensions")
async def reorder_dimensions_ep(...) -> list[DimensionResponse]:
    """Request body: {"order_map": {dim_id: sort_order}}"""

@router.post("/models/{model_id}/move-skill")
async def move_skill_ep(...) -> SkillResponse:
    """Request body: {"skill_id": ..., "target_dimension_id": ...}"""

@router.post("/models/{model_id}/bulk-set-skill-level")
async def bulk_set_skill_level_ep(...) -> dict[str, int]:
    """Request body: {"skill_ids": [...], "level": "L3"}"""
```

- [ ] **Unit tests** (4 tests)
  - test_reorder_dimensions
  - test_move_skill_to_dimension
  - test_bulk_set_skill_level
  - test_bulk_set_kp_difficulty

---

### Task 2: Frontend - Editor Page Layout + Toolbar

**Files:**
- Create: `frontend/src/pages/job-models/editor/index.tsx`
- Create: `frontend/src/pages/job-models/editor/toolbar.tsx`
- Create: `frontend/src/pages/job-models/editor/status-bar.tsx`
- Create: `frontend/src/pages/job-models/editor/context.ts`

- [ ] **Create context for shared state**

```typescript
// context.ts
interface EditorContextType {
  modelId: uuid.UUID
  viewMode: "tree" | "graph"
  setViewMode: (mode: "tree" | "graph") => void
  selectedNodeId: uuid.UUID | null
  setSelectedNodeId: (id: uuid.UUID | null) => void
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
}

export const EditorContext = createContext<EditorContextType | null>(null)
```

- [ ] **Create toolbar component**

```typescript
// toolbar.tsx
// Buttons: [Tree View] [Graph View] [Save] [Publish]
// Save: disabled if !isDirty, shows spinner if isSaving
// Publish: disabled if isDirty, opens modal for version_note
```

- [ ] **Create status bar component**

```typescript
// status-bar.tsx
// Shows: "{nodeCount} nodes | v{version} | Last saved: {time}"
```

- [ ] **Create main editor page**

```typescript
// index.tsx - uses Refine useShow hook to fetch model
// Layout: toolbar (top) | tree-view (left, 40%) + graph-view (right, 60%) | status-bar (bottom)
// Responsive: mobile stacks vertically
```

---

### Task 3: Frontend - Tree View Component

**Files:**
- Create: `frontend/src/pages/job-models/editor/tree-view.tsx`
- Create: `frontend/src/components/job-models/tree-node.tsx`
- Create: `frontend/src/hooks/useEditorState.ts`

- [ ] **Create tree node component**

```typescript
// tree-node.tsx - reusable TreeNode component
// Props: nodeId, nodeType (dimension|skill|kp), data, depth
// Features:
//   - Drag handle (left icon)
//   - Expandable/collapsible
//   - Inline edit on double-click (name)
//   - Right-click context menu: Add/Delete/Merge/Split
//   - Click level tag to open dropdown (L1-L5)
//   - Color-coded by level (L1=gray, L5=dark red)
```

- [ ] **Create tree view component**

```typescript
// tree-view.tsx
// Features:
//   - Full tree hierarchy (role → dimensions → skills → kps)
//   - @dnd-kit drag-drop for reordering and cross-dimension moving
//   - Multi-select (Ctrl+click)
//   - Search/filter textbox
//   - Batch level setting when multi-select
//   - Auto-collapse when editing different section
```

- [ ] **Create editor state hook**

```typescript
// useEditorState.ts
// useState: selectedNodeId, selectedNodeIds[], viewMode, isDirty, isSaving, lastSavedAt
// useMemo: nodeCounts, nodeMap
// Methods: handleNodeSelect, handleNodesDragEnd, handleBulkUpdate
```

---

### Task 4: Frontend - Graph View Component

**Files:**
- Create: `frontend/src/pages/job-models/editor/graph-view.tsx`
- Create: `frontend/src/components/job-models/graph-node.tsx`

- [ ] **Create graph node component**

```typescript
// graph-node.tsx - custom @xyflow/react node
// Props: data (name, level, type, kpCount)
// Display: box with name, icon (📁 dimension, 🔧 skill, 📝 kp)
// Color: determined by level (L1 light, L5 dark)
// Size: varies by node importance
```

- [ ] **Create graph view component**

```typescript
// graph-view.tsx - uses @xyflow/react
// Nodes: job role (top) → dimensions (row 2) → skills (row 3) → kps (row 4)
// Edges: dependency arrows
// Features:
//   - Auto-layout (dagre or similar)
//   - Zoom/pan
//   - Click node to select (right panel updates)
//   - Show KB mapping edges (dotted lines to courses in Phase 5)
//   - Responsive: shrink on small screens
```

---

### Task 5: Frontend - Properties Panel

**Files:**
- Create: `frontend/src/pages/job-models/editor/properties-panel.tsx`

- [ ] **Create properties panel**

```typescript
// properties-panel.tsx - right sidebar
// Conditional rendering based on selectedNodeId type:
//
// **Dimension selected:**
//   - Name input (editable)
//   - Description textarea
//   - Read-only: Skill count, Created/Updated dates
//   - Delete button (with confirm)
//
// **Skill selected:**
//   - Name input (editable)
//   - Description textarea
//   - Level dropdown (L1-L5)
//   - Matched KB (if from Phase 3): show standard_name + confidence
//   - Knowledge point count
//   - Delete / Duplicate buttons
//
// **Knowledge Point selected:**
//   - Name input (editable)
//   - Difficulty dropdown (入门/初级/中级/高级/困难)
//   - Teaching suggestion textarea
//   - Source badge (AI Generated / Manual)
//   - Mapped courses (if any from Phase 5): show course names
//   - Delete button
//
// **No selection:**
//   - Shows model overview: job_role, version, status, dimension count
//   - Info: "Select a node to edit"
```

---

### Task 6: Frontend - Auto-Save + Hooks

**Files:**
- Create: `frontend/src/hooks/useAutoSave.ts`
- Modify: `frontend/src/pages/job-models/editor/index.tsx`

- [ ] **Create auto-save hook**

```typescript
// useAutoSave.ts
// Debounces save for 2 seconds
// Tracks isDirty, isSaving, lastSavedAt
// Calls Refine mutation on debounced save
// Shows toast on success/error
// Auto-clears isDirty after successful save
```

- [ ] **Integrate into editor**

```typescript
// index.tsx
// - Use useAutoSave hook
// - Track all edit operations (name, description, level, difficulty)
// - Debounce 2s before calling batch update endpoint
// - Save button: manual save (immediate, not debounced)
// - Publish button: save first, then call /publish endpoint
```

---

### Task 7: Frontend - Integration + Routing

**Files:**
- Modify: `frontend/src/pages/job-models/[id]/index.tsx`
- Modify: `frontend/src/app-paths.ts` (or router config)

- [ ] **Add "Edit" button to model detail page**

Link to `/job-models/:projectId/models/:modelId/editor`

- [ ] **Update routing**

Create route: `/job-models/:projectId/models/:modelId/editor` → EditorPage

- [ ] **Add breadcrumb**

Project > Model > Edit

---

### Task 8: Frontend - Styling + Polish

**Files:**
- Modify: various component files

- [ ] **Radix UI + TailwindCSS**

- Tree nodes: proper spacing, icons, hover states
- Graph: node styling, edge colors, legend
- Properties panel: form fields, buttons, spacing
- Toolbar: button group, loading states
- Status bar: typography, spacing

- [ ] **Responsive design**

- Desktop: tree (40%) + graph (60%)
- Tablet: stack vertically, toggle view
- Mobile: tree only (graph hidden by default)

- [ ] **Accessibility**

- ARIA labels on interactive elements
- Keyboard navigation (arrow keys in tree)
- Focus management

---

### Task 9: Testing + Verification

**Files:**
- Test files for all new components

- [ ] **Component tests** (Vitest + React Testing Library)

- TreeView: render hierarchy, drag-drop simulation
- GraphView: render nodes, click selection
- PropertiesPanel: edit inputs, save calls

- [ ] **E2E tests** (Playwright)

- Load editor page
- Edit node (double-click, change level)
- Verify auto-save
- Change to graph view
- Click publish

- [ ] **Full page walkthrough**

- Open project detail
- Click Edit
- Tree view: expand all, drag skill to different dimension
- Select dimension, edit name in properties panel → auto-save
- Switch to graph view
- Verify graph layout correct
- Click Publish, enter version note
- Verify model versioned and is_current set

---

## Implementation Strategy

### Backend (2-3 hours)
1. Implement reorder/bulk operations service
2. Add endpoints to router
3. Write service tests
4. Commit

### Frontend (6-8 hours)
1. Create context, hooks, toolbar, status-bar
2. Implement tree view with drag-drop
3. Implement graph view with @xyflow/react
4. Create properties panel with conditional rendering
5. Add auto-save logic
6. Update routing
7. Polish styling
8. Component + E2E tests

---

## Key Design Decisions

1. **Dual-View:** Tree for fine details (left, focus), Graph for overview (right, context)
2. **Auto-Save:** Debounce 2s to avoid excessive API calls. Manual Save button for immediate sync.
3. **Versioning:** Publish creates new version, not auto-saved draft. Draft status persists across sessions.
4. **Drag-Drop:** @dnd-kit for robust tree reordering. Can move skills across dimensions.
5. **Properties Panel:** Context-aware editing (different forms per node type).
6. **Color Coding:** L1-L5 skill levels use visual hierarchy (light → dark).

---

## Next Phases

**Phase 5** (Course Mapping + Gap Analysis):
- Link SkillKnowledgePoint → Course via UI
- Run gap analysis: which KPs are missing from curriculum
- Suggest new courses to cover gaps

**Phase 6** (Exports + JD Generation):
- Export model as PDF, Excel, JSON
- Reverse-generate recruitment JD from model

**Phase 7** (Polish + Launch):
- Performance tuning
- Mobile app
- Localization (zh-CN, en-US)

---

## Execution Options

**1. Subagent-Driven (recommended)**
- Dispatch 1 implementer subagent per task (1-9)
- Code review after each task
- Fast iteration, clean commits

**2. Inline Execution**
- Sequential in this session
- Batch related work (all backend, then all frontend)
- Good for quick iteration

Choose approach below, or I'll default to subagent-driven. 🚀
