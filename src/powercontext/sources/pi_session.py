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

"""Pi session branch collection and evidence projection."""

from __future__ import annotations

import hashlib
import json
import urllib.parse
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from powercontext.limits import MAX_SOURCE_ID_LENGTH
from powercontext.sources import TEXT_EVIDENCE_PROJECTION_KEY, AdapterSourceDefinition, TextEvidence
from powercontext.sources.connectors import (
    Connector,
    ConnectorRunCompletion,
    ConnectorRunSession,
    ConnectorRunStatus,
    ConnectorSubmissionStatus,
)
from powercontext.sources.models import Source, SourceMaterialization

PI_EVENT_SOURCE_NAME = "pi-event"
PI_CONNECTOR_NAME = "pi-session-history"
PI_CONNECTOR_VERSION = "1"

# Control event types that don't generate text evidence but preserve graph connectivity
_CONTROL_EVENT_TYPES = frozenset({
    "model_change",
    "thinking_level_change",
})


class PiSessionInput(BaseModel):
    """Input for parsing a Pi session JSONL file."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    content: bytes
    leaf_id: str | None = None


class PiEventInput(BaseModel):
    """Input data for one Pi event Source."""

    session_id: str
    event_id: str
    parent_id: str | None
    event_type: str
    role: str
    content: str
    record: dict[str, JsonValue]


class PiEventSource(Source):
    """Captured Pi event with complete original record."""

    source_id: str
    session_id: str
    event_id: str
    parent_id: str | None
    event_type: str
    role: str
    content: str
    record: dict[str, JsonValue]


class PiEventSourceAdapter:
    """Resolve and read Pi event Sources."""

    input_class = PiEventInput
    name = PI_EVENT_SOURCE_NAME
    source_class = PiEventSource

    async def resolve(self, value: PiEventInput, /) -> PiEventSource:
        source_id = pi_event_source_id(value.session_id, value.event_id)
        return PiEventSource(
            name=source_id,
            source_id=source_id,
            materialization=SourceMaterialization.CAPTURED,
            session_id=value.session_id,
            event_id=value.event_id,
            parent_id=value.parent_id,
            event_type=value.event_type,
            role=value.role,
            content=value.content,
            record=value.record,
        )

    async def read(self, source: PiEventSource, /) -> PiEventInput:
        return PiEventInput(
            session_id=source.session_id,
            event_id=source.event_id,
            parent_id=source.parent_id,
            event_type=source.event_type,
            role=source.role,
            content=source.content,
            record=source.record,
        )


class PiEventTextEvidenceProjection:
    """Project Pi event as TextEvidence with structured metadata."""

    name = TEXT_EVIDENCE_PROJECTION_KEY.name
    version = TEXT_EVIDENCE_PROJECTION_KEY.version
    source_class = PiEventSource
    output_class: type[BaseModel] = TextEvidence

    def project(self, source: PiEventSource, /) -> TextEvidence:
        metadata: dict[str, JsonValue] = {
            "session_id": source.session_id,
            "event_id": source.event_id,
            "parent_id": source.parent_id,
            "event_type": source.event_type,
            "role": source.role,
        }
        return TextEvidence(
            source_type=PI_EVENT_SOURCE_NAME,
            source_id=source.source_id,
            content=source.content,
            metadata=metadata,
        )


def pi_event_source_id(session_id: str, event_id: str) -> str:
    """Build a stable source_id from session_id and event_id."""
    session_encoded = urllib.parse.quote(session_id, safe="")
    event_encoded = urllib.parse.quote(event_id, safe="")
    source_id = f"pi:{session_encoded}:{event_encoded}"
    if len(source_id) > MAX_SOURCE_ID_LENGTH:
        raise ValueError(f"source_id exceeds maximum length of {MAX_SOURCE_ID_LENGTH}")
    return source_id


def _format_content_block(block: dict[str, Any]) -> str | None:
    """Format a single content block into text, or None if not visible."""
    block_type = block.get("type")
    if block_type == "text":
        return block.get("text", "")
    elif block_type == "toolCall":
        name = block.get("name", "")
        call_id = block.get("id", "")
        arguments = block.get("arguments", {})
        compact_json = json.dumps(arguments, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return f"[tool_call {name} {call_id}] {compact_json}"
    elif block_type in ("thinking", "image"):
        return None  # Not visible in text evidence
    return None


def _format_message_content(role: str, message: dict[str, Any]) -> str | None:
    """Format a message event's content into the ROLE: BODY format."""
    content = message.get("content")
    if content is None:
        return None

    if isinstance(content, str):
        body = content
    elif isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                formatted = _format_content_block(block)
                if formatted is not None:
                    parts.append(formatted)
        if not parts:
            return None
        body = "\n".join(parts)
    else:
        return None

    return f"{role}: {body}"


