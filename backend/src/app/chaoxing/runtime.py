"""Container startup and deployment preflight, without opening DB connections."""

import asyncio
import importlib.util
import os
import sys

from app.config import settings


def server_command(enabled: bool) -> list[str]:
    return ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1" if enabled else "2"]


async def check_browser() -> None:
    for package in ("playwright", "bs4"):
        if importlib.util.find_spec(package) is None:
            raise RuntimeError(f"missing connector dependency: {package}")
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        options = {"headless": True}
        if settings.chaoxing_browser_executable:
            options["executable_path"] = settings.chaoxing_browser_executable
        browser = await playwright.chromium.launch(**options)
        try:
            page = await browser.new_page()
            await page.set_content("<title>connector ready</title>")
            assert await page.title() == "connector ready"
        finally:
            await browser.close()


def main() -> None:
    if sys.argv[1:] == ["check"]:
        if settings.chaoxing_enabled:
            asyncio.run(check_browser())
        print("enabled" if settings.chaoxing_enabled else "disabled")
        return
    if sys.argv[1:]:
        raise SystemExit("usage: python -m app.chaoxing.runtime [check]")
    command = server_command(settings.chaoxing_enabled)
    os.execvp(command[0], command)


if __name__ == "__main__":
    main()
