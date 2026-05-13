# Mobile PWA Support Design

## Context

The existing exam system is a React/Vite single-page application with separate teacher/admin and student route shells. The product goal is to support mobile users with a PWA-like experience, not a native app rewrite.

The first mobile phase prioritizes logged-in students and candidates. Student functionality should be fully covered on mobile. Teacher/admin mobile support should provide a usable app shell and a small set of high-value entry points, while complex desktop-first workflows can remain guided to desktop.

External public-link candidates are included in the mobile browser answer-taking experience, but they are not part of the installable PWA navigation or logged-in student app shell.

## Goals

- Provide a student-first PWA experience for mobile browsers and installed standalone mode.
- Cover all logged-in student functions on mobile: dashboard, exam list, exam taking, results, wrong answers, notifications, and account actions.
- Make the exam-taking flow resilient to short offline or weak-network periods after an exam has started.
- Keep final submission online-only, with clear recovery states when the network is unavailable.
- Preserve the existing React/Vite application, route model, API contracts, and role guards.
- Provide a teacher/admin mobile shell with key status views and entry points for common tasks.
- Keep the first phase focused by excluding Web Push and native app development.

## Non-Goals

- No native iOS, Android, Flutter, or React Native application in this phase.
- No Web Push or operating-system notification support in the first phase.
- No full offline system mode for browsing every page.
- No offline final submission to a background queue.
- No complete mobile redesign of every teacher/admin management page in the first phase.
- No service-worker caching of exam API responses.

## Recommended Approach

Use a progressive PWA retrofit inside the existing SPA.

This approach keeps the current routing, authentication, role-based layouts, API clients, and student exam components. Mobile support is added as a layered enhancement:

1. A PWA foundation for installability, app shell behavior, static asset caching, and offline fallback.
2. Responsive student and teacher layout shells.
3. Full mobile adaptation of student pages.
4. A business-owned local exam draft and sync layer for quasi-offline exam taking.

This avoids a duplicate mobile app codebase while still allowing mobile-specific navigation and interaction patterns.

## Architecture

### PWA Foundation

Add a frontend PWA foundation:

- `manifest.webmanifest` with app name, short name, icons, theme color, start URL, and `display: standalone`.
- iOS support through `apple-touch-icon`, status-bar styling, and safe-area handling.
- Service worker registration through the Vite app entry.
- App-install state detection and install prompt support where browsers expose it.
- A reusable online/offline connectivity indicator.

Service worker strategy:

- Static build assets: cache-first with revisioned URLs.
- HTML/app shell: network-first with a fallback offline page.
- Ordinary API requests: network-first and not stored long-term.
- Exam API requests: explicitly excluded from service-worker response caching.

Exam state caching must live in the application data layer, not in the service worker. This prevents stale exam papers, stale start state, or stale submission state.

### Mobile Layout Layer

Keep existing routes and switch layout behavior by viewport.

Student layout:

- Desktop keeps the current horizontal navigation.
- Mobile uses an app shell with a compact top bar, notification/account access, safe-area-aware content padding, and a bottom tab bar.
- The exam-taking route remains full-screen and does not show the bottom tab bar.

Teacher/admin layout:

- Desktop keeps the current top navigation.
- Mobile gets a compact shell with brand, notification/user access, and bottom tab or drawer navigation.
- Complex admin pages can show mobile-friendly entry views and desktop guidance where full mobile support is out of scope.

External candidate routes:

- Public invitation and answer-taking routes do not enter the logged-in student app shell.
- They reuse the mobile answer-taking experience where possible.
- They do not show install prompts, bottom tabs, or account navigation.

## Student Mobile Experience

### Navigation

Logged-in students get four mobile tabs:

- Home: `/student`
- Exams: `/my-exams`
- Wrong Answers: `/wrong-answers`
- Me: account actions, theme controls, install status or install entry, and logout

The result page and wrong-answer detail page are reached from their parent tabs and use ordinary back navigation.

### Student Dashboard

The mobile dashboard should prioritize the next action:

- Current or upcoming exams at the top.
- Recent score or pending grading status.
- Wrong-answer review entry.
- In-app notifications summary.
- Compact student status metrics.

Desktop table-like or wide horizontal areas should become stacked cards on mobile.

### My Exams

The mobile exam list keeps the existing logical split:

- Pending and ongoing exams.
- Completed exams.

Mobile behavior:

- Ongoing exams are pinned first.
- Exam cards show title, teacher, time window, duration, status, total questions, grading state, and primary action.
- Retake actions remain visible only when allowed.
- Buttons use at least 44px tap targets.

