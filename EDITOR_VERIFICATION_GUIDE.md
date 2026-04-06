# Competency Editor Verification Guide

## Task 9: Full Verification + Demo

### Current Status
✅ **Phase 4 Complete**: All 7 core editor tasks implemented + comprehensive test suite

### What Was Built

#### Backend (Already Completed in Earlier Phases)
- ✅ Job Models CRUD endpoints
- ✅ Node reordering/bulk operations (`editor_service.py`)
- ✅ Model publishing workflow
- ✅ Database migrations for job competency models

#### Frontend (Just Completed)
- ✅ Editor page layout with dual-view support
- ✅ Tree view with collapsible hierarchy (dimension → skill → KP)
- ✅ Graph visualization using @xyflow/react
- ✅ Properties panel for context-aware editing
- ✅ Toolbar with save/publish buttons
- ✅ Status bar showing node count, version, save time
- ✅ Auto-save with 2-second debounce
- ✅ Responsive design (mobile/tablet/desktop)
- ✅ 10 component + E2E test files (90 test cases)

### How to Access the Editor

#### Option 1: Direct URL (if model exists)
```
http://localhost:4000/job-models/test-project/models/{modelId}/editor
```

#### Option 2: Via Job Models Listing Page
1. Start frontend: `cd frontend && npm run dev`
2. Visit: `http://localhost:5173` (or http://localhost:4000 if proxied)
3. Navigate to **职位模型管理** (Job Models) in sidebar
4. Click **Edit** on any model to open the editor

### Step-by-Step Setup & Verification

#### Step 1: Start Services
```bash
# Terminal 1: Backend
cd backend
python -m uvicorn app.main:app --reload
# Backend runs on http://localhost:8000

# Terminal 2: Frontend
cd frontend
npm install  # First time only, or after package.json changes
npm run dev
# Frontend runs on http://localhost:5173
```

#### Step 2: Create Test Model (if DB is empty)
```bash
# Option A: Via API (once backend is running)
curl -X POST http://localhost:8000/api/job-models/models \
  -H "Content-Type: application/json" \
  -d '{
    "job_role_id": "test-role-1",
    "status": "draft"
  }'

# Option B: Run setup script (if environment is configured)
bash scripts/setup_test_data.sh
```

#### Step 3: Access Job Models
1. Open browser to `http://localhost:5173`
2. Login if prompted
3. Navigate to **职位模型管理** (left sidebar under admin section)
4. You should see a list of job models
5. Click **Edit** button on any model → Opens the editor

#### Step 4: Verify Editor Features

**Toolbar (Top)**
- [ ] View toggle buttons: Tree View / Graph View
- [ ] Save button (enabled when isDirty)
- [ ] Publish button (opens version note dialog)

**Tree View (Left Panel, 40% width on desktop)**
- [ ] Shows job role at root
- [ ] Expand dimensions → shows skills
- [ ] Expand skills → shows knowledge points
- [ ] Chevron toggle for expand/collapse
- [ ] Search input to filter nodes
- [ ] Double-click name to inline edit
- [ ] Level badges (L1-L5) with colors

**Graph View (Right Panel, 60% width on desktop)**
- [ ] Auto-layout with 4 rows: role → dimensions → skills → KPs
- [ ] Click nodes to select
- [ ] Selected node highlighted
- [ ] Zoom/pan controls
- [ ] Color-coded by level (L1 light gray → L5 dark red)

**Properties Panel (Right Sidebar)**
- [ ] Shows model overview when nothing selected
- [ ] Edit node name on selection
- [ ] Edit description (dimension/skill)
- [ ] Change skill level via dropdown
- [ ] Change KP difficulty via dropdown
- [ ] Delete button with confirmation
- [ ] Save changes → triggers auto-save

**Status Bar (Bottom)**
- [ ] Shows node count
- [ ] Shows version badge
- [ ] Shows "Last saved: X minutes ago"
- [ ] Gradient background styling

**Auto-Save Behavior**
- [ ] Edit node name → green "Save" button appears
- [ ] Stop typing → after 2 seconds, auto-save triggers
- [ ] Status bar updates with save time
- [ ] "isDirty" indicator visible during changes

**Responsive Design**
- [ ] Desktop (1024px+): Tree (left) + Graph/Props (right)
- [ ] Tablet (768px): Panels stack vertically, toggle view button
- [ ] Mobile (375px): Tree hidden, graph/props full width

### Test Execution

#### Unit Tests (Vitest)
```bash
cd frontend
npm test                    # Run all unit tests
npm run test:ui             # Open Vitest dashboard
npm test -- --coverage      # Generate coverage report
```

Expected output:
- 75 test cases across 9 component files
- 85-90% coverage on editor components
- All tests should pass

#### E2E Tests (Playwright)
```bash
cd frontend
npm run test:e2e            # Run Playwright tests in headless mode
npm run test:e2e:ui         # Run with visual UI (recommended for debugging)
```

Expected tests:
- 13 main editor workflows
- 2 responsive design scenarios
- Auto-starts dev server on :5173
- Uses Chromium, Firefox, and WebKit browsers

### Known Current State

#### ✅ Implemented & Ready
1. Editor page layout and routing
2. All UI components (toolbar, tree, graph, properties, status)
3. Tree and graph visualization
4. Node selection and properties editing
5. Auto-save with debounce
6. Responsive design
7. Test infrastructure (Vitest, Playwright, setup files)
8. 10 test files with 90 test cases
9. Job Models listing page

#### ⚠️ To Complete Task 9 (Full Verification)
1. **Run tests** to ensure all components work
   ```bash
   npm test && npm run test:e2e
   ```
2. **Start services** and manually test editor workflows
   ```bash
   # In separate terminals
   cd backend && python -m uvicorn app.main:app --reload
   cd frontend && npm run dev
   ```
3. **Create test data** (if database is empty)
   - Via backend API or setup script
4. **Validate end-to-end flows**:
   - Load model → Edit node name → Auto-save → Publish → New version
5. **Check responsive** behavior on different screen sizes
6. **Document findings** and create bug tickets if needed

### Architecture Overview

```
Frontend Flow:
┌─────────────────────────────────────────────────────┐
│                   EditorPage                        │
│  ├─ Toolbar (view toggle, save, publish)           │
│  ├─ TreeView (left, 40%)  ← useEditorState        │
│  │  ├─ TreeNode (recursive dimension/skill/kp)     │
│  │  └─ Search input                                 │
│  ├─ GraphView or PropertiesPanel (right, 60%)      │
│  │  ├─ GraphView (@xyflow/react, 4-row layout)     │
│  │  └─ PropertiesPanel (context-aware editing)     │
│  ├─ StatusBar (node count, version, save time)     │
│  └─ useAutoSave hook (2s debounce)                 │
└─────────────────────────────────────────────────────┘

Backend Endpoints Used:
GET    /api/job-models/models/{modelId}    - Fetch model
PUT    /api/job-models/models/{modelId}    - Update model
POST   /api/job-models/models/{modelId}/publish  - Publish
POST   /api/job-models/models/{modelId}/reorder-dimensions
POST   /api/job-models/models/{modelId}/move-skill
POST   /api/job-models/models/{modelId}/bulk-set-skill-level
```

### File Structure

```
frontend/src/
├── pages/job-models/
│   ├── list.tsx ← NEW: Job models listing page
│   └── editor/
│       ├── index.tsx (main editor layout + orchestration)
│       ├── context.ts (EditorContext for shared state)
│       ├── toolbar.tsx (view toggle, save, publish)
│       ├── tree-view.tsx (collapsible tree with search)
│       ├── graph-view.tsx (@xyflow/react visualization)
│       ├── properties-panel.tsx (node editor sidebar)
│       ├── status-bar.tsx (bottom status display)
│       └── *.test.tsx (7 test files)
├── components/job-models/
│   ├── tree-node.tsx (reusable tree node component)
│   ├── graph-node.tsx (custom @xyflow node)
│   └── *.test.tsx (2 test files)
├── hooks/
│   ├── useEditorState.ts (node map, expand/collapse, select)
│   ├── useAutoSave.ts (debounced save mechanism)
│   └── *.test.ts (2 test files)
└── test/
    ├── setup.ts (window.matchMedia, IntersectionObserver mocks)
    ├── test-utils.tsx (custom render helper)
    └── e2e/
        └── editor.spec.ts (15 Playwright test scenarios)

Config:
├── vitest.config.ts (unit test runner)
├── playwright.config.ts (E2E test runner)
└── package.json (updated with test scripts & dependencies)
```

### What's Next

1. **Test Execution** (5-10 min)
   - Run `npm test` to validate unit tests
   - Run `npm run test:e2e` for full workflow testing
   - Fix any failing tests

2. **Manual Verification** (10-15 min)
   - Start backend + frontend
   - Navigate to job models
   - Open editor
   - Test all workflows (edit, save, publish)
   - Verify on mobile/tablet

3. **Bug Fixes** (as needed)
   - Update component implementations if tests fail
   - Ensure API calls work correctly
   - Fix responsive issues if found

4. **Documentation** (5 min)
   - Document any issues found
   - Update this guide with findings
   - Create follow-up tickets

### Success Criteria

✅ Editor page loads without errors  
✅ All 75 unit tests pass  
✅ All 15 E2E scenarios pass  
✅ Can navigate: Job Models → Edit → Tree/Graph → Edit → Save → Publish  
✅ Auto-save works (changes saved after 2s)  
✅ Responsive design works on mobile/tablet/desktop  
✅ No console errors or warnings  

### Questions?

If you don't see the editor:
1. Check that backend is running on port 8000
2. Check that frontend is running on port 5173 or 4000 (proxied)
3. Try accessing `/job-models` to see the listing page first
4. Create a test model via API if database is empty
5. Check browser console for any errors

## Next: Phase 5 (Course Mapping + Gap Analysis)
After Task 9 verification is complete, Phase 5 will add:
- Link SkillKnowledgePoint → Course via UI
- Run gap analysis: which KPs missing from curriculum
- Suggest new courses to cover gaps
