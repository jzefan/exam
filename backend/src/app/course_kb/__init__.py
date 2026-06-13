"""Course knowledge base (material RAG), modeled after ArkLoop's book-kb-rag.

Materials are chunked (heading-aware, typed blocks), embedded, and stored as
the course's semantic retrieval layer. Question generation retrieves the most
relevant chunks (RAG) instead of dumping raw material text into the prompt.

Pipeline:  upload → chunk → embed → store  (status tracked on the material)
Retrieval: query → embed → cosine top-k (scoped to the course / chapters)

The vector store keeps embeddings as JSON float arrays and ranks in Python —
course-scale corpora are small (thousands of chunks), and the host Postgres
image has no pgvector. The store sits behind ``service.search_chunks`` so a
pgvector implementation can replace it without touching callers.
"""
