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

"""Prepare final, bounded context from approved Artifact evidence."""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, replace
from itertools import chain
from typing import TypeVar

from powercontext.artifacts import ArtifactAddress, ArtifactRef
from powercontext.builtin.artifacts.experience import Experience, ExperienceSearchHit, render_experience
from powercontext.builtin.artifacts.memory.models import MemoryCitation, MemoryHit
from powercontext.builtin.artifacts.profile.models import Profile
from powercontext.builtin.artifacts.topic_memory import TopicMemory, TopicMemorySearchHit
from powercontext.builtin.runtime.errors import PreparedContextInvariantError
from powercontext.builtin.runtime.models import PrepareContextRequest, PreparedContext
from powercontext.builtin.runtime.prepared_code import (
    CodeEvidenceRef,
    PreparedCodeCandidate,
    assemble_code,
)
from powercontext.builtin.runtime.prepared_text import (
    TRUST_POLICY,
    ContextTextItem,
    fit_context_text_item,
    render_context_text,
)
from powercontext.builtin.runtime.recall_sufficiency import RecallBudgetView

_MIN_TRUNCATED_CONTENT_BYTES = 64
_ELLIPSIS = "…"
_BEGIN_MARKER = "BEGIN_POWERCONTEXT_PREPARED_CONTEXT_V1"
_END_MARKER = "END_POWERCONTEXT_PREPARED_CONTEXT_V1"
_Item = TypeVar("_Item")

_EVIDENCE_TOKEN_PATTERN = re.compile(r"[a-z]+|\d+")
# Require following whitespace (or end of text) so that decimals like "0.02" and abbreviations
# glued to the next character never split an annotated sentence into unreachable pieces.
_EVIDENCE_SENTENCE_END_PATTERN = re.compile(r"[.!?]+(?=\s|$)")
_EVIDENCE_CLAUSE_END_PATTERN = re.compile(r"[,;:]+(?=\s|$)")
_MAX_EVIDENCE_SPAN_CHARS = 400
_EVIDENCE_LEADING_SPAN_FACTOR = 0.6
_EVIDENCE_BIGRAM_WEIGHT = 0.5
_EVIDENCE_SCORE_TIEBREAK = 0.01
_EVIDENCE_STOPWORDS = frozenset(
    """
    a about above after again against all also am an and any are as at be because been before being below between
    both but by can cannot could did do does doing down during each either else ever every few for from further had
    has have having he her here hers him his how i if in into is it its itself just may me might more most much must
    my neither no nor not now of off on once only or other our ours out over own same shall she should since so some
    such than that the their theirs them then there these they this those though through thus to too under until up
    upon very was we were what when where whether which while who whom why will with within without would you your
    yours yourself
    """.split()
)


@dataclass(frozen=True)
class _PreparedContextEntry:
    origin: PreparedContextOrigin
    kind: str
    citation: dict[str, object]
    content: str
    truncated: bool


@dataclass(frozen=True)
class _EntryFit:
    """One fit attempt on the non-assembly path: the entry that fitted, or why none did.

    The two drop reasons are disjoint and mirror the assembly path's
    :class:`~powercontext.builtin.runtime.prepared_text.FitOutcome`. An entry is dropped
    *below the minimum truncated content* when a shorter rendering exists and fits but is too
    short to be an honest delivery; it is dropped *with no fitting truncation* when no
    shortened rendering fits at all.
    """

    entry: _PreparedContextEntry | None = None
    dropped_below_min_bytes: bool = False
    dropped_no_fitting_truncation: bool = False


@dataclass(frozen=True)
class _EvidenceItem:
    """One query-scored literal span of a Memory entry, as a renderable context item.

    ``source`` keeps the entry's full text so that adjacent selected spans of the same entry
    can be merged into a single literal fragment without another lookup.
    """

    group: int
    hit: int
    score: float
    address: MemoryEntryAddress
    citation: dict[str, object]
    start: int
    end: int
    text: str
    source: str
    stems: tuple[str, ...] = ()


@dataclass(frozen=True)
class PreparedContextOmissions:
    """Aggregate counts of the items the byte budget omitted in one build.

    Every count is a per-call aggregate, never per-entry attribution and never a verdict about
    an entry: an entry losing to the budget is not a negative result about that entry.

    ``dropped_items`` is the sum of its two sub-counts, so "the budget could not fit this
    item" can be told apart from "this item was too short to truncate into the remaining
    space". A single merged counter would misreport the second cause as the first.
    """

    truncated_items: int = 0
    dropped_items: int = 0
    dropped_below_min_bytes: int = 0
    dropped_no_fitting_truncation: int = 0


@dataclass(frozen=True)
class PreparedContextBuild:
    """Final public context and the exact origins selected to produce it.

    ``omissions`` is always filled by the Builder. The RFC 1560 recall trace is deliberately
    **not** a field here: ``ScopedContextApplication._prepare`` returns ``build.context`` and
    discards the rest, so such a field would have no production observer. The trace is
    delivered through the Runtime's optional ``RecallEffortSink`` instead.
    """

    context: PreparedContext
    origins: tuple[PreparedContextOrigin, ...]
    omissions: PreparedContextOmissions = PreparedContextOmissions()
    code_origins: tuple[CodeEvidenceRef, ...] = ()
    fragments: tuple[PreparedFragment, ...] = ()