### Results

The result page becomes a single-column reading flow:

- Summary score and grading status.
- Per-question score and status.
- Student answer, correct answer, explanation, and comments.
- Pending-AI and reviewed states with clear labels.

### Wrong Answers

The wrong-answer list becomes single-column on narrow screens:

- Preserve "to review" and "mastered" tabs.
- Cards show question type, title preview, exam title, last wrong date, wrong count, tags, and mastered status.
- Detail pages use a readable single-column layout for question, answer, explanation, and mastery action.

### Notifications

First phase uses in-app notifications only:

- Existing unread notification data remains the source.
- Mobile display uses a bottom sheet or compact dialog.
- Red dots or counters can be shown in the top bar or Me tab.
- No Web Push subscription, permission request, or OS notification integration.

## Exam-Taking Experience

The exam page is the highest-risk mobile workflow and should be treated as an immersive surface.

### Layout

The mobile exam page should not show the student bottom tab bar.

Recommended structure:

- Fixed top bar with protected back action, exam title, countdown, and save state.
- Main question area in single-question mode by default.
- Bottom action bar with previous, question map, next, and submit.
- Question map as a bottom drawer with answered, unanswered, current, and error states.
- Submit confirmation that lists unanswered count, pending sync state, and network status.

The existing show-all mode may remain available, but it should not be the default on mobile.

### Question Types

All existing student question types remain supported:

- Choice
- True/false
- Fill-in
- Short answer
- Essay
- Code

Code questions should be usable on mobile, but complex coding can be messaged as better suited to desktop. The mobile implementation should still allow reading, editing, saving, and submitting code answers.

### Time and Anti-Switch Rules

Existing countdown, visibility detection, switch count warnings, and auto-submit behavior remain in force.

Mobile-specific requirements:

- Warnings must be large enough to read and should not be hidden behind fixed bottom controls.
- Time-up and switch-limit countdowns must clearly explain whether the app is submitting or waiting for network recovery.
- Back navigation must be protected during an active exam.

## Quasi-Offline Exam Design

Quasi-offline support starts after an exam has successfully loaded. It does not allow students to start a new exam while offline.

### Local Store

Create an exam local state layer backed by IndexedDB.

Suggested units:

- `examLocalStore`: stores exam snapshots, answer drafts, sync metadata, and cleanup state.
- `useConnectivity`: central online/offline and reconnect detection.
- `useExamDraftSync`: coordinates local writes, backend sync, retry, and submit preparation.

Local records should be isolated by:

- Exam ID.
- Logged-in student identity or external candidate identity.
- Attempt or retake marker where applicable.

### Start Flow

When `/api/student/exams/:id/start` succeeds:

1. Store the exam snapshot locally.
2. Store server-provided existing answers and switch count metadata.
3. Initialize draft state and sync metadata.
4. Render from the fresh server result.

On refresh or app resume:

- If the network succeeds, use server state and reconcile local newer drafts.
- If the network fails but a valid local snapshot exists, allow continuing from the local snapshot.
- If no local snapshot exists, show a retryable loading error.

### Answer Flow

Every answer update writes locally first.

State labels:

- "Saved on this device" after local persistence succeeds.
- "Syncing" while backend save is in flight.
- "Synced" after backend save succeeds.
- "Pending sync" when offline or backend save fails.

Online sync should continue using the existing per-question save pattern where practical. Failed saves enter a retry queue keyed by question ID.

Conflict rule:

- If the local draft has a later edit timestamp than the known server answer, local wins during recovery.
- If the exam has already been submitted, drafts stop syncing and the local state becomes read-only or is cleaned up.

### Submit Flow

Final submission requires network.

Before submit:

1. Flush pending local answers.
2. Include current draft answers in the submit payload when supported by the existing API flow.
3. If still offline, block submit and show that answers are preserved locally.

If time expires while online:

- Auto-submit after the existing countdown.

If time expires while offline:

- Lock further editing.
- Show a "waiting for network to submit" state.
- Auto-attempt submission when connectivity returns.
- Require the user to see a clear submitted or failed result state.

External candidates can use the same local draft and recovery mechanism in the answer-taking page, but they do not get PWA navigation or install affordances.

### Cleanup

Remove exam local state when:

- The exam submits successfully.
- The user logs out.
- A public candidate session is invalidated.
- The cached exam is expired and no longer recoverable.

Retain local state when:

- The network fails.
- The browser refreshes.
- The app is backgrounded and later restored.

## Teacher/Admin Mobile Scope

Teacher/admin first phase covers:

- Mobile shell for authenticated teacher/admin users.
- Dashboard/workbench summary with key status cards.
- Notification and user menu access.
- Navigation to grading, exams, questions, students, and settings.
- Exam list browsing.
- Grading center entry with pending workload visibility.
- Question import entry.

Pages that may remain desktop-guided in phase one:

- Complex exam creation/editing.
- Bulk question review and large import correction.
- Knowledge graph editing.
- Job model graph editor.
- Large student-management tables.
- Complex system settings.

For these, mobile should avoid broken layouts and provide a clear message when desktop is recommended.

## Error Handling

Mobile error states must be explicit and actionable.

Required states:

- Offline while browsing non-exam pages: show offline fallback or retry state.
- Offline during active exam: show local-save confirmation and pending-sync count.
- Submit attempted offline: block final submit and explain that answers are preserved on this device.
- Sync failure: show pending-sync status and retry after reconnect.
- Exam load failure with local snapshot: allow recovery from local snapshot.
- Exam load failure without local snapshot: show retry.
- IndexedDB unavailable: degrade to online-only mode and warn the student not to leave the page.
- External candidate token invalid: return to invitation entry without showing the student app shell.

## Testing Strategy

### Unit Tests

- Manifest and install-state utilities.
- Connectivity hook state transitions.
- Local exam store CRUD and cleanup.
- Draft sync queue ordering and retry behavior.
- Exam status derivation under offline and submitted states.
- Mobile navigation visibility rules by route and role.

### Component Tests

- Student mobile dashboard cards.
- My Exams mobile tabs and cards.
- Result page mobile sections.
- Wrong Answers mobile list and detail.
- Exam top bar, bottom action bar, question map drawer, and submit confirmation.
- Offline and pending-sync status indicators.
- Teacher/admin mobile shell navigation.

### End-to-End Tests

Run Playwright with mobile viewports for:

1. Logged-in student: login, dashboard, exam list, start exam, answer questions, simulate offline, continue answering, restore network, sync, submit, view result.
2. Logged-in student: wrong-answer list and detail.
3. External candidate: open public link, enter exam, answer on mobile, submit, reach done page without PWA shell.
4. PWA basics: manifest present, service worker registered, offline fallback page shown for non-exam pages.
5. Teacher/admin: mobile shell loads, core navigation works, dashboard and key entry pages are usable.

### Manual Verification

- iOS Safari installed-to-home-screen behavior.
- Android Chrome install prompt and standalone display.
- Safe-area handling on notched devices.
- Browser back behavior during active exam.
- Network transitions during an active exam.

## Rollout Plan

### Phase 1: PWA Foundation and Mobile Shells

- Add manifest, icons, meta tags, service worker registration, and offline fallback.
- Add connectivity indicator.
- Convert student layout to responsive desktop/mobile shell.
- Add teacher/admin mobile shell with core navigation.
- Add install entry in the student Me area.

### Phase 2: Student Page Mobile Coverage

- Adapt student dashboard, exam list, result page, wrong-answer list/detail, and notifications.
- Replace wide tables and horizontal controls with mobile cards and sheets.
- Verify all logged-in student routes on mobile viewport.

### Phase 3: Quasi-Offline Exam Taking

- Add IndexedDB-backed exam local store.
- Add answer draft persistence and sync queue.
- Add offline recovery from local exam snapshot.
- Add submit blocking and time-up recovery states.
- Apply the same answer-taking recovery to external candidate exam routes.

### Phase 4: Teacher/Admin Key Mobile Pages

- Improve teacher dashboard/workbench.
- Adapt exam list and grading center entry.
- Add question import mobile entry.
- Add desktop-guidance states for complex pages not fully mobile-supported.

## Open Decisions Resolved

- Target form: PWA-like mobile web, not native app.
- Priority: logged-in student side first; teacher/admin side limited first phase.
- External candidates: mobile answer-taking support only, no PWA shell.
- Offline level: quasi-offline exam after successful start; final submit online-only.
- Push notifications: not included in first phase.

## Acceptance Criteria

- A student can install or use the app on mobile and complete all logged-in student workflows.
- A student can start an exam online, answer through a short offline period, recover after reconnect, and submit online.
- Offline or pending-sync states never imply final submission has happened.
- External candidates can complete public-link exams on mobile without seeing logged-in PWA navigation.
- Teacher/admin users can open the mobile shell, see core status, and reach key entry pages.
- Service worker caching cannot serve stale exam API responses.
- Mobile layouts avoid horizontal overflow, hidden primary actions, and tap targets under 44px for primary controls.