def _format_event(record: dict[str, Any]) -> tuple[str, str, str] | None:
    """Format an event record into (event_type, role, content) or None if not visible."""
    event_type = record.get("type", "")

    if event_type == "message":
        message = record.get("message", {})
        role = message.get("role", "")

        if role == "toolResult":
            tool_name = message.get("toolName", "")
            tool_call_id = message.get("toolCallId", "")
            content_parts = message.get("content", [])
            text_parts = []
            for part in content_parts:
                if isinstance(part, dict) and part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
            text = "\n".join(text_parts)
            body = f"[tool_result {tool_name} {tool_call_id}] {text}"
            return (event_type, role, f"{role}: {body}")

        elif role == "bashExecution":
            command = message.get("command", "")
            output = message.get("output", "")
            body = f"$ {command}\n{output}"
            return (event_type, role, f"{role}: {body}")

        else:
            return _format_message_content(role, message) if message else None

    elif event_type == "compaction":
        summary = record.get("summary", "")
        return (event_type, event_type, f"{event_type}: {summary}")

    elif event_type == "branch_summary":
        summary = record.get("summary", "")
        return (event_type, event_type, f"{event_type}: {summary}")

    elif event_type == "custom_message":
        content = record.get("content", [])
        parts = []
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    formatted = _format_content_block(block)
                    if formatted is not None:
                        parts.append(formatted)
        elif isinstance(content, str):
            parts.append(content)
        if parts:
            body = "\n".join(parts)
            return (event_type, "custom", f"custom: {body}")
        return None

    elif event_type in _CONTROL_EVENT_TYPES:
        return None  # Control events don't generate text evidence

    return None


def _compute_event_fingerprint(record: dict[str, Any]) -> str:
    """Compute a fingerprint for an event record to detect mutations."""
    canonical = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_pi_session(input_session: PiSessionInput) -> tuple[PiEventInput, ...]:
    """Parse a Pi session JSONL file and return events on the selected branch.

    Args:
        input_session: PiSessionInput with content and optional leaf_id

    Returns:
        Tuple of PiEventInput instances for visible events on the branch

    Raises:
        ValueError: On encoding, format, or validation errors
    """
    content = input_session.content
    leaf_id = input_session.leaf_id

    # Decode UTF-8 with BOM support
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ValueError(f"Failed to decode UTF-8: {e}") from e

    # Parse JSONL
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        raise ValueError("Session file is empty")

    records: list[dict[str, Any]] = []
    for i, line in enumerate(lines):
        try:
            record = json.loads(line)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON on line {i + 1}: {e}") from e
        if not isinstance(record, dict):
            raise ValueError(f"Record on line {i + 1} is not a JSON object")
        records.append(record)

    # Validate session header
    header = records[0]
    if header.get("type") != "session":
        raise ValueError("First record must be a session header")
    if header.get("version") != 3:
        raise ValueError(f"Unsupported session version: {header.get('version')}")
    session_id = header.get("id")
    if not session_id or not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("Session header must have a non-empty id")

    # Build event map and validate
    event_records = records[1:]
    by_id: dict[str, dict[str, Any]] = {}
    for record in event_records:
        event_id = record.get("id")
        if not event_id or not isinstance(event_id, str):
            raise ValueError("Event record must have a non-empty string id")
        if event_id in by_id:
            raise ValueError(f"Duplicate event id: {event_id}")
        by_id[event_id] = record

    # Validate parent references and detect cycles
    for event_id, record in by_id.items():
        parent_id = record.get("parentId")
        if parent_id is not None:
            if not isinstance(parent_id, str):
                raise ValueError(f"Event {event_id} has non-string parentId")
            if parent_id not in by_id:
                raise ValueError(f"Event {event_id} references missing parent {parent_id}")

    # Detect cycles using DFS
    def detect_cycle(start_id: str) -> bool:
        visited: set[str] = set()
        current = start_id
        while current is not None:
            if current in visited:
                return True
            visited.add(current)
            current = by_id[current].get("parentId")
        return False

    for event_id in by_id:
        if detect_cycle(event_id):
            raise ValueError(f"Cycle detected involving event {event_id}")

    # Determine leaf node
    if leaf_id is not None:
        if leaf_id not in by_id:
            raise ValueError(f"Specified leaf {leaf_id} not found")
    else:
        # Default to last node
        if not event_records:
            raise ValueError("Session has no events")
        leaf_id = event_records[-1]["id"]

    # Build ancestor chain from leaf to root
    ancestor_ids: list[str] = []
    current_id: str | None = leaf_id
    while current_id is not None:
        ancestor_ids.append(current_id)
        current_id = by_id[current_id].get("parentId")
    ancestor_ids.reverse()  # Root to leaf order

    # Format visible events
    events: list[PiEventInput] = []
    for event_id in ancestor_ids:
        record = by_id[event_id]
        event_type = record.get("type", "")

        # Skip control events
        if event_type in _CONTROL_EVENT_TYPES:
            continue

        formatted = _format_event(record)
        if formatted is None:
            continue  # Skip events with no visible content

        _, role, content_text = formatted
        parent_id = record.get("parentId")

        events.append(
            PiEventInput(
                session_id=session_id,
                event_id=event_id,
                parent_id=parent_id,
                event_type=event_type,
                role=role,
                content=content_text,
                record=record,
            )
        )

    return tuple(events)