@dataclass(frozen=True)
class MemoryEntryAddress:
    """Identify one exact Memory entry version across Scope boundaries."""

    memory: ArtifactAddress
    entry_id: str
    entry_version_id: str


@dataclass(frozen=True)
class PreparedFragment:
    """One literal query-selected fragment of a Memory entry's original text.

    ``start``/``end`` are half-open Python character coordinates into ``entry.text`` and
    ``text`` is exactly ``entry.text[start:end]``; nothing is rewritten, translated, or
    summarized. One entry may contribute several fragments.
    """

    address: MemoryEntryAddress
    start: int
    end: int
    text: str


PreparedContextOrigin = MemoryCitation | ArtifactRef | MemoryEntryAddress | ArtifactAddress


@dataclass(frozen=True)
class PreparedMemoryCandidates:
    """Memory candidates read from one Scope."""

    scope_id: str
    memory_ref: ArtifactRef | None = None
    hits: tuple[MemoryHit, ...] = ()


@dataclass(frozen=True)
class PreparedExperienceCandidates:
    """Experience candidates read from one Scope."""

    scope_id: str
    hits: tuple[ExperienceSearchHit, ...] = ()


@dataclass(frozen=True)
class PreparedProfileCandidate:
    """The latest committed Profile snapshot read from one Scope."""

    scope_id: str
    profile: Profile


