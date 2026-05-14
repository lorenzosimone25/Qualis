"""Thin HTTP client for Ollama Cloud (no secrets in code — use env vars)."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://ollama.com/api"
DEFAULT_TIMEOUT_S = 120.0


def _ollama_api_key() -> str | None:
    return (os.environ.get("CMS_QUALITY_OLLAMA_API_KEY") or os.environ.get("OLLAMA_API_KEY") or "").strip() or None


def ollama_configured() -> bool:
    return _ollama_api_key() is not None


def ollama_chat(
    messages: list[dict[str, str]],
    *,
    model: str,
    timeout: float = DEFAULT_TIMEOUT_S,
) -> str:
    """POST ``/chat`` (non-streaming). Returns assistant message ``content``."""
    key = _ollama_api_key()
    if not key:
        raise RuntimeError("Ollama API key not configured (OLLAMA_API_KEY or CMS_QUALITY_OLLAMA_API_KEY)")
    base = (os.environ.get("CMS_QUALITY_OLLAMA_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    url = f"{base}/chat"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0},
    }
    headers = {"Authorization": f"Bearer {key}"}
    with httpx.Client(timeout=timeout) as client:
        r = client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        data = r.json()
    msg = data.get("message") or {}
    content = msg.get("content")
    if not isinstance(content, str):
        raise RuntimeError("Unexpected Ollama response: missing message.content")
    return content


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse model output that may be wrapped in markdown fences."""
    raw = text.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    return json.loads(raw)
