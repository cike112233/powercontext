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

"""Cross-call request coalescing and bounded vector caching for embeddings.

Concurrent callers frequently embed overlapping texts while an identical
computation is still in flight. This wrapper shares one underlying request per
distinct text, keeps a bounded LRU of successful vectors, and reports per-call
usage for the distinct underlying batches that call actually waited on.

Cancellation of one caller never cancels shared underlying work: waiters attach
through shields, and the dispatcher owns the batch tasks. Failures are delivered
only to the texts of the failing batch and are never cached, so retries issue
fresh requests while independent batches keep completing.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from collections.abc import Sequence
from dataclasses import dataclass

from powercontext.builtin.inference.models import EmbeddingResult, EmbeddingVector, InferenceUsage
from powercontext.builtin.inference.protocols import EmbeddingModel


@dataclass(frozen=True)
class _BatchOutcome:
    """One text's share of an underlying batch, with the batch's usage."""

    vector: EmbeddingVector | None
    error: BaseException | None
    usage: InferenceUsage


class CoalescingEmbeddingModel:
    """Share in-flight embedding requests and cache successful vectors."""

    def __init__(
        self,
        model: EmbeddingModel,
        *,
        max_batch_size: int = 64,
        coalesce_ms: float = 5.0,
        cache_size: int = 1024,
    ) -> None:
        if type(max_batch_size) is not int or isinstance(max_batch_size, bool) or max_batch_size < 1:
            raise ValueError("max_batch_size must be a positive integer")  # noqa: TRY003
        if isinstance(coalesce_ms, bool) or coalesce_ms < 0:
            raise ValueError("coalesce_ms must be a non-negative number")  # noqa: TRY003
        if type(cache_size) is not int or isinstance(cache_size, bool) or cache_size < 0:
            raise ValueError("cache_size must be a non-negative integer")  # noqa: TRY003
        self._model = model
        self._max_batch_size = max_batch_size
        self._coalesce_seconds = float(coalesce_ms) / 1000.0
        self._cache_size = cache_size
        self._cache: OrderedDict[str, EmbeddingVector] = OrderedDict()
        self._slots: dict[str, asyncio.Future[_BatchOutcome]] = {}
        self._queue: deque[str] = deque()
        self._dispatcher: asyncio.Task[None] | None = None

    @property
    def profile(self):
        return self._model.profile

    async def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        """Return one vector per input position, reusing shared work and cache."""

        ordered = tuple(texts)
        if not ordered:
            return EmbeddingResult(vectors=())
        loop = asyncio.get_running_loop()
        resolved: dict[str, EmbeddingVector] = {}
        waiting: list[tuple[str, asyncio.Future[_BatchOutcome]]] = []
        for text in dict.fromkeys(ordered):
            cached = self._cache_get(text)
            if cached is not None:
                resolved[text] = cached
                continue
            slot = self._slots.get(text)
            if slot is None:
                slot = loop.create_future()
                self._slots[text] = slot
                self._queue.append(text)
                self._ensure_dispatcher(loop)
            waiting.append((text, slot))
        batches: list[InferenceUsage] = []
        for text, slot in waiting:
            outcome = await asyncio.shield(slot)
            if outcome.error is not None:
                raise outcome.error
            resolved[text] = outcome.vector
            if not any(usage is outcome.usage for usage in batches):
                batches.append(outcome.usage)
        return EmbeddingResult(
            vectors=tuple(resolved[text] for text in ordered),
            usage=_sum_usage(batches),
        )

    def _cache_get(self, text: str) -> EmbeddingVector | None:
        if self._cache_size == 0 or text not in self._cache:
            return None
        self._cache.move_to_end(text)
        return self._cache[text]

    def _cache_put(self, text: str, vector: EmbeddingVector) -> None:
        if self._cache_size == 0:
            return
        self._cache[text] = vector
        self._cache.move_to_end(text)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)

    def _ensure_dispatcher(self, loop: asyncio.AbstractEventLoop) -> None:
        if self._dispatcher is None or self._dispatcher.done():
            self._dispatcher = loop.create_task(self._dispatch())

    async def _dispatch(self) -> None:
        while self._queue:
            if self._coalesce_seconds > 0:
                await asyncio.sleep(self._coalesce_seconds)
            batch: list[str] = []
            while self._queue and len(batch) < self._max_batch_size:
                batch.append(self._queue.popleft())
            if batch:
                await self._run_batch(tuple(batch))

    async def _run_batch(self, batch: tuple[str, ...]) -> None:
        try:
            result = await self._model.embed(batch)
            vectors = tuple(result.vectors)
            if len(vectors) != len(batch):
                raise ValueError(  # noqa: TRY003
                    f"embedding model returned {len(vectors)} vectors for {len(batch)} texts"
                )
            usage = result.usage
        except BaseException as error:  # noqa: BLE001 - deliver to this batch only
            outcome = _BatchOutcome(vector=None, error=error, usage=InferenceUsage(requests=0))
            for text in batch:
                self._resolve(text, outcome)
            return
        for text, vector in zip(batch, vectors, strict=True):
            self._cache_put(text, vector)
        for text, vector in zip(batch, vectors, strict=True):
            self._resolve(text, _BatchOutcome(vector=vector, error=None, usage=usage))

    def _resolve(self, text: str, outcome: _BatchOutcome) -> None:
        slot = self._slots.pop(text, None)
        if slot is not None and not slot.done():
            slot.set_result(outcome)


def _sum_usage(batches: Sequence[InferenceUsage]) -> InferenceUsage:
    if not batches:
        return InferenceUsage(requests=0)
    return InferenceUsage(
        requests=sum(usage.requests for usage in batches),
        input_tokens=_sum_tokens(batches, "input_tokens"),
        output_tokens=_sum_tokens(batches, "output_tokens"),
    )


def _sum_tokens(batches: Sequence[InferenceUsage], field: str) -> int | None:
    values = [getattr(usage, field) for usage in batches]
    if all(value is None for value in values):
        return None
    return sum(value or 0 for value in values)


__all__ = ["CoalescingEmbeddingModel"]