class PreparedContextBuilder:
    """Select and render final context without I/O, persistence, or reranking."""

    memory_candidate_limit = 16
    topic_memory_candidate_limit = 8
    experience_candidate_limit = 8
    candidate_limit = memory_candidate_limit
    entry_limit = 8
    topic_memory_entry_limit = 8
    experience_entry_limit = 2
    max_entry_content_bytes = 2000
    _text_entry_limit: int | None = None

    def empty(self) -> PreparedContext:
        return PreparedContext(status="empty", content=None, content_bytes=0)

    def build(
        self,
        *,
        request: PrepareContextRequest,
        scope_id: str | None = None,
        memory_ref: ArtifactRef | None = None,
        hits: Sequence[MemoryHit] = (),
        topic_memory_hits: Sequence[TopicMemorySearchHit] = (),
        experience_hits: Sequence[ExperienceSearchHit] = (),
    ) -> PreparedContext:
        return self.build_result(
            request=request,
            scope_id=scope_id,
            memory_ref=memory_ref,
            hits=hits,
            topic_memory_hits=topic_memory_hits,
            experience_hits=experience_hits,
        ).context

    def build_result(
        self,
        *,
        request: PrepareContextRequest,
        scope_id: str | None = None,
        memory_ref: ArtifactRef | None = None,
        hits: Sequence[MemoryHit] = (),
        topic_memory_hits: Sequence[TopicMemorySearchHit] = (),
        experience_hits: Sequence[ExperienceSearchHit] = (),
    ) -> PreparedContextBuild:
        return self.build_scopes_result(
            request=request,
            current_scope_id=scope_id,
            memory_candidates=(
                PreparedMemoryCandidates(scope_id=scope_id or "", memory_ref=memory_ref, hits=tuple(hits)),
            ),
            experience_candidates=(PreparedExperienceCandidates(scope_id=scope_id or "", hits=tuple(experience_hits)),),
            topic_memory_hits=topic_memory_hits,
        )

    def build_scopes_result(
        self,
        *,
        request: PrepareContextRequest,
        current_scope_id: str | None,
        memory_candidates: Sequence[PreparedMemoryCandidates] = (),
        topic_memory_hits: Sequence[TopicMemorySearchHit] = (),
        experience_candidates: Sequence[PreparedExperienceCandidates] = (),
        profile_candidates: Sequence[PreparedProfileCandidate] = (),
        code_candidates: Sequence[PreparedCodeCandidate] = (),
    ) -> PreparedContextBuild:
        if request.evidence_selection:
            if sum(len(candidates.hits) for candidates in memory_candidates) > self.memory_candidate_limit:
                raise PreparedContextInvariantError("memory-candidate-limit")
            return self._build_evidence(
                request=request,
                current_scope_id=current_scope_id,
                memory_candidates=memory_candidates,
            )
        if request.include_code:

            def historical(history_request: PrepareContextRequest, entries: int) -> PreparedContextBuild:
                builder = PreparedContextBuilder()
                builder.entry_limit = entries
                builder._text_entry_limit = entries if entries < self.entry_limit else None
                return builder.build_scopes_result(
                    request=history_request.model_copy(update={"include_code": False}),
                    current_scope_id=current_scope_id,
                    memory_candidates=memory_candidates,
                    topic_memory_hits=topic_memory_hits,
                    experience_candidates=experience_candidates,
                    profile_candidates=profile_candidates,
                )

            return assemble_code(request, code_candidates, self.entry_limit, historical)

        if sum(len(candidates.hits) for candidates in memory_candidates) > self.memory_candidate_limit:
            raise PreparedContextInvariantError("memory-candidate-limit")
        if len(topic_memory_hits) > self.topic_memory_candidate_limit:
            raise PreparedContextInvariantError("topic-memory-candidate-limit")
        if sum(len(candidates.hits) for candidates in experience_candidates) > self.experience_candidate_limit:
            raise PreparedContextInvariantError("experience-candidate-limit")

        content, origins, omissions = self._select_entries(
            request=request,
            current_scope_id=current_scope_id,
            memory_candidates=memory_candidates,
            experience_candidates=experience_candidates,
            profile_candidates=profile_candidates,
            topic_memory_hits=topic_memory_hits,
        )
        if content is None:
            return PreparedContextBuild(context=self.empty(), origins=(), omissions=omissions)
        content_bytes = len(content.encode("utf-8"))
        # The assembly path is bounded by construction (every fitted item is measured against
        # `max_bytes`), so the ceiling check belongs to the non-assembly renderer only.
        if request.assembly is None and content_bytes > request.max_bytes:
            raise PreparedContextInvariantError("output-budget")
        return PreparedContextBuild(
            context=PreparedContext(status="ready", content=content, content_bytes=content_bytes),
            origins=origins,
            omissions=omissions,
        )

    def _build_evidence(
        self,
        *,
        request: PrepareContextRequest,
        current_scope_id: str | None,
        memory_candidates: Sequence[PreparedMemoryCandidates],
    ) -> PreparedContextBuild:
        """Select literal query-relevant fragments from Memory candidates under the byte budget.

        Pure selection over the recalled candidate texts: sentences (and clause pieces of very
        long sentences) are scored against ``request.query`` with rare-term weighting, then taken
        greedily best-first while the *fully rendered* output stays within ``request.max_bytes``.
        Selected adjacent spans of one entry merge into a single fragment, so output remains
        literal ``entry.text[start:end]`` with exact citations and character coordinates.
        """

        ranked, idf, query_stems = self._evidence_items(memory_candidates, request.query)
        positive = [item for item in ranked if item.score > 0.0]
        included: list[_EvidenceItem] = []
        selected: set[int] = set()
        remaining = Counter(query_stems)
        while True:
            # Coverage-gain greedy: each round picks the fitting span that still adds the most
            # *uncovered* query material (idf-weighted), with a small score tiebreak. Spans that
            # merely repeat what earlier picks already delivered — typical of topically similar
            # but irrelevant entries — therefore lose to fresh evidence, and the pass ends when
            # nothing positive fits anymore.
            best_index = -1
            best_gain = 0.0
            for index, item in enumerate(positive):
                if index in selected:
                    continue
                gain = _evidence_gain(item, remaining, idf)
                if gain <= best_gain:
                    continue
                # Measure the candidate against its merged rendering: a span touching an already
                # selected one costs only its extra text (the shared citation collapses), so
                # continuations of the same evidence sentence stay affordable.
                prospective = _merge_evidence_items(_sort_evidence_items((*included, item)))
                if _evidence_rendered_bytes(prospective) > request.max_bytes:
                    continue
                best_index = index
                best_gain = gain
            if best_index < 0:
                break
            selected.add(best_index)
            item = positive[best_index]
            included.append(item)
            span_counts = Counter(item.stems)
            for stem, count in span_counts.items():
                if remaining.get(stem, 0) > 0:
                    remaining[stem] = max(0, remaining[stem] - count)
        dropped = len(positive) - len(included)
        merged = _merge_evidence_items(_sort_evidence_items(included))
        omissions = PreparedContextOmissions(
            dropped_items=dropped,
            dropped_no_fitting_truncation=dropped,
        )
        if not merged:
            return PreparedContextBuild(context=self.empty(), origins=(), omissions=omissions)
        content = _render_evidence(merged)
        content_bytes = len(content.encode("utf-8"))
        if content_bytes > request.max_bytes:
            raise PreparedContextInvariantError("output-budget")
        fragments = tuple(
            PreparedFragment(address=item.address, start=item.start, end=item.end, text=item.text)
            for item in merged
        )
        origins = tuple(
            MemoryCitation(
                memory_ref=item.address.memory.artifact,
                entry_id=item.address.entry_id,
                entry_version_id=item.address.entry_version_id,
            )
            if current_scope_id is not None and item.address.memory.scope_id == current_scope_id
            else item.address
            for item in merged
        )
        return PreparedContextBuild(
            context=PreparedContext(status="ready", content=content, content_bytes=content_bytes),
            origins=origins,
            omissions=omissions,
            fragments=fragments,
        )

    def _evidence_items(
        self,
        memory_candidates: Sequence[PreparedMemoryCandidates],
        query: str,
    ) -> tuple[tuple[_EvidenceItem, ...], dict[str, float], Counter[str]]:
        """Score every sentence span of every deduplicated Memory hit against the query.

        Two passes: first collect spans with their stem profiles, then weight query stems by
        inverse span frequency across exactly this candidate pool (rare, discriminative terms
        dominate boilerplate), plus a small adjacent-bigram bonus for query phrases appearing
        verbatim. Returns items sorted best-first together with the stem weights used by the
        coverage-gain selection in :meth:`_build_evidence`.
        """

        records: list[_EvidenceItem] = []
        stem_profiles: list[tuple[str, ...]] = []
        for group_index, candidates in enumerate(memory_candidates):
            if candidates.hits and candidates.memory_ref is None:
                raise PreparedContextInvariantError("memory-ref-missing")
            seen: set[tuple[str, str]] = set()
            for hit_index, hit in enumerate(candidates.hits):
                if hit.memory_ref != candidates.memory_ref:
                    raise PreparedContextInvariantError("memory-ref-mismatch")
                citation_key = (hit.entry_id, hit.entry_version_id)
                if citation_key in seen:
                    continue
                seen.add(citation_key)
                if not hit.entry_id.strip() or not hit.entry_version_id.strip() or not hit.text.strip():
                    continue
                address = MemoryEntryAddress(
                    memory=ArtifactAddress(scope_id=candidates.scope_id, artifact=candidates.memory_ref),
                    entry_id=hit.entry_id,
                    entry_version_id=hit.entry_version_id,
                )
                citation = {
                    "scope_id": candidates.scope_id,
                    "memory_ref": candidates.memory_ref.model_dump(mode="json"),
                    "entry_id": hit.entry_id,
                    "entry_version_id": hit.entry_version_id,
                }
                for start, end in _evidence_sentence_spans(hit.text):
                    span = hit.text[start:end]
                    tokens = _EVIDENCE_TOKEN_PATTERN.findall(span.lower())
                    stems = tuple(_evidence_stem(token) for token in tokens)
                    records.append(
                        _EvidenceItem(
                            group=group_index,
                            hit=hit_index,
                            score=0.0,
                            address=address,
                            citation=citation,
                            start=start,
                            end=end,
                            text=span,
                            source=hit.text,
                            stems=stems,
                        )
                    )
                    stem_profiles.append(stems)

        query_stems, query_bigrams, char_counts = _evidence_query_terms(query)
        idf: dict[str, float] = {}
        if char_counts is None:
            span_count = len(stem_profiles)
            idf = {
                stem: math.log((1 + span_count) / (1 + sum(stem in profile for profile in stem_profiles))) + 1.0
                for stem in query_stems
            }
        scored: list[_EvidenceItem] = []
        for record, profile in zip(records, stem_profiles, strict=True):
            score = (
                _evidence_char_score(record.text, char_counts)
                if char_counts is not None
                else _evidence_span_score(profile, query_stems, query_bigrams, idf)
            )
            if record.start == 0:
                # Leading spans carry titles and boilerplate, which quote the topic densely but
                # are rarely the specific evidence a query needs deeper in the document.
                score *= _EVIDENCE_LEADING_SPAN_FACTOR
            scored.append(replace(record, score=score))
        scored.sort(key=lambda item: (-item.score, item.group, item.hit, item.start))
        return tuple(scored), idf, query_stems

    def probe_budget(
        self,
        *,
        request: PrepareContextRequest,
        current_scope_id: str | None,
        memory_candidates: Sequence[PreparedMemoryCandidates] = (),
        topic_memory_hits: Sequence[TopicMemorySearchHit] = (),
        experience_candidates: Sequence[PreparedExperienceCandidates] = (),
        profile_candidates: Sequence[PreparedProfileCandidate] = (),
    ) -> RecallBudgetView:
        """Report what the byte budget does to one candidate set, without delivering it.

        This is the RFC 1560 *budget probe*: one pass of this Builder's own pure selection and
        rendering code, keeping only the counters and discarding the rendered output. It lets
        the gate tell budget-limited thinness from recall-limited thinness.

        Pure and side-effect free: no I/O, no persistence, nothing reported to any sink, and
        the same inputs as :meth:`build_scopes_result` are guaranteed to yield the same
        counters because both go through :meth:`_select_entries`.
        """

        content, origins, omissions = self._select_entries(
            request=request,
            current_scope_id=current_scope_id,
            memory_candidates=memory_candidates,
            experience_candidates=experience_candidates,
            profile_candidates=profile_candidates,
            topic_memory_hits=topic_memory_hits,
        )
        content_bytes = 0 if content is None else len(content.encode("utf-8"))
        return RecallBudgetView(
            max_bytes=request.max_bytes,
            delivered_items=len(origins),
            truncated_items=omissions.truncated_items,
            dropped_items=omissions.dropped_items,
            unused_bytes=max(0, request.max_bytes - content_bytes),
        )

    def _select_entries(
        self,
        *,
        request: PrepareContextRequest,
        current_scope_id: str | None,
        memory_candidates: Sequence[PreparedMemoryCandidates],
        topic_memory_hits: Sequence[TopicMemorySearchHit],
        experience_candidates: Sequence[PreparedExperienceCandidates],
        profile_candidates: Sequence[PreparedProfileCandidate],
    ) -> tuple[str | None, tuple[PreparedContextOrigin, ...], PreparedContextOmissions]:
        """Run one complete pure selection pass and render it.

        Returns ``(content, origins, omissions)``; ``content`` is ``None`` exactly when nothing
        was selected, which is the empty-result case for both paths. This is the single
        selection path shared by :meth:`build_scopes_result` and :meth:`probe_budget`, so the
        probe's counters always describe the selection the build would actually perform.
        """

        if request.assembly is not None:
            return self._select_text(
                request,
                current_scope_id=current_scope_id,
                memory_candidates=memory_candidates,
                experience_candidates=experience_candidates,
                profile_candidates=profile_candidates,
                topic_memory_hits=topic_memory_hits,
            )

        memory_entries = _interleave_groups(
            tuple(
                self._memory_entries(
                    candidates.memory_ref,
                    candidates.hits,
                    scope_id=None if candidates.scope_id == current_scope_id else candidates.scope_id or None,
                )
                for candidates in memory_candidates
            )
        )
        topic_memory_entries = self._topic_memory_entries(topic_memory_hits)
        experience_entries = _interleave_groups(
            tuple(
                self._experience_entries(
                    candidates.hits,
                    scope_id=None if candidates.scope_id == current_scope_id else candidates.scope_id or None,
                )
                for candidates in experience_candidates
            )
        )[: self.experience_entry_limit]
        entries, omissions = self._fit_entries(request, memory_entries, topic_memory_entries, experience_entries)
        if not entries:
            return None, (), omissions
        return _render(entries), tuple(entry.origin for entry in entries), omissions

    def _select_text(
        self,
        request: PrepareContextRequest,
        *,
        current_scope_id: str | None,
        memory_candidates: Sequence[PreparedMemoryCandidates],
        experience_candidates: Sequence[PreparedExperienceCandidates],
        profile_candidates: Sequence[PreparedProfileCandidate],
        topic_memory_hits: Sequence[TopicMemorySearchHit],
    ) -> tuple[str | None, tuple[PreparedContextOrigin, ...], PreparedContextOmissions]:
        assembly = request.assembly
        if assembly is None:
            raise PreparedContextInvariantError("text-assembly-missing")
        included: list[ContextTextItem] = []
        origins: list[PreparedContextOrigin] = []
        truncated_items = 0
        dropped_below_min_bytes = 0
        dropped_no_fitting_truncation = 0
        for section in assembly.sections:
            # Unfilled earlier sections leave their capacity available to later ones.
            limit = (
                section.limit
                if self._text_entry_limit is None
                else min(section.limit, self._text_entry_limit - len(included))
            )
            if section.family == "profile":
                entries = self._profile_entries(profile_candidates)
            elif section.family == "topic-memory":
                entries = self._topic_memory_entries(topic_memory_hits, scope_id=current_scope_id)
            else:
                groups = (
                    tuple(
                        tuple(
                            self._memory_entries(group.memory_ref, (hit,), scope_id=group.scope_id)
                            for hit in group.hits
                        )
                        for group in memory_candidates
                    )
                    if section.family == "memory"
                    else tuple(
                        tuple(self._experience_entries((hit,), scope_id=group.scope_id) for hit in group.hits)
                        for group in experience_candidates
                    )
                )
                entries = tuple(chain.from_iterable(_interleave_groups(groups)))
            seen: set[tuple[str, str, str, int, str | None, str | None]] = set()
            rank = 0
            selected_count = 0
            for entry in entries:
                if selected_count >= limit:
                    break
                item = _text_item(entry)
                artifact = item.artifact
                identity = (
                    artifact.scope_id,
                    artifact.artifact.family,
                    artifact.artifact.artifact_id,
                    artifact.artifact.revision,
                    item.entry_id,
                    item.entry_version_id,
                )
                if identity in seen or not item.content.strip():
                    continue
                seen.add(identity)
                rank += 1
                outcome = fit_context_text_item(included, replace(item, recall_rank=rank), assembly, request.max_bytes)
                if outcome.item is None:
                    dropped_below_min_bytes += int(outcome.dropped_below_min_bytes)
                    dropped_no_fitting_truncation += int(outcome.dropped_no_fitting_truncation)
                    continue
                fitted = outcome.item
                included.append(fitted)
                origins.append(entry.origin)
                selected_count += 1
                truncated_items += int(fitted.truncated)
        omissions = PreparedContextOmissions(
            truncated_items=truncated_items,
            dropped_items=dropped_below_min_bytes + dropped_no_fitting_truncation,
            dropped_below_min_bytes=dropped_below_min_bytes,
            dropped_no_fitting_truncation=dropped_no_fitting_truncation,
        )
        if not included:
            return None, (), omissions
        content = render_context_text(included, assembly)
        return content, tuple(origins), omissions

    def _profile_entries(self, candidates: Sequence[PreparedProfileCandidate]) -> tuple[_PreparedContextEntry, ...]:
        entries = []
        for candidate in candidates:
            origin = ArtifactAddress(scope_id=candidate.scope_id, artifact=candidate.profile.as_ref())
            entries.append(
                _PreparedContextEntry(
                    origin=origin,
                    kind="profile",
                    citation={"artifact": origin.model_dump(mode="json")},
                    content=candidate.profile.content.content,
                    truncated=False,
                )
            )
        return tuple(entries)

    def _memory_entries(
        self,
        memory_ref: ArtifactRef | None,
        hits: Sequence[MemoryHit],
        *,
        scope_id: str | None = None,
    ) -> tuple[_PreparedContextEntry, ...]:
        if hits and memory_ref is None:
            raise PreparedContextInvariantError("memory-ref-missing")
        memory_entries: list[_PreparedContextEntry] = []
        seen: set[tuple[str, str]] = set()
        for hit in hits:
            if hit.memory_ref != memory_ref:
                raise PreparedContextInvariantError("memory-ref-mismatch")

            citation_key = (hit.entry_id, hit.entry_version_id)
            if citation_key in seen:
                continue
            seen.add(citation_key)
            if not hit.entry_id.strip() or not hit.entry_version_id.strip() or not hit.text.strip():
                continue
            citation = MemoryCitation(
                memory_ref=hit.memory_ref,
                entry_id=hit.entry_id,
                entry_version_id=hit.entry_version_id,
            )
            origin: PreparedContextOrigin = citation
            rendered_citation = citation.model_dump(mode="json")
            if scope_id is not None:
                memory = ArtifactAddress(scope_id=scope_id, artifact=hit.memory_ref)
                origin = MemoryEntryAddress(
                    memory=memory,
                    entry_id=hit.entry_id,
                    entry_version_id=hit.entry_version_id,
                )
                rendered_citation = {
                    "memory": memory.model_dump(mode="json"),
                    "entry_id": hit.entry_id,
                    "entry_version_id": hit.entry_version_id,
                }
            memory_entries.append(
                _PreparedContextEntry(
                    origin=origin,
                    kind="memory",
                    citation=rendered_citation,
                    content=hit.text,
                    truncated=False,
                )
            )
        return tuple(memory_entries)

    def _topic_memory_entries(
        self,
        hits: Sequence[TopicMemorySearchHit],
        *,
        scope_id: str | None = None,
    ) -> tuple[_PreparedContextEntry, ...]:
        topic_entries: list[_PreparedContextEntry] = []
        seen_topics: set[tuple[str, int]] = set()
        for hit in hits:
            if hit.artifact_ref.family != TopicMemory.family:
                raise PreparedContextInvariantError("topic-memory-family-mismatch")
            identity = (hit.artifact_ref.artifact_id, hit.artifact_ref.revision)
            if identity in seen_topics:
                continue
            seen_topics.add(identity)
            if len(topic_entries) >= self.topic_memory_entry_limit:
                break
            content = {"title": hit.title, "summary": hit.summary}
            if hit.snippet is not None:
                content["snippet"] = hit.snippet
            origin: PreparedContextOrigin = hit.artifact_ref
            citation = {"artifact_ref": hit.artifact_ref.model_dump(mode="json")}
            body = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
            if scope_id is not None:
                origin = ArtifactAddress(scope_id=scope_id, artifact=hit.artifact_ref)
                citation = {"artifact": origin.model_dump(mode="json")}
                body = "\n\n".join(f"{label.capitalize()}: {value}" for label, value in content.items())
            topic_entries.append(
                _PreparedContextEntry(
                    origin=origin,
                    kind="topic-memory",
                    citation=citation,
                    content=body,
                    truncated=False,
                )
            )
        return tuple(topic_entries)

    def _experience_entries(
        self,
        hits: Sequence[ExperienceSearchHit],
        *,
        scope_id: str | None = None,
    ) -> tuple[_PreparedContextEntry, ...]:
        experience_entries: list[_PreparedContextEntry] = []
        seen_experiences: set[tuple[str, int]] = set()
        for hit in hits:
            if hit.artifact_ref.family != Experience.family:
                raise PreparedContextInvariantError("experience-family-mismatch")
            identity = (hit.artifact_ref.artifact_id, hit.artifact_ref.revision)
            if identity in seen_experiences:
                continue
            seen_experiences.add(identity)
            origin: PreparedContextOrigin = hit.artifact_ref
            rendered_citation: dict[str, object] = {"artifact_ref": hit.artifact_ref.model_dump(mode="json")}
            if scope_id is not None:
                origin = ArtifactAddress(scope_id=scope_id, artifact=hit.artifact_ref)
                rendered_citation = {"artifact": origin.model_dump(mode="json")}
            experience_entries.append(
                _PreparedContextEntry(
                    origin=origin,
                    kind="experience",
                    citation=rendered_citation,
                    content=render_experience(hit.content),
                    truncated=False,
                )
            )
        return tuple(experience_entries)

    def _fit_entries(
        self,
        request: PrepareContextRequest,
        memory_entries: Sequence[_PreparedContextEntry],
        topic_memory_entries: Sequence[_PreparedContextEntry],
        experience_entries: Sequence[_PreparedContextEntry],
    ) -> tuple[tuple[_PreparedContextEntry, ...], PreparedContextOmissions]:
        entries: list[_PreparedContextEntry] = []
        truncated_items = 0
        dropped_below_min_bytes = 0
        dropped_no_fitting_truncation = 0
        for candidate in _interleave(memory_entries, topic_memory_entries, experience_entries):
            if len(entries) >= self.entry_limit:
                break
            fit = self._fit_entry(
                entries,
                origin=candidate.origin,
                kind=candidate.kind,
                citation=candidate.citation,
                text=candidate.content,
                max_bytes=request.max_bytes,
            )
            if fit.entry is None:
                dropped_below_min_bytes += int(fit.dropped_below_min_bytes)
                dropped_no_fitting_truncation += int(fit.dropped_no_fitting_truncation)
                continue
            entries.append(fit.entry)
            if fit.entry.truncated:
                truncated_items += 1
        return tuple(entries), PreparedContextOmissions(
            truncated_items=truncated_items,
            dropped_items=dropped_below_min_bytes + dropped_no_fitting_truncation,
            dropped_below_min_bytes=dropped_below_min_bytes,
            dropped_no_fitting_truncation=dropped_no_fitting_truncation,
        )

    def _fit_entry(
        self,
        entries: Sequence[_PreparedContextEntry],
        *,
        origin: PreparedContextOrigin,
        kind: str,
        citation: dict[str, object],
        text: str,
        max_bytes: int,
    ) -> _EntryFit:
        """Fit one entry into the remaining budget, reporting why it was dropped if it was.

        The two ``None`` paths of the original code are kept apart: ``below-min-bytes`` means a
        shorter rendering exists and fits but is too short to deliver honestly, while
        ``no-fitting-truncation`` means no shortened rendering fitted at all.
        """

        source_bytes = len(text.encode("utf-8"))
        entry_budget = min(source_bytes, self.max_entry_content_bytes)
        candidate = _PreparedContextEntry(
            origin=origin,
            kind=kind,
            citation=citation,
            content=text if source_bytes <= entry_budget else _truncate_utf8(text, entry_budget),
            truncated=source_bytes > entry_budget,
        )
        if _rendered_bytes((*entries, candidate)) <= max_bytes:
            return _EntryFit(entry=candidate)
        if source_bytes < _MIN_TRUNCATED_CONTENT_BYTES:
            return _EntryFit(dropped_below_min_bytes=True)

        lower = _MIN_TRUNCATED_CONTENT_BYTES
        upper = min(entry_budget, source_bytes - 1)
        best: _PreparedContextEntry | None = None
        while lower <= upper:
            byte_budget = (lower + upper) // 2
            candidate = _PreparedContextEntry(
                origin=origin,
                kind=kind,
                citation=citation,
                content=_truncate_utf8(text, byte_budget),
                truncated=True,
            )
            if len(candidate.content.encode("utf-8")) < _MIN_TRUNCATED_CONTENT_BYTES:
                lower = byte_budget + 1
                continue
            if _rendered_bytes((*entries, candidate)) <= max_bytes:
                best = candidate
                lower = byte_budget + 1
            else:
                upper = byte_budget - 1
        if best is None:
            return _EntryFit(dropped_no_fitting_truncation=True)
        return _EntryFit(entry=best)


