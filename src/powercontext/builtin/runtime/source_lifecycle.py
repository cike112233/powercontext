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

"""Propagation of Source withdrawal and restore across Memory and Topic Memory.

Callers register one evidence DAG per Scope: captured Sources as roots and
already written Memory entries or Topic Memory artifacts as derived nodes with
an explicit ``all``/``any`` support policy. Lifecycle events then flip a Source
between available and withdrawn; availability is recomputed over the whole graph
and mirrored into the native Memory entry state and Topic Memory visibility so
search and Context stop using unsupported content while historical citations and
artifact revisions stay readable for audit.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from powercontext.artifacts import ArtifactRef, MemoryCitation
from powercontext.builtin.persistence.tables import SOURCE_LIFECYCLE_NODES_TABLE
from powercontext.builtin.runtime.models import GetMemoryEntryRequest
from powercontext.builtin.sources import validate_scope_id
from powercontext.sources.models import SourceRef

if TYPE_CHECKING:
    from powercontext.builtin.runtime.application import BuiltinRuntime

_SOURCE_KIND = "source"
_MEMORY_KIND = "memory"
_TOPIC_KIND = "topic"
_POLICIES = ("all", "any")
_PURPOSES = ("generation", "audit")


class SourceLifecycleError(ValueError):
    """Raised for invalid lifecycle registrations, events, or resolutions."""


class SourceLifecycleEvent(BaseModel):
    """One validated Source availability transition."""

    model_config = ConfigDict(extra="forbid")

    node_id: str
    reason: str
    revision: StrictInt = Field(ge=1)
    sequence: StrictInt = Field(ge=1)
    available: StrictBool

    @field_validator("node_id", "reason")
    @classmethod
    def validate_non_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must be a non-empty string without only whitespace")  # noqa: TRY003
        return value


@dataclass(frozen=True)
class StoredLifecycleNode:
    """One registered graph node and its persisted lifecycle counters."""

    scope_id: str
    node_id: str
    ordinal: int
    kind: str
    policy: str | None
    parents: tuple[str, ...]
    reference: str
    artifact_id: str | None
    available: bool
    revision: int
    last_sequence: int
    last_event: str | None


class SourceLifecycleRepository:
    """Persist lifecycle graphs using caller-owned transactions."""

    async def nodes(self, connection: AsyncConnection, scope_id: str, /) -> tuple[StoredLifecycleNode, ...]:
        table = SOURCE_LIFECYCLE_NODES_TABLE
        rows = (
            await connection.execute(select(table).where(table.c.scope_id == scope_id).order_by(table.c.ordinal))
        ).mappings()
        return tuple(_stored_node(scope_id, row) for row in rows)

    async def node(self, connection: AsyncConnection, scope_id: str, node_id: str, /) -> StoredLifecycleNode | None:
        table = SOURCE_LIFECYCLE_NODES_TABLE
        row = (
            await connection.execute(
                select(table).where(table.c.scope_id == scope_id, table.c.node_id == node_id)
            )
        ).mappings().one_or_none()
        return None if row is None else _stored_node(scope_id, row)

    async def insert(self, connection: AsyncConnection, node: StoredLifecycleNode, /) -> None:
        await connection.execute(
            insert(SOURCE_LIFECYCLE_NODES_TABLE).values(
                scope_id=node.scope_id,
                node_id=node.node_id,
                ordinal=node.ordinal,
                kind=node.kind,
                policy=node.policy,
                parents=json.dumps(list(node.parents)),
                reference=node.reference,
                artifact_id=node.artifact_id,
                available=node.available,
                revision=node.revision,
                last_sequence=node.last_sequence,
                last_event=node.last_event,
            )
        )

    async def set_available(
        self, connection: AsyncConnection, scope_id: str, node_id: str, available: bool, /
    ) -> None:
        table = SOURCE_LIFECYCLE_NODES_TABLE
        await connection.execute(
            update(table)
            .where(table.c.scope_id == scope_id, table.c.node_id == node_id)
            .values(available=available)
        )

    async def record_event(
        self,
        connection: AsyncConnection,
        scope_id: str,
        node_id: str,
        available: bool,
        sequence: int,
        event: str,
        /,
    ) -> None:
        table = SOURCE_LIFECYCLE_NODES_TABLE
        await connection.execute(
            update(table)
            .where(table.c.scope_id == scope_id, table.c.node_id == node_id)
            .values(available=available, last_sequence=sequence, last_event=event)
        )

    async def hidden_topic_artifact_ids(self, connection: AsyncConnection, scope_id: str, /) -> frozenset[str]:
        table = SOURCE_LIFECYCLE_NODES_TABLE
        rows = await connection.scalars(
            select(table.c.artifact_id).where(
                table.c.scope_id == scope_id,
                table.c.kind == _TOPIC_KIND,
                table.c.available.is_(False),
                table.c.artifact_id.is_not(None),
            )
        )
        return frozenset(str(row) for row in rows)


class LifecycleApplication:
    """Scope factory for the Source lifecycle service."""

    def __init__(self, runtime: BuiltinRuntime) -> None:
        self._runtime = runtime

    def for_scope(self, scope_id: str, /) -> ScopedLifecycleApplication:
        return ScopedLifecycleApplication(self._runtime, scope_id)


class ScopedLifecycleApplication:
    """Register one evidence DAG and propagate Source availability events."""

    def __init__(self, runtime: BuiltinRuntime, scope_id: str) -> None:
        self._runtime = runtime
        self.scope_id = validate_scope_id(scope_id)
        self._repository = runtime._source_lifecycle

    @property
    def _database(self):
        return self._runtime._provider.database

    async def register_source(self, node_id: str, source_ref: SourceRef, /, *, revision: int) -> None:
        _require_identifier("node_id", node_id)
        if type(revision) is not int or isinstance(revision, bool) or revision < 1:
            raise SourceLifecycleError("source revision must be a positive integer")  # noqa: TRY003
        try:
            await self._runtime.records.for_scope(self.scope_id).get_source(source_ref.source_type, source_ref.source_id)
        except Exception as error:
            raise SourceLifecycleError("source reference is not readable") from error
        await self._register(
            node_id,
            kind=_SOURCE_KIND,
            policy=None,
            parents=(),
            reference=source_ref.model_dump_json(),
            artifact_id=None,
            revision=revision,
        )

    async def register_memory(
        self,
        node_id: str,
        citation: MemoryCitation,
        /,
        *,
        parents: tuple[str, ...],
        policy: str,
    ) -> None:
        try:
            await self._runtime.memory.for_scope(self.scope_id).get(GetMemoryEntryRequest(citation=citation))
        except Exception as error:
            raise SourceLifecycleError("memory citation is not readable") from error
        await self._register(
            node_id,
            kind=_MEMORY_KIND,
            policy=policy,
            parents=parents,
            reference=citation.model_dump_json(),
            artifact_id=None,
            revision=0,
        )

    async def register_topic(
        self,
        node_id: str,
        artifact_ref: ArtifactRef,
        /,
        *,
        parents: tuple[str, ...],
        policy: str,
    ) -> None:
        try:
            await self._runtime.records.for_scope(self.scope_id).get_artifact_revision(
                artifact_ref.family, artifact_ref.artifact_id, artifact_ref.revision
            )
        except Exception as error:
            raise SourceLifecycleError("topic artifact reference is not readable") from error
        await self._register(
            node_id,
            kind=_TOPIC_KIND,
            policy=policy,
            parents=parents,
            reference=artifact_ref.model_dump_json(),
            artifact_id=artifact_ref.artifact_id,
            revision=0,
        )

    async def apply(self, event: SourceLifecycleEvent, /) -> list[str]:
        async with self._database.transaction() as connection:
            nodes = await self._repository.nodes(connection, self.scope_id)
        by_id = {node.node_id: node for node in nodes}
        source = by_id.get(event.node_id)
        if source is None or source.kind != _SOURCE_KIND:
            raise SourceLifecycleError("lifecycle events apply to registered Sources")  # noqa: TRY003
        if event.revision != source.revision:
            raise SourceLifecycleError("event revision does not match the registered lifecycle revision")  # noqa: TRY003
        payload = event.model_dump(mode="json")
        stored = json.dumps(payload, sort_keys=True)
        if event.sequence == source.last_sequence and source.last_event == stored:
            return sorted(node.node_id for node in nodes if node.available)
        if event.sequence <= source.last_sequence:
            raise SourceLifecycleError("event sequence must increase per Source")  # noqa: TRY003
        states = _compute_states(nodes, {event.node_id: event.available})
        changed = [node for node in nodes if node.kind != _SOURCE_KIND and states[node.node_id] != node.available]
        for node in changed:
            if node.kind == _MEMORY_KIND:
                await self._set_memory_state(node, states[node.node_id], reason=event.reason)
        for node in changed:
            async with self._database.transaction() as connection:
                await self._repository.set_available(connection, self.scope_id, node.node_id, states[node.node_id])
        async with self._database.transaction() as connection:
            await self._repository.record_event(
                connection, self.scope_id, source.node_id, event.available, event.sequence, stored
            )
        return sorted(node_id for node_id, available in states.items() if available)

    async def resolve(self, node_id: str, /, *, purpose: str) -> ArtifactRef | MemoryCitation | SourceRef:
        if purpose not in _PURPOSES:
            raise SourceLifecycleError("purpose must be generation or audit")  # noqa: TRY003
        async with self._database.transaction() as connection:
            node = await self._repository.node(connection, self.scope_id, node_id)
        if node is None:
            raise SourceLifecycleError("unknown lifecycle node")  # noqa: TRY003
        if purpose == "generation" and not node.available:
            raise SourceLifecycleError("node is not available for generation")  # noqa: TRY003
        return _parse_reference(node)

    async def _register(
        self,
        node_id: str,
        *,
        kind: str,
        policy: str | None,
        parents: tuple[str, ...],
        reference: str,
        artifact_id: str | None,
        revision: int,
    ) -> None:
        _require_identifier("node_id", node_id)
        if kind != _SOURCE_KIND:
            if policy not in _POLICIES:
                raise SourceLifecycleError("policy must be all or any")  # noqa: TRY003
            parents = tuple(parents)
            if not parents:
                raise SourceLifecycleError("derived nodes require at least one parent")  # noqa: TRY003
            if len(parents) != len(set(parents)):
                raise SourceLifecycleError("parents must not repeat")  # noqa: TRY003
            if node_id in parents:
                raise SourceLifecycleError("a node cannot support itself")  # noqa: TRY003
        else:
            parents = ()
        async with self._database.transaction() as connection:
            nodes = await self._repository.nodes(connection, self.scope_id)
            existing = next((node for node in nodes if node.node_id == node_id), None)
            if existing is not None:
                same = (
                    existing.kind == kind
                    and existing.reference == reference
                    and existing.parents == parents
                    and existing.policy == policy
                    and existing.revision == revision
                )
                if not same:
                    raise SourceLifecycleError("node identity already bound differently")  # noqa: TRY003
                return
            by_id = {node.node_id: node for node in nodes}
            if kind == _SOURCE_KIND:
                available = True
            else:
                for parent in parents:
                    if parent not in by_id:
                        raise SourceLifecycleError("parents must be registered first")  # noqa: TRY003
                if node_id in _ancestors(parents, by_id):
                    raise SourceLifecycleError("dependencies must stay acyclic")  # noqa: TRY003
                available = _support(parents, by_id, policy)
            ordinal = max((node.ordinal for node in nodes), default=0) + 1
            node = StoredLifecycleNode(
                scope_id=self.scope_id,
                node_id=node_id,
                ordinal=ordinal,
                kind=kind,
                policy=policy,
                parents=parents,
                reference=reference,
                artifact_id=artifact_id,
                available=available,
                revision=revision,
                last_sequence=0,
                last_event=None,
            )
            await self._repository.insert(connection, node)
        if kind == _MEMORY_KIND and not node.available:
            await self._set_memory_state(node, False, reason="source-lifecycle-registration")

    async def _set_memory_state(self, node: StoredLifecycleNode, available: bool, *, reason: str) -> None:
        citation = MemoryCitation.model_validate_json(node.reference)
        async with self._runtime._context(self.scope_id) as context, self._runtime._locked(self.scope_id):
            service = context.artifacts.memory
            current = await service.head(context.artifacts.memory_artifact_id)
            manifest = {item.entry_id: item for item in current.content.manifest.entries}
            item = manifest.get(citation.entry_id)
            if item is None:
                raise SourceLifecycleError("registered memory entry is missing from the current head")  # noqa: TRY003
            target = "active" if available else "inactive"
            if item.state == target:
                return
            entry = next(
                (candidate for candidate in await service.entries(current) if candidate.entry_id == citation.entry_id),
                None,
            )
            if entry is None:
                raise SourceLifecycleError("registered memory entry is missing from the current head")  # noqa: TRY003
            if available:
                await service.reactivate(current, entries=(entry,), reason=reason)
            else:
                await service.forget(current, entries=(entry,), reason=reason)


def _require_identifier(field: str, value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise SourceLifecycleError(f"{field} must be a non-empty string")  # noqa: TRY003


def _stored_node(scope_id: str, row: Any) -> StoredLifecycleNode:
    return StoredLifecycleNode(
        scope_id=scope_id,
        node_id=str(row["node_id"]),
        ordinal=int(row["ordinal"]),
        kind=str(row["kind"]),
        policy=None if row["policy"] is None else str(row["policy"]),
        parents=tuple(json.loads(row["parents"])),
        reference=str(row["reference"]),
        artifact_id=None if row["artifact_id"] is None else str(row["artifact_id"]),
        available=bool(row["available"]),
        revision=int(row["revision"]),
        last_sequence=int(row["last_sequence"]),
        last_event=None if row["last_event"] is None else str(row["last_event"]),
    )


def _support(parents: tuple[str, ...], by_id: dict[str, StoredLifecycleNode], policy: str | None) -> bool:
    support = [by_id[parent].available for parent in parents]
    return all(support) if policy == "all" else any(support)


def _ancestors(parents: tuple[str, ...], by_id: dict[str, StoredLifecycleNode]) -> set[str]:
    seen: set[str] = set()
    stack = list(parents)
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(by_id[current].parents)
    return seen


def _compute_states(
    nodes: tuple[StoredLifecycleNode, ...], overrides: dict[str, bool] | None = None
) -> dict[str, bool]:
    states: dict[str, bool] = {}
    for node in nodes:
        if node.kind == _SOURCE_KIND:
            states[node.node_id] = node.available if overrides is None or node.node_id not in overrides else overrides[node.node_id]
        else:
            states[node.node_id] = _support_from(node.parents, states, node.policy)
    return states


def _support_from(parents: tuple[str, ...], states: dict[str, bool], policy: str | None) -> bool:
    support = [states[parent] for parent in parents]
    return all(support) if policy == "all" else any(support)


def _parse_reference(node: StoredLifecycleNode) -> ArtifactRef | MemoryCitation | SourceRef:
    if node.kind == _SOURCE_KIND:
        return SourceRef.model_validate_json(node.reference)
    if node.kind == _MEMORY_KIND:
        return MemoryCitation.model_validate_json(node.reference)
    return ArtifactRef.model_validate_json(node.reference)


__all__ = [
    "LifecycleApplication",
    "ScopedLifecycleApplication",
    "SourceLifecycleError",
    "SourceLifecycleEvent",
    "SourceLifecycleRepository",
    "StoredLifecycleNode",
]
