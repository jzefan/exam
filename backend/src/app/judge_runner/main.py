from fastapi import FastAPI

from app.judge_runner.router import router

app = FastAPI(title="judge-runner")
app.include_router(router)