def _interleave(
    memory: Sequence[_PreparedContextEntry],
    topics: Sequence[_PreparedContextEntry],
    experiences: Sequence[_PreparedContextEntry],
) -> tuple[_PreparedContextEntry, ...]:
    """Preserve each family's rank while alternating Memory, Topic, Experience."""

    ordered: list[_PreparedContextEntry] = []
    for index in range(max(len(memory), len(topics), len(experiences))):
        if index < len(memory):
            ordered.append(memory[index])
        if index < len(topics):
            ordered.append(topics[index])
        if index < len(experiences):
            ordered.append(experiences[index])
    return tuple(ordered)


def _interleave_groups(groups: Sequence[Sequence[_Item]]) -> tuple[_Item, ...]:
    ordered: list[_Item] = []
    for index in range(max((len(group) for group in groups), default=0)):
        ordered.extend(group[index] for group in groups if index < len(group))
    return tuple(ordered)


def _render(entries: Sequence[_PreparedContextEntry]) -> str:
    envelope = {
        "trust": "untrusted_history",
        "items": [_render_entry(entry) for entry in entries],
    }
    encoded = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    return "\n\n".join((TRUST_POLICY, f"{_BEGIN_MARKER}\n{encoded}\n{_END_MARKER}"))


def _text_item(entry: _PreparedContextEntry) -> ContextTextItem:
    origin = entry.origin
    if isinstance(origin, MemoryEntryAddress):
        return ContextTextItem(
            artifact=origin.memory,
            content=entry.content,
            recall_rank=0,
            entry_id=origin.entry_id,
            entry_version_id=origin.entry_version_id,
        )
    if isinstance(origin, ArtifactAddress):
        return ContextTextItem(artifact=origin, content=entry.content, recall_rank=0)
    raise PreparedContextInvariantError("text-scope-missing")


