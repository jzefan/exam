# Exam Results Analysis Feature - Design Specification

**Date:** 2026-04-16  
**Author:** AI Assistant  
**Status:** Draft

## Overview

Add a comprehensive exam results analysis feature that allows teachers to view detailed statistics and insights for completed exams. The feature provides individual student results with objective/subjective score breakdowns, AI vs teacher-confirmed scoring indicators, and overall exam statistics including average scores, distribution, and question-level analysis.

## Requirements

### Individual Student Results

For each student enrolled in an exam, display:
- Student name and username
- Submission timestamp
- Total score with breakdown:
  - Objective score (if objective questions exist)
  - Subjective score (if subjective questions exist)
- Scoring indicator:
  - `[AI 评分]` - Subjective questions scored by AI, awaiting teacher review
  - `[教师确认]` - Teacher has confirmed/reviewed the score
  - No indicator - Grading incomplete or objective-only exam

**Edge cases:**
- If no objective questions exist, omit objective score column
- If no subjective questions exist, omit subjective score column
- If student has both AI scoring and teacher confirmation, show only `[教师确认]` (teacher confirmation takes precedence)

### Overall Exam Statistics

Provide exam-wide analytics:
- **Score statistics:** Average, minimum, maximum, median, standard deviation
- **Score distribution:** Histogram showing student count in score ranges (0-10, 11-20, ..., 91-100)
- **Objective vs subjective breakdown:** Separate averages for objective and subjective questions
- **Question-level analysis:** For each question, show:
  - Average score
  - Score rate (average score / max score as percentage)
  - Number of correct answers
  - Total attempts
- **Knowledge point analysis (optional):** If questions have knowledge tags, show:
  - Average score rate per knowledge point
  - Number of questions per knowledge point
  - Total attempts per knowledge point
  - If no knowledge tags exist, omit this section entirely

### Data Handling

- **Incomplete data:** Support two view modes:
  - "Graded only" - Include only students with completed grading (`grading_status IN ('ai_scored', 'reviewed')`)
  - "All students" - Include all enrolled students, even if not submitted or graded
- **Missing data:** Display "暂无数据" for metrics when insufficient data exists (not errors)

### User Interactions

- **Sorting:** Student results table sortable by: name, username, submission time, total score, objective score, subjective score, grading status
- **Filtering:** Filter students by grading status (pending_ai, ai_scored, reviewed)
- **Search:** Search students by name or username
- **Export:** Generate PDF report with all analysis data and charts
- **Toggle view:** Switch between "Graded only" and "All students" modes

## Architecture

### Approach: Lightweight Backend Aggregation

**Rationale:** On-demand computation from existing data without schema changes. Suitable for typical class sizes (<200 students) with fast response times (<500ms). No caching infrastructure required, always returns fresh data.

**Alternative approaches considered:**
- Cached analytics with background jobs - Rejected due to added complexity and potential stale data
- Hybrid compute-and-cache - Rejected due to Redis dependency and cache invalidation complexity

## Data Model

### API Endpoint

**Route:** `GET /api/exams/{exam_id}/analysis`

**Query Parameters:**
- `include_pending: bool = false` - Whether to include students who haven't submitted or aren't graded

**Response Schema:**

```python
class ExamAnalysisResponse(BaseModel):
    exam_id: uuid.UUID
    exam_title: str
    total_students: int
    submitted_count: int
    graded_count: int

    student_results: list[StudentResultItem]
    statistics: ExamStatistics
    question_analysis: list[QuestionAnalysisItem]
    knowledge_point_analysis: list[KnowledgePointAnalysisItem] | None

class StudentResultItem(BaseModel):
    student_id: uuid.UUID
    student_name: str
    username: str
    submitted_at: datetime | None
    total_score: float | None
    objective_score: float | None  # Omit if no objective questions
    subjective_score: float | None  # Omit if no subjective questions
    grading_status: str  # "pending_ai" | "ai_scored" | "reviewed"
    scoring_indicator: str  # "[AI 评分]" | "[教师确认]" | ""

class ExamStatistics(BaseModel):
    average_score: float | None
    max_score: float | None
    min_score: float | None
    median_score: float | None
    std_deviation: float | None
    score_distribution: list[ScoreBucket]
    objective_avg: float | None
    subjective_avg: float | None

class ScoreBucket(BaseModel):
    range_label: str  # "0-10", "11-20", etc.
    count: int
    percentage: float

class QuestionAnalysisItem(BaseModel):
    question_id: uuid.UUID
    question_title: str
    question_type: str
    max_score: float
    average_score: float | None
    score_rate: float | None  # Percentage
    correct_count: int
    total_attempts: int

class KnowledgePointAnalysisItem(BaseModel):
    knowledge_tag: str
    question_count: int
    average_score_rate: float
    total_attempts: int
```

