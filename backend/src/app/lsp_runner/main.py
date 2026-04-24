from fastapi import FastAPI

from app.lsp_runner.router import router

app = FastAPI(title="lsp-runner")
app.include_router(router)