def _render_entry(entry: _PreparedContextEntry) -> dict[str, object]:
    rendered: dict[str, object] = {
        "citation": entry.citation,
        "content": entry.content,
        "truncated": entry.truncated,
    }
    if entry.kind != "memory":
        rendered["kind"] = entry.kind
    return rendered


def _rendered_bytes(entries: Sequence[_PreparedContextEntry]) -> int:
    return len(_render(entries).encode("utf-8"))


def _evidence_query_terms(query: str) -> tuple[Counter[str], tuple[tuple[str, str], ...], Counter[str] | None]:
    """Extract scoring terms from the query.

    Returns ``(stem_counts, bigrams, char_counts)``. Content tokens are reduced to short
    stems so inflections match (``inhibitors``/``inhibitor``), adjacent content-stem pairs
    are kept as phrase bigrams, and ``char_counts`` is non-``None`` only when the query has
    no ``[a-z]+|\\d+`` tokens at all (for example a purely CJK query), switching scoring to
    character overlap so selection still reflects the query.
    """

    tokens = _EVIDENCE_TOKEN_PATTERN.findall(query.lower())
    content = [token for token in tokens if token not in _EVIDENCE_STOPWORDS]
    if not content:
        char_counts = Counter(character for character in query.lower() if not character.isspace())
        return Counter(), (), char_counts or None
    stem_counts = Counter(_evidence_stem(token) for token in content)
    stems = [_evidence_stem(token) for token in tokens]
    is_content = [token not in _EVIDENCE_STOPWORDS for token in tokens]
    bigrams = tuple(
        dict.fromkeys(
            (stems[index], stems[index + 1])
            for index in range(len(tokens) - 1)
            if is_content[index] and is_content[index + 1]
        )
    )
    return stem_counts, bigrams, None


