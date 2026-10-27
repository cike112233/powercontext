# Copyright (c) 2026 OceanBase.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Context Pack incremental transfer protocol.

A Context Pack carries prepared context as UTF-8-safe byte chunks plus a digest and an exact
serialized byte count. A delta names how many leading chunks of a base pack the receiver keeps
and appends the target suffix, so a client holding the previous pack rebuilds the next one
without re-transmitting the shared prefix.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass
from typing import Any

PACK_SCHEMA = "powercontext.context-pack.v1"
DELTA_SCHEMA = "powercontext.context-pack-delta.v1"
DEFAULT_CHUNK_BYTES = 512

_PACK_FIELDS = ("schema", "items", "digest", "byte_count")
_DELTA_FIELDS = ("schema", "base_digest", "target_digest", "prefix_items", "appended")


class ContextPackError(ValueError):
    """Protocol, digest, or chunking validation failure."""


def _canonical(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _encode_item(item: bytes) -> str:
    return base64.b64encode(item).decode("ascii")


def _decode_item(value: Any) -> bytes:
    if not isinstance(value, str):
        raise ContextPackError("base64 chunk must be a string")  # noqa: TRY003
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except (binascii.Error, ValueError, UnicodeEncodeError) as error:
        raise ContextPackError(f"invalid base64 chunk: {error}") from error


def _load_payload(data: Any) -> dict[str, Any]:
    if isinstance(data, (bytes, bytearray, memoryview)):
        raw = bytes(data)
    else:
        raise ContextPackError("payload must be bytes")  # noqa: TRY003
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ContextPackError(f"payload is not UTF-8 JSON: {error}") from error
    if not isinstance(payload, dict):
        raise ContextPackError("payload must be a JSON object")  # noqa: TRY003
    return payload


def _chunk_bytes(data: bytes, chunk_bytes: int) -> tuple[bytes, ...]:
    """Split into line chunks, subdividing over-long lines on UTF-8 boundaries."""
    chunks: list[bytes] = []
    for line in data.splitlines(keepends=True):
        start = 0
        while len(line) - start > chunk_bytes:
            end = start + chunk_bytes
            while end > start and (line[end] & 0xC0) == 0x80:
                end -= 1
            if end == start:
                raise ContextPackError(  # noqa: TRY003
                    f"chunk limit {chunk_bytes} cannot hold one UTF-8 character"
                )
            chunks.append(line[start:end])
            start = end
        chunks.append(line[start:])
    return tuple(chunks)


@dataclass(frozen=True)
class ContextPack:
    """One immutable serialized context payload."""

    items: tuple[bytes, ...]
    digest: str
    byte_count: int

    @classmethod
    def build(cls, items: Any) -> ContextPack:
        normalized = tuple(items)
        for item in normalized:
            if not isinstance(item, bytes):
                raise ContextPackError("pack items must be bytes")  # noqa: TRY003
        unsigned: dict[str, Any] = {"schema": PACK_SCHEMA, "items": [_encode_item(i) for i in normalized]}
        digest = "sha256:" + hashlib.sha256(_canonical(unsigned)).hexdigest()
        byte_count = 0
        for _ in range(8):
            encoded = _canonical({**unsigned, "digest": digest, "byte_count": byte_count})
            if len(encoded) == byte_count:
                return cls(items=normalized, digest=digest, byte_count=byte_count)
            byte_count = len(encoded)
        raise ContextPackError("pack byte_count did not converge")  # noqa: TRY003

    @classmethod
    def from_content(cls, content: str, *, chunk_bytes: int = DEFAULT_CHUNK_BYTES) -> ContextPack:
        if not isinstance(content, str):
            raise ContextPackError("content must be str")  # noqa: TRY003
        if isinstance(chunk_bytes, bool) or not isinstance(chunk_bytes, int) or chunk_bytes < 1:
            raise ContextPackError("chunk_bytes must be a positive integer")  # noqa: TRY003
        return cls.build(_chunk_bytes(content.encode("utf-8"), chunk_bytes))

    @classmethod
    def from_bytes(cls, data: Any) -> ContextPack:
        payload = _load_payload(data)
        if tuple(sorted(payload)) != tuple(sorted(_PACK_FIELDS)):
            raise ContextPackError(f"pack fields must be {_PACK_FIELDS}")  # noqa: TRY003
        if payload["schema"] != PACK_SCHEMA:
            raise ContextPackError("unsupported pack schema")  # noqa: TRY003
        wire_items = payload["items"]
        if not isinstance(wire_items, list):
            raise ContextPackError("pack items must be a list")  # noqa: TRY003
        items = tuple(_decode_item(value) for value in wire_items)
        digest = payload["digest"]
        byte_count = payload["byte_count"]
        if not isinstance(digest, str):
            raise ContextPackError("pack digest must be a string")  # noqa: TRY003
        if isinstance(byte_count, bool) or not isinstance(byte_count, int):
            raise ContextPackError("pack byte_count must be an integer")  # noqa: TRY003
        unsigned: dict[str, Any] = {"schema": PACK_SCHEMA, "items": wire_items}
        expected = "sha256:" + hashlib.sha256(_canonical(unsigned)).hexdigest()
        if digest != expected:
            raise ContextPackError("pack digest does not match items")  # noqa: TRY003
        if byte_count != len(_canonical(payload)):
            raise ContextPackError("pack byte_count does not match payload")  # noqa: TRY003
        return cls(items=items, digest=digest, byte_count=byte_count)

    def to_bytes(self) -> bytes:
        payload: dict[str, Any] = {
            "schema": PACK_SCHEMA,
            "items": [_encode_item(item) for item in self.items],
            "digest": self.digest,
            "byte_count": self.byte_count,
        }
        return _canonical(payload)


@dataclass(frozen=True)
class ContextPackDelta:
    """Retained base prefix plus the target suffix chunks."""

    base_digest: str
    target_digest: str
    prefix_items: int
    appended: tuple[bytes, ...]

    @property
    def byte_count(self) -> int:
        return len(self.to_bytes())

    @classmethod
    def between(cls, base: ContextPack, target: ContextPack) -> ContextPackDelta:
        prefix = 0
        for base_item, target_item in zip(base.items, target.items):
            if base_item != target_item:
                break
            prefix += 1
        return cls(base.digest, target.digest, prefix, target.items[prefix:])

    @classmethod
    def from_bytes(cls, data: Any) -> ContextPackDelta:
        payload = _load_payload(data)
        if tuple(sorted(payload)) != tuple(sorted(_DELTA_FIELDS)):
            raise ContextPackError(f"delta fields must be {_DELTA_FIELDS}")  # noqa: TRY003
        if payload["schema"] != DELTA_SCHEMA:
            raise ContextPackError("unsupported delta schema")  # noqa: TRY003
        base_digest = payload["base_digest"]
        target_digest = payload["target_digest"]
        prefix_items = payload["prefix_items"]
        appended_wire = payload["appended"]
        if not isinstance(base_digest, str) or not isinstance(target_digest, str):
            raise ContextPackError("delta digests must be strings")  # noqa: TRY003
        if isinstance(prefix_items, bool) or not isinstance(prefix_items, int) or prefix_items < 0:
            raise ContextPackError("delta prefix_items must be a non-negative integer")  # noqa: TRY003
        if not isinstance(appended_wire, list):
            raise ContextPackError("delta appended must be a list")  # noqa: TRY003
        appended = tuple(_decode_item(value) for value in appended_wire)
        return cls(base_digest, target_digest, prefix_items, appended)

    def to_bytes(self) -> bytes:
        payload: dict[str, Any] = {
            "schema": DELTA_SCHEMA,
            "base_digest": self.base_digest,
            "target_digest": self.target_digest,
            "prefix_items": self.prefix_items,
            "appended": [_encode_item(item) for item in self.appended],
        }
        return _canonical(payload)


def apply_context_pack_delta(base: ContextPack, delta: ContextPackDelta) -> ContextPack:
    """Rebuild the target pack from a held base pack and one received delta."""
    if delta.base_digest != base.digest:
        raise ContextPackError("delta base digest does not match base pack")  # noqa: TRY003
    if delta.prefix_items > len(base.items):
        raise ContextPackError("delta prefix exceeds base chunk count")  # noqa: TRY003
    rebuilt = ContextPack.build(base.items[: delta.prefix_items] + delta.appended)
    if rebuilt.digest != delta.target_digest:
        raise ContextPackError("rebuilt pack digest does not match delta target")  # noqa: TRY003
    return rebuilt


__all__ = [
    "DEFAULT_CHUNK_BYTES",
    "DELTA_SCHEMA",
    "PACK_SCHEMA",
    "ContextPack",
    "ContextPackDelta",
    "ContextPackError",
    "apply_context_pack_delta",
]
