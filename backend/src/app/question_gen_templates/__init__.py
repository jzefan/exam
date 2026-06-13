"""Course question-generation templates (Step 1).

A template bundles the four reusable bases for a course's question generation:
course materials (text snapshots), a student profile, seed questions, and
generation rules. Generation itself reuses the existing
``generate_questions_stream`` engine — this module only assembles context.
"""