def _evidence_stem(token: str) -> str:
    """Reduce a lowercase token to a coarse stem key; digits stay exact."""

    if token.isdigit():
        return token
    return token[:5] if len(token) >= 5 else token


def _evidence_span_score(
    span_stems: Sequence[str],
    query_stems: Counter[str],
    query_bigrams: tuple[tuple[str, str], ...],
    idf: dict[str, float],
) -> float:
    counts = Counter(span_stems)
    score = sum(
        min(count, query_stems[stem]) * idf[stem] for stem, count in counts.items() if stem in query_stems
    )
    if query_bigrams and score > 0.0:
        adjacent = set(zip(span_stems, span_stems[1:], strict=False))
        score += sum(
            _EVIDENCE_BIGRAM_WEIGHT * (idf[first] + idf[second])
            for first, second in query_bigrams
            if (first, second) in adjacent
        )
    return score


def _evidence_gain(item: _EvidenceItem, remaining: Counter[str], idf: dict[str, float]) -> float:
    """Marginal value of adding ``item``: uncovered query stems first, raw score as tiebreak.

    ``remaining`` tracks how much of each query stem earlier picks already delivered, so a span
    repeating covered material earns (almost) nothing while a span introducing new query terms
    wins the round. Without query stems (character-fallback scoring) this degrades gracefully to
    plain best-score-first order.
    """

    gain = _EVIDENCE_SCORE_TIEBREAK * item.score
    if remaining:
        counts = Counter(item.stems)
        gain += sum(
            idf.get(stem, 0.0) * min(count, remaining[stem])
            for stem, count in counts.items()
            if remaining.get(stem, 0) > 0
        )
        if item.start == 0:
            gain *= _EVIDENCE_LEADING_SPAN_FACTOR
    return gain


