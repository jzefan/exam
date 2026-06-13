"""Step 2: extract knowledge-point candidates from course material text, then
let the teacher confirm and bulk-create them into the course knowledge tree.

Reuses the existing AI model config and the existing ``create_knowledge_point``
service; nothing is written to the tree without explicit teacher confirmation.
"""
