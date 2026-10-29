"""Minimal client for the MiniMax chat completion API.

The competition ships a *Subscription Key* that authenticates against the
public Anthropic-compatible endpoint.  The local MiniMax Code desktop login
uses a different gateway and a different credential type, so the client
resolves its endpoint from configuration instead of hard-coding one.

Only the Anthropic-compatible route is implemented on purpose: it keeps the
reasoning trace and the answer in separate content blocks, which means the
patch parser never has to strip ``<think>`` sections out of the payload.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .config import MinimaxSettings


class MinimaxError(RuntimeError):
    """Raised when the MiniMax API cannot be reached or returns an error."""


@dataclass(frozen=True)
class ChatResult:
    text: str
    model: str
    stop_reason: str
    input_tokens: int = 0
    output_tokens: int = 0
    raw_blocks: tuple[dict[str, Any], ...] = ()

    def to_record(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "stop_reason": self.stop_reason,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "text": self.text,
        }


class MinimaxClient:
    """Thin, dependency-free wrapper around the Anthropic Messages route."""

    def __init__(self, settings: MinimaxSettings) -> None:
        self.settings = settings

    @property
    def messages_url(self) -> str:
        base = self.settings.base_url
        if base.endswith("/v1/messages"):
            return base
        if base.endswith("/anthropic"):
            return f"{base}/v1/messages"
        if base.endswith("/v1"):
            return f"{base}/messages"
        return f"{base}/v1/messages"

    @property
    def available(self) -> bool:
        return bool(self.settings.api_key and self.settings.base_url)

    def chat(self, prompt: str, *, system: str | None = None,
             max_tokens: int | None = None, retries: int = 3) -> ChatResult:
        """Send a single-turn request and return the textual answer."""
        if not self.available:
            raise MinimaxError(
                "no MiniMax credentials configured; set MINIMAX_API_KEY and "
                "MINIMAX_BASE_URL in .env"
            )

        payload: dict[str, Any] = {
            "model": self.settings.model,
            "max_tokens": max_tokens or self.settings.max_tokens,
            "temperature": self.settings.temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            payload["system"] = system

        body = json.dumps(payload).encode("utf-8")
        headers = {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "authorization": f"Bearer {self.settings.api_key}",
            "x-api-key": self.settings.api_key,
        }

        last_error: Exception | None = None
        for attempt in range(retries):
            request = urllib.request.Request(
                self.messages_url, data=body, headers=headers, method="POST"
            )
            try:
                with urllib.request.urlopen(request, timeout=self.settings.timeout) as response:
                    payload_json = json.loads(response.read().decode("utf-8"))
                return self._parse(payload_json)
            except urllib.error.HTTPError as error:  # noqa: PERF203 - retry loop
                detail = error.read().decode("utf-8", "replace")[:500]
                last_error = MinimaxError(f"HTTP {error.code}: {detail}")
                if error.code in {400, 401, 403, 404}:
                    break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                last_error = error
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
        raise MinimaxError(str(last_error))

    def _parse(self, payload: dict[str, Any]) -> ChatResult:
        blocks = payload.get("content") or []
        text = "".join(
            block.get("text", "")
            for block in blocks
            if block.get("type") == "text"
        )
        usage = payload.get("usage") or {}
        return ChatResult(
            text=text,
            model=str(payload.get("model", self.settings.model)),
            stop_reason=str(payload.get("stop_reason", "")),
            input_tokens=int(usage.get("input_tokens", 0) or 0),
            output_tokens=int(usage.get("output_tokens", 0) or 0),
            raw_blocks=tuple(blocks),
        )

    # ------------------------------------------------------------- helpers
    def chat_json(self, prompt: str, *, system: str | None = None,
                  retries: int = 3) -> Any:
        """Ask for a JSON document and parse it defensively."""
        instruction = (
            "Answer with a single valid JSON document and nothing else. "
            "Do not wrap it in markdown fences, do not add commentary.\n\n"
            f"{prompt}"
        )
        result = self.chat(instruction, system=system, retries=retries)
        return parse_json_document(result.text)


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def parse_json_document(text: str) -> Any:
    """Extract a JSON document from a model answer that may contain fences."""
    candidate = text.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    fenced = _FENCE.search(candidate)
    if fenced:
        try:
            return json.loads(fenced.group(1).strip())
        except json.JSONDecodeError:
            candidate = fenced.group(1).strip()

    for opener, closer in (("{", "}"), ("[", "]")):
        start = candidate.find(opener)
        end = candidate.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(candidate[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise MinimaxError("model answer did not contain a parsable JSON document")