def _evidence_char_score(span: str, char_counts: Counter[str]) -> float:
    lowered = span.lower()
    return sum(lowered.count(character) * weight for character, weight in char_counts.items())


def _evidence_sentence_spans(text: str) -> tuple[tuple[int, int], ...]:
    """Split entry text into literal sentence spans, absorbing trailing whitespace.

    Spans cover ``text`` exactly once, in order. A span longer than
    ``_MAX_EVIDENCE_SPAN_CHARS`` is further split at clause punctuation so that one huge
    run-on sentence cannot monopolize or overflow the byte budget.
    """

    sentences: list[tuple[int, int]] = []
    start = 0
    for match in _EVIDENCE_SENTENCE_END_PATTERN.finditer(text):
        end = match.end()
        while end < len(text) and text[end].isspace():
            end += 1
        if text[start:end].strip():
            sentences.append((start, end))
        start = end
    if start < len(text) and text[start:].strip():
        sentences.append((start, len(text)))

    spans: list[tuple[int, int]] = []
    for sentence_start, sentence_end in sentences:
        if sentence_end - sentence_start <= _MAX_EVIDENCE_SPAN_CHARS:
            spans.append((sentence_start, sentence_end))
            continue
        piece_start = sentence_start
        for match in _EVIDENCE_CLAUSE_END_PATTERN.finditer(text, sentence_start, sentence_end):
            piece_end = match.end()
            while piece_end < sentence_end and text[piece_end].isspace():
                piece_end += 1
            if piece_end - piece_start >= _MAX_EVIDENCE_SPAN_CHARS:
                if text[piece_start:piece_end].strip():
                    spans.append((piece_start, piece_end))
                piece_start = piece_end
        if piece_start < sentence_end and text[piece_start:sentence_end].strip():
            spans.append((piece_start, sentence_end))
    return tuple(spans)


