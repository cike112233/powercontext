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

"""HTTP-based Memory reranker that delegates scoring to a remote service."""

from __future__ import annotations

import json
import math
from typing import Any

import httpx

from powercontext.builtin.artifacts.memory.models import MemoryHit
from powercontext.builtin.artifacts.memory.reranking import (
    MemoryRerankDecision,
    MemoryReranker,
    _validate_bounds,
)
from powercontext.builtin.inference.models import InferenceUsage


class HTTPMemoryReranker:
    """Rerank Memory candidates via an HTTP scoring service.

    Sends candidates in batches to a remote endpoint, collects scores,
    and returns a globally sorted selection.
    """

    def __init__(
        self,
        endpoint: str,
        *,
        client: httpx.AsyncClient,
        batch_size: int = 32,
        policy_id: str = "http-score-encoder-v1",
    ) -> None:
        if batch_size < 1:
            raise ValueError("batch_size must be >= 1")
        self._endpoint = endpoint
        self._client = client
        self._batch_size = batch_size
        self.policy_id = policy_id

    async def rerank(
        self,
        query: str,
        candidates: tuple[MemoryHit, ...],
        limit: int,
        /,
    ) -> MemoryRerankDecision:
        """Rerank candidates by sending batches to the HTTP service.

        Args:
            query: The search query
            candidates: Tuple of MemoryHit candidates with original ranks
            limit: Maximum number of results to return

        Returns:
            MemoryRerankDecision with selected ranks and usage info

        Raises:
            ValueError: On invalid input or response schema
            httpx.HTTPError: On network or HTTP errors
        """
        _validate_bounds(len(candidates), limit)

        # Split candidates into batches
        batches = []
        for i in range(0, len(candidates), self._batch_size):
            batch = candidates[i : i + self._batch_size]
            batches.append(batch)

        # Send batches and collect scores
        all_scores: dict[int, float] = {}
        request_count = 0

        for batch in batches:
            request_count += 1
            payload = {
                "query": query,
                "candidates": [{"rank": i + 1, "text": hit.text} for i, hit in enumerate(batch, start=1)],
            }

            try:
                response = await self._client.post(self._endpoint, json=payload)
                response.raise_for_status()
            except httpx.HTTPError:
                raise
            except Exception as e:
                raise httpx.HTTPError(f"Request failed: {e}") from e

            # Parse and validate response
            try:
                data = response.json()
            except (json.JSONDecodeError, ValueError) as e:
                raise ValueError(f"Invalid JSON response: {e}") from e

            # Validate response schema
            if not isinstance(data, dict):
                raise ValueError("Response must be a JSON object")
            if set(data.keys()) != {"scores"}:
                raise ValueError(f"Response must contain only 'scores' key, got {set(data.keys())}")

            scores_list = data["scores"]
            if not isinstance(scores_list, list):
                raise ValueError("'scores' must be a list")

            # Validate each score entry
            for score_entry in scores_list:
                if not isinstance(score_entry, dict):
                    raise ValueError("Each score entry must be an object")
                if set(score_entry.keys()) != {"rank", "score"}:
                    raise ValueError(f"Score entry must contain only 'rank' and 'score', got {set(score_entry.keys())}")

                rank = score_entry["rank"]
                score = score_entry["score"]

                if not isinstance(rank, int):
                    raise ValueError(f"rank must be an integer, got {type(rank)}")
                if not isinstance(score, (int, float)):
                    raise ValueError(f"score must be a number, got {type(score)}")
                if math.isnan(score) or math.isinf(score):
                    raise ValueError(f"score must be finite, got {score}")

                # Map batch-local rank to global rank
                batch_start = batches.index(batch) * self._batch_size + 1
                global_rank = batch_start + rank - 1
                all_scores[global_rank] = float(score)

        # Validate we got scores for all candidates
        if set(all_scores.keys()) != set(range(1, len(candidates) + 1)):
            missing = set(range(1, len(candidates) + 1)) - set(all_scores.keys())
            extra = set(all_scores.keys()) - set(range(1, len(candidates) + 1))
            raise ValueError(f"Score coverage mismatch: missing={missing}, extra={extra}")

        # Sort by score descending, then by rank ascending for ties
        sorted_ranks = sorted(all_scores.keys(), key=lambda r: (-all_scores[r], r))

        # Select top limit
        selected_ranks = tuple(sorted_ranks[:limit])

        return MemoryRerankDecision(
            selected_ranks=selected_ranks,
            usage=InferenceUsage(requests=request_count),
            discarded_rank_count=len(candidates) - len(selected_ranks),
        )


__all__ = ["HTTPMemoryReranker"]