### Existing Models Used

- `Exam` - Exam metadata and configuration
- `ExamStudent` - Student enrollment and scores
  - `objective_score`, `subjective_score`, `score` - Score fields
  - `grading_status` - Workflow state: `pending_ai`, `ai_scored`, `reviewed`
  - `ai_scored_at`, `reviewed_at` - Timestamps for scoring stages
- `StudentExamAnswer` - Per-question answers and scores
  - `score_awarded` - Points earned
  - `is_correct` - Whether answer meets threshold
- `ExamQuestion` - Questions in exam with score overrides
- `Question` - Question content and metadata including `knowledge_tags`

## Backend Implementation

### Service Layer

**File:** `backend/src/app/exams/service.py`

**Function:** `get_exam_analysis(db: Session, exam_id: UUID, include_pending: bool) -> ExamAnalysisResponse`

**Implementation steps:**

1. **Fetch base data:**
   - Query `Exam` with `exam_questions` and `exam_students` relationships using `selectinload()`
   - Filter students based on `include_pending`:
     - If `False`: Only students where `submitted_at IS NOT NULL` and `grading_status IN ('ai_scored', 'reviewed')`
     - If `True`: All enrolled students

2. **Build student results:**
   - For each student, determine `scoring_indicator`:
     - If `grading_status == 'reviewed'`: `"[教师确认]"`
     - Elif `grading_status == 'ai_scored'`: `"[AI 评分]"`
     - Else: `""`
   - Check if exam has objective/subjective questions
   - Omit `objective_score` field if no objective questions
   - Omit `subjective_score` field if no subjective questions

3. **Calculate statistics:**
   - Filter to graded students only (`grading_status IN ('ai_scored', 'reviewed')`)
   - Use SQLAlchemy aggregations: `func.avg()`, `func.min()`, `func.max()`, `func.count()`
   - Calculate median and standard deviation using Python statistics module
   - Build score distribution histogram:
     - Buckets: 0-10, 11-20, 21-30, ..., 91-100
     - Count students in each bucket using SQL CASE statements
     - Calculate percentage for each bucket
   - Calculate objective/subjective averages separately

4. **Question-level analysis:**
   - Query `StudentExamAnswer` grouped by `question_id`
   - Join with `Question` to get question metadata
   - For each question:
     - `average_score = AVG(score_awarded)`
     - `score_rate = (average_score / max_score) * 100`
     - `correct_count = COUNT(*) WHERE is_correct = true`
     - `total_attempts = COUNT(*)`

5. **Knowledge point analysis:**
   - Extract all unique `knowledge_tags` from exam questions
   - If no tags exist, set `knowledge_point_analysis = None`
   - Otherwise, for each tag:
     - Find all questions with this tag
     - Calculate average score rate across those questions
     - Count total attempts

**Query optimization:**
- Use `selectinload()` for relationships to avoid N+1 queries
- Single aggregation query for statistics
- Use `group_by()` for question and knowledge point analysis
- Expected query count: 4-5 queries total

### Router Endpoint

**File:** `backend/src/app/exams/router.py`

```python
@router.get("/{exam_id}/analysis", response_model=ExamAnalysisResponse)
async def get_exam_analysis(
    exam_id: UUID,
    include_pending: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get comprehensive analysis for an exam including student results and statistics."""
    exam = get_exam_or_403(db, exam_id, current_user)
    return service.get_exam_analysis(db, exam_id, include_pending)
```

**Authorization:**
- Reuse existing `get_exam_or_403()` dependency
- Only exam creator or teachers with exam access can view analysis

**Error handling:**
- 404 if exam doesn't exist
- 403 if user lacks permission
- Return empty/null values for metrics when data insufficient (not errors)

## Frontend Implementation

### Page Structure

**Route:** `/exams/:id/analysis`