class PiSessionConnector:
    """Connector for incremental Pi session branch collection with checkpoint."""

    name = PI_CONNECTOR_NAME
    version = PI_CONNECTOR_VERSION
    source_definitions = frozenset({PI_EVENT_SOURCE_NAME})

    def __init__(self, path: Path | str, leaf_id: str | None = None) -> None:
        self._path = Path(path)
        self._leaf_id = leaf_id

    async def run(self, session: ConnectorRunSession, /) -> ConnectorRunCompletion:
        """Run the connector, submitting only new events since last checkpoint."""
        # Read and parse the session file
        try:
            content = self._path.read_bytes()
        except OSError as e:
            raise ValueError(f"Failed to read session file: {e}") from e

        try:
            events = parse_pi_session(PiSessionInput(content=content, leaf_id=self._leaf_id))
        except ValueError:
            raise  # Re-raise parsing errors

        # Load checkpoint
        checkpoint = session.checkpoint
        imported_ids: dict[str, str] = {}  # event_id -> fingerprint
        if isinstance(checkpoint, dict):
            imported_ids = checkpoint.get("imported", {})

        # Submit new events
        for event in events:
            fingerprint = _compute_event_fingerprint(event.record)

            # Check if already imported
            if event.event_id in imported_ids:
                # Verify fingerprint matches (detect mutations)
                if imported_ids[event.event_id] != fingerprint:
                    raise ValueError(
                        f"Event {event.event_id} has been modified since import"
                    )
                continue  # Skip already imported

            # Submit new event
            outcome = await session.submit(
                item_id=event.event_id,
                definition_name=PI_EVENT_SOURCE_NAME,
                value=event,
            )

            if outcome.status == ConnectorSubmissionStatus.ACCEPTED:
                imported_ids[event.event_id] = fingerprint

        # Build new checkpoint
        new_checkpoint: JsonValue = {"imported": imported_ids}

        return ConnectorRunCompletion(
            status=ConnectorRunStatus.COMPLETE,
            checkpoint=new_checkpoint,
        )


PI_EVENT_SOURCE_ADAPTER = PiEventSourceAdapter()
PI_EVENT_SOURCE_DEFINITION = AdapterSourceDefinition(
    PI_EVENT_SOURCE_ADAPTER,
    projections=(PiEventTextEvidenceProjection(),),
)


__all__ = [
    "PI_CONNECTOR_NAME",
    "PI_CONNECTOR_VERSION",
    "PI_EVENT_SOURCE_ADAPTER",
    "PI_EVENT_SOURCE_DEFINITION",
    "PI_EVENT_SOURCE_NAME",
    "PiEventInput",
    "PiEventSource",
    "PiEventSourceAdapter",
    "PiEventTextEvidenceProjection",
    "PiSessionConnector",
    "PiSessionInput",
    "parse_pi_session",
    "pi_event_source_id",
]