def _sort_evidence_items(items: Sequence[_EvidenceItem]) -> tuple[_EvidenceItem, ...]:
    return tuple(sorted(items, key=lambda item: (item.group, item.hit, item.start)))


def _merge_evidence_items(items: Sequence[_EvidenceItem]) -> tuple[_EvidenceItem, ...]:
    """Merge selected spans of one entry that intersect or touch into single literal fragments."""

    merged: list[_EvidenceItem] = []
    for item in items:
        previous = merged[-1] if merged else None
        if (
            previous is not None
            and previous.address == item.address
            and item.start <= previous.end
            and previous.source == item.source
        ):
            end = max(previous.end, item.end)
            merged[-1] = _EvidenceItem(
                group=previous.group,
                hit=previous.hit,
                score=previous.score + item.score,
                address=previous.address,
                citation=previous.citation,
                start=previous.start,
                end=end,
                text=previous.source[previous.start : end],
                source=previous.source,
            )
        else:
            merged.append(item)
    return tuple(merged)


def _render_evidence(items: Sequence[_EvidenceItem]) -> str:
    envelope = {
        "trust": "untrusted_history",
        "items": [
            {
                "citation": item.citation,
                "content": item.text,
                "start": item.start,
                "end": item.end,
            }
            for item in items
        ],
    }
    encoded = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    return "\n\n".join((TRUST_POLICY, f"{_BEGIN_MARKER}\n{encoded}\n{_END_MARKER}"))


def _evidence_rendered_bytes(items: Sequence[_EvidenceItem]) -> int:
    return len(_render_evidence(items).encode("utf-8"))


def _truncate_utf8(text: str, byte_budget: int) -> str:
    prefix_budget = byte_budget - len(_ELLIPSIS.encode("utf-8"))
    encoded_prefix = text.encode("utf-8")[:prefix_budget]
    return f"{encoded_prefix.decode('utf-8', errors='ignore')}{_ELLIPSIS}"