**File:** `frontend/src/pages/exams/analysis.tsx`

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ Header: [Exam Title] - 结果分析                      │
│ Subtitle: 总人数 X | 已提交 Y | 已评分 Z             │
│                                                     │
│ [Toggle: ○ 仅已评分  ○ 全部学生]  [导出PDF报告 📄]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Tabs: [学生成绩] [整体分析]                          │
│                                                     │
│ Tab 1: 学生成绩                                      │
│   - Search bar (by name/username)                  │
│   - Student results table                          │
│   - Sortable columns                               │
│   - Status filter dropdown                         │
│   - Pagination                                     │
│                                                     │
│ Tab 2: 整体分析                                      │
│   - Statistics card (avg, min, max, median, sd)   │
│   - Score distribution chart (histogram)           │
│   - Question analysis table                        │
│   - Knowledge point analysis table (if available)  │
└─────────────────────────────────────────────────────┘
```

### Components

**StudentResultsTable** (`frontend/src/pages/exams/components/StudentResultsTable.tsx`)
- Columns: 学生姓名, 学号, 提交时间, 总分, 客观题分数, 主观题分数, 评分状态
- Conditionally render objective/subjective columns based on data
- Sortable by clicking column headers
- Filter by grading status using dropdown
- Search by name/username using input field
- Scoring indicator badges:
  - `[教师确认]`: Green badge (`<Badge variant="default">`)
  - `[AI 评分]`: Blue badge (`<Badge variant="secondary">`)
- Date format: `yyyy-MM-dd HH:mm` using `date-fns`
- Empty state: "暂无数据"

**ExamStatisticsCard** (`frontend/src/pages/exams/components/ExamStatisticsCard.tsx`)
- Grid layout displaying:
  - 平均分: `75.5` (1 decimal)
  - 最高分: `98.0`
  - 最低分: `45.0`
  - 中位数: `76.0`
  - 标准差: `12.3`
  - 客观题平均: `42.5 / 50` (if exists)
  - 主观题平均: `33.0 / 50` (if exists)
- Show "暂无数据" for null values

**ScoreDistributionChart** (`frontend/src/pages/exams/components/ScoreDistributionChart.tsx`)
- Use `recharts` `BarChart` component
- X-axis: Score ranges (0-10, 11-20, ..., 91-100)
- Y-axis: Student count
- Tooltip shows count and percentage
- Use theme primary color for bars
- Responsive container with min-height: 300px
- Statistics table below chart showing bucket details

**QuestionAnalysisTable** (`frontend/src/pages/exams/components/QuestionAnalysisTable.tsx`)
- Columns: 题目标题, 题目类型, 满分, 平均分, 得分率, 正确人数, 作答人数
- Score rate displayed as percentage with 1 decimal: `75.5%`
- Empty state: "暂无数据"

**KnowledgePointAnalysisTable** (`frontend/src/pages/exams/components/KnowledgePointAnalysisTable.tsx`)
- Columns: 知识点, 题目数量, 平均得分率, 作答人数
- Only rendered if `knowledge_point_analysis` is not null
- Empty state: Component not rendered (section omitted)

**ExamAnalysisPDFExport** (`frontend/src/pages/exams/components/ExamAnalysisPDFExport.tsx`)
- Export button triggers PDF generation
- Uses `jspdf` + `html2canvas` to capture page content
- Process:
  1. Show loading spinner
  2. Temporarily switch to print-friendly layout
  3. Capture both tabs (students + statistics)
  4. Generate PDF with exam title as filename
  5. Restore normal layout
  6. Download PDF
- Include metadata: exam title, export date, student count

### State Management

**Main page:**
```typescript
const [includePending, setIncludePending] = useState(false);
const [activeTab, setActiveTab] = useState<'students' | 'statistics'>('students');
const { data: analysis, isLoading, error } = useQuery({
  queryKey: ['exam-analysis', examId, includePending],
  queryFn: () => api.getExamAnalysis(examId, includePending),
});
```

**StudentResultsTable:**
```typescript
const [searchTerm, setSearchTerm] = useState('');
const [sortColumn, setSortColumn] = useState<SortColumn>('total_score');
const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
const [statusFilter, setStatusFilter] = useState<string[]>([]);
```

### Navigation

**Add route in `frontend/src/App.tsx`:**
```typescript
<Route path="/exams/:id/analysis" element={<ExamAnalysis />} />
```

**Add navigation links:**
- In `frontend/src/pages/exams/list.tsx`: Add "结果分析" action button per exam row
- In `frontend/src/pages/exams/edit.tsx`: Add "查看结果分析" button in header

### Error Handling

- Show error toast if API call fails
- Display "加载失败，请重试" with retry button
- Handle 403 with redirect to exam list + error message
- Handle 404 with "考试不存在" message
- Network errors: Show retry button

## Testing Strategy

### Backend Tests

**File:** `backend/tests/test_exams_analysis.py`

Test cases:
1. Test analysis with all students graded
2. Test analysis with partial grading (some pending)
3. Test `include_pending=false` filters correctly
4. Test `include_pending=true` includes all students
5. Test exam with only objective questions (subjective fields omitted)
6. Test exam with only subjective questions (objective fields omitted)
7. Test exam with mixed objective/subjective questions
8. Test scoring indicator logic (AI vs teacher confirmed)
9. Test statistics calculation (avg, min, max, median, std)
10. Test score distribution histogram buckets
11. Test question-level analysis aggregation
12. Test knowledge point analysis with tags
13. Test knowledge point analysis returns null when no tags
14. Test authorization (403 for non-owner)
15. Test 404 for non-existent exam
16. Test empty exam (no students enrolled)
17. Test exam with no submissions

### Frontend Tests

**Files:** Component test files (`.test.tsx`)

Test cases:
1. Test student results table renders correctly
2. Test sorting by different columns
3. Test filtering by grading status
4. Test search by name/username
5. Test scoring indicator badges display correctly
6. Test objective/subjective columns conditionally rendered
7. Test statistics card displays all metrics
8. Test statistics card shows "暂无数据" for null values
9. Test score distribution chart renders
10. Test question analysis table renders
11. Test knowledge point analysis table conditionally rendered
12. Test toggle between "Graded only" and "All students"
13. Test PDF export button triggers export
14. Test empty states display correctly
15. Test error handling and retry

## Security Considerations

- **Authorization:** Reuse existing `get_exam_or_403()` to ensure only authorized teachers can view analysis
- **Data exposure:** Student results only visible to exam creator and authorized teachers
- **Input validation:** `include_pending` parameter validated as boolean
- **SQL injection:** Use SQLAlchemy ORM with parameterized queries
- **Rate limiting:** Endpoint subject to existing API rate limits

## Performance Considerations

- **Query optimization:** Use `selectinload()` to avoid N+1 queries
- **Expected response time:** <500ms for typical class sizes (<200 students)
- **Large exams:** For exams with >500 students, consider adding pagination or caching in future iterations
- **Database indexes:** Existing indexes on `exam_id`, `student_id`, `question_id` sufficient
- **Frontend rendering:** Use React.memo for table rows to optimize re-renders
- **PDF export:** May take 2-5 seconds for large datasets, show loading indicator

## Future Enhancements

- Export to Excel/CSV format
- Comparison across multiple exams
- Trend analysis over time
- Student performance history
- Customizable score buckets for histogram
- Downloadable individual student reports
- Email reports to teachers
- Real-time updates when grading completes (WebSocket)

## Dependencies

### Backend
- Existing: SQLAlchemy, FastAPI, Pydantic
- New: None (uses Python standard library `statistics` module)

### Frontend
- Existing: React, TypeScript, React Query, shadcn/ui, date-fns
- New:
  - `recharts` - Chart library for histogram
  - `jspdf` - PDF generation
  - `html2canvas` - HTML to canvas conversion for PDF

## Rollout Plan

1. **Phase 1: Backend implementation**
   - Add service function with statistics calculation
   - Add router endpoint
   - Write backend tests
   - Verify performance with test data

2. **Phase 2: Frontend implementation**
   - Create page and components
   - Implement student results table with sorting/filtering
   - Implement statistics cards and charts
   - Add navigation links

3. **Phase 3: PDF export**
   - Implement PDF generation logic
   - Test export with various data sizes
   - Optimize layout for print

4. **Phase 4: Testing and refinement**
   - Write frontend tests
   - User acceptance testing with teachers
   - Performance testing with large datasets
   - Bug fixes and polish

5. **Phase 5: Documentation and deployment**
   - Update user documentation
   - Deploy to production
   - Monitor performance and errors
   - Gather feedback for future enhancements
