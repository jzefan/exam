# Student First Login Force-Change Password Design

## Summary

Add a student-only first-login password change flow. Newly created student accounts must change their password before they can access any student pages. Existing student accounts remain unchanged. Non-student accounts are unaffected.

## Goals

- Force newly created student accounts to change password on first login.
- Block access to all student business pages until the password is changed.
- Keep the behavior isolated to student accounts only.
- Keep existing student accounts unchanged.
- Make admin-triggered password resets for students reuse the same forced-change flow.

## Non-Goals

- No student-side forgot-password flow changes.
- No changes to teacher/admin first-login behavior.
- No password policy redesign beyond current minimum validation.
- No retroactive migration strategy for historical student accounts.

## Product Rules

### Accounts affected

- Only student accounts participate in this flow.
- Teacher, assessor, admin, and any other non-student accounts ignore this rule.

### New student accounts

- When a new student account is created, it starts with `must_change_password = true`.
- The student may log in with the initial password.
- After login, the student must be redirected to a dedicated force-change-password page.
- Until the password is changed successfully, the student cannot access:
  - student dashboard
  - my exams
  - wrong answers
  - exam taking pages
  - any other student protected routes

### Existing student accounts

- Existing student records are migrated with `must_change_password = false`.
- They continue to work exactly as before.

### After password change

- Once the student sets a new password successfully:
  - password hash is updated
  - `must_change_password` becomes `false`
  - the student regains normal access to student pages
  - the frontend updates the locally cached user state and redirects to the normal student landing page

### Admin password reset for students

- When an administrator updates a student's password from the admin side, the student should be required to change it again at next login.
- That means admin-side password reset for students must set `must_change_password = true`.

## Backend Design

### Data model

Add a new boolean field to the auth user model:

- `must_change_password: bool = false`

Migration behavior:

- existing rows default to `false`
- column is non-nullable after migration completes

### User creation

Student account creation paths must explicitly set:

- `must_change_password = true` for student accounts
- `must_change_password = false` for non-student accounts

This applies to all student creation entry points, including any admin-driven student creation workflow already in use.

### Login response

`/api/auth/login` should continue returning token + user payload, but the `user` payload must include `must_change_password`.

No special login error is required. Login succeeds normally; restriction happens through returned state and route guarding.

### Auth user response

Add `must_change_password` to the shared user response schema and the user serialization path so frontend can reliably read it from:

- login response
- `/api/auth/me`

### Force-change-password endpoint

Add a dedicated authenticated endpoint for first-login password change, for example:

- `POST /api/auth/force-change-password`

Request body:

- `password`
- `confirm_password` is optional on backend because frontend can validate it, but backend should still reject mismatches if the field is provided

Validation:

- caller must be authenticated
- caller must be a student
- caller must currently have `must_change_password = true`
- password minimum length remains aligned with current reset-password rule (at least 6 chars)

Successful behavior:

- update password hash
- set `must_change_password = false`
- commit transaction
- return updated user payload or a success response that lets frontend refresh local user state

Failure behavior:

- non-student caller: reject with 403
- already-cleared student: reject with 400 or allow idempotent success; recommended: 400 with a clear message because this endpoint is only for the forced flow
- invalid password: 422

### Admin-side password change behavior

In admin user update flow:

- when password is updated for a student account, set `must_change_password = true`
- when password is updated for non-student accounts, keep existing behavior and do not force this flag

## Frontend Design

### Local user state

Extend the frontend user model to store `must_change_password`.

Persist it alongside existing auth user data in localStorage so that:

- post-login redirect logic can see it immediately
- page refresh still preserves the forced-change state

### Login behavior

After successful login:

- if user is a student and `must_change_password` is `true`, redirect to a dedicated force-change-password page
- otherwise continue existing login redirect behavior

### New route

Add a dedicated student-only route, for example:

- `/student/force-change-password`

This page should be available only to authenticated students.

### Route guard behavior

Add a student route guard rule:

- if authenticated user is a student and `must_change_password` is `true`
- and current route is not the force-change-password route
- redirect to the force-change-password route

This prevents manual URL bypass.

The force-change-password page itself must remain accessible while the flag is true.

### Force-change-password page UX

Keep it minimal and explicit:

- title: first login, please change your password
- fields:
  - new password
  - confirm password
- submit button
- concise validation messages

Do not show unrelated student navigation or business content on this page.

On success:

- update locally stored user object so `must_change_password = false`
- redirect to the normal student landing page

### Student forgot-password behavior

No new student-side forgot-password flow is introduced.

If the current login page still shows a generic forgot-password action, it is acceptable for now as long as the force-change-password flow remains correct. If later needed, that button can be hidden conditionally for student persona, but that is outside this scoped change.

## Security / Access Expectations

- A student with `must_change_password = true` is authenticated but functionally blocked from protected student pages.
- The system should enforce this on the frontend route layer and not rely only on post-login redirect.
- The dedicated password-change endpoint must require authentication, so the student can only change their own password.

## Testing Strategy

### Backend

Add tests covering:

- new student creation sets `must_change_password = true`
- existing migrated users default to `false`
- login response includes `must_change_password`
- force-change-password endpoint succeeds for flagged students
- force-change-password endpoint clears the flag
- non-student access is rejected
- admin reset of a student password re-sets the flag to `true`

### Frontend

Add tests covering:

- login redirects flagged students to force-change-password page
- normal students are not redirected
- student protected routes redirect flagged students back to force-change-password page
- successful forced password change updates local user state and redirects away
- review/wrong answers/exam pages remain inaccessible until password change completes

## Rollout Notes

- Migration is safe because historical students are initialized with `false`.
- The feature only changes behavior for newly created students and admin-reset students.
- This keeps rollout low-risk and avoids breaking existing student accounts.
