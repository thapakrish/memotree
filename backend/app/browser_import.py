from __future__ import annotations

import asyncio
import os

from playwright.async_api import Browser
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Page
from playwright.async_api import Playwright
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

_PLAYWRIGHT: Playwright | None = None
_BROWSER: Browser | None = None
_BROWSER_LOCK = asyncio.Lock()
_MAX_CONCURRENT_BROWSER_IMPORTS = max(1, int(os.getenv("MEMOTREE_BROWSER_IMPORT_CONCURRENCY", "2")))
_BROWSER_SEMAPHORE = asyncio.Semaphore(_MAX_CONCURRENT_BROWSER_IMPORTS)


def browser_fallback_enabled() -> bool:
    return os.getenv("MEMOTREE_ENABLE_BROWSER_FALLBACK", "1").lower() not in {"0", "false", "no"}


async def get_browser() -> Browser:
    global _PLAYWRIGHT, _BROWSER

    if _BROWSER is not None and _BROWSER.is_connected():
        return _BROWSER

    async with _BROWSER_LOCK:
        if _BROWSER is not None and _BROWSER.is_connected():
            return _BROWSER

        _PLAYWRIGHT = await async_playwright().start()
        _BROWSER = await _PLAYWRIGHT.chromium.launch(headless=True)
        return _BROWSER


async def close_browser() -> None:
    global _PLAYWRIGHT, _BROWSER

    if _BROWSER is not None:
        await _BROWSER.close()
        _BROWSER = None

    if _PLAYWRIGHT is not None:
        await _PLAYWRIGHT.stop()
        _PLAYWRIGHT = None


async def fetch_rendered_html(url: str, timeout_ms: int = 20000) -> str:
    if not browser_fallback_enabled():
        raise RuntimeError("Browser fallback is disabled in this environment.")

    try:
        async with _BROWSER_SEMAPHORE:
            browser = await get_browser()
            page: Page = await browser.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                try:
                    await page.wait_for_load_state("networkidle", timeout=min(timeout_ms, 10000))
                except PlaywrightTimeoutError:
                    # Some providers keep long-lived connections open; DOMContentLoaded is enough for a fallback attempt.
                    pass
                return await page.content()
            finally:
                await page.close()
    except PlaywrightTimeoutError as error:
        raise TimeoutError("Timed out while rendering the shared chat page in the browser fallback.") from error
    except PlaywrightError as error:
        raise RuntimeError(f"Playwright fallback failed: {error}") from error
