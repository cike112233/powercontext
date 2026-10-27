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

"""CSV row-level Source collection and evidence projection."""

from __future__ import annotations

import csv
import io
import json
import urllib.parse
from typing import Annotated, Literal

from pydantic import BaseModel, Field, JsonValue, field_validator

from powercontext.limits import MAX_SOURCE_ID_LENGTH
from powercontext.sources.definitions import AdapterSourceDefinition
from powercontext.sources.models import Source, SourceMaterialization
from powercontext.sources.projections import TEXT_EVIDENCE_PROJECTION_KEY, TextEvidence

CSV_ROW_SOURCE_NAME = "csv-row"


class CSVDocumentInput(BaseModel):
    """Input for parsing a complete CSV document."""

    document_id: Annotated[str, Field(min_length=1)]
    primary_key: Annotated[str, Field(min_length=1)]
    content: bytes

    @field_validator("document_id")
    @classmethod
    def validate_document_id(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("document_id must not contain leading or trailing whitespace")
        return value

    @field_validator("primary_key")
    @classmethod
    def validate_primary_key(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("primary_key must not be blank")
        return value


class CSVRowInput(BaseModel):
    """Input data for one CSV row Source."""

    document_id: Annotated[str, Field(min_length=1)]
    primary_key: Annotated[str, Field(min_length=1)]
    primary_key_value: Annotated[str, Field(min_length=1)]
    columns: tuple[str, ...]
    values: tuple[str, ...]

    @field_validator("document_id")
    @classmethod
    def validate_document_id(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("document_id must not contain leading or trailing whitespace")
        return value

    @field_validator("columns", "values")
    @classmethod
    def validate_tuple_length(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(value) == 0:
            raise ValueError("columns and values must not be empty")
        return value

    @field_validator("primary_key")
    @classmethod
    def validate_primary_key(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("primary_key must not be blank")
        return value

    @field_validator("primary_key_value")
    @classmethod
    def validate_primary_key_value(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("primary_key_value must not be blank")
        return value


class CSVRowSource(Source):
    """Captured CSV row with original column order and values."""

    source_id: str
    document_id: str
    primary_key: str
    primary_key_value: str
    columns: tuple[str, ...]
    values: tuple[str, ...]


class CSVRowSourceAdapter:
    """Resolve and read CSV row Sources."""

    input_class = CSVRowInput
    name = CSV_ROW_SOURCE_NAME
    source_class = CSVRowSource

    async def resolve(self, value: CSVRowInput, /) -> CSVRowSource:
        source_id = csv_row_source_id(value.document_id, value.primary_key_value)
        return CSVRowSource(
            name=source_id,
            source_id=source_id,
            materialization=SourceMaterialization.CAPTURED,
            document_id=value.document_id,
            primary_key=value.primary_key,
            primary_key_value=value.primary_key_value,
            columns=value.columns,
            values=value.values,
        )

    async def read(self, source: CSVRowSource, /) -> CSVRowInput:
        return CSVRowInput(
            document_id=source.document_id,
            primary_key=source.primary_key,
            primary_key_value=source.primary_key_value,
            columns=source.columns,
            values=source.values,
        )


class CSVRowTextEvidenceProjection:
    """Project CSV row as TextEvidence with structured metadata."""

    name = TEXT_EVIDENCE_PROJECTION_KEY.name
    version = TEXT_EVIDENCE_PROJECTION_KEY.version
    source_class = CSVRowSource
    output_class: type[BaseModel] = TextEvidence

    def project(self, source: CSVRowSource, /) -> TextEvidence:
        row_object = {col: val for col, val in zip(source.columns, source.values, strict=True)}
        content = json.dumps(row_object, ensure_ascii=False, separators=(",", ":"))
        metadata: dict[str, JsonValue] = {
            "document_id": source.document_id,
            "primary_key": source.primary_key,
            "primary_key_value": source.primary_key_value,
            "columns": list(source.columns),
            "row": row_object,
        }
        return TextEvidence(
            source_type=CSV_ROW_SOURCE_NAME,
            source_id=source.source_id,
            content=content,
            metadata=metadata,
        )


def csv_row_source_id(document_id: str, primary_key_value: str) -> str:
    """Build a stable source_id from document_id and primary_key_value."""
    if document_id != document_id.strip():
        raise ValueError("document_id must not contain leading or trailing whitespace")
    doc_encoded = urllib.parse.quote(document_id, safe="")
    pk_encoded = urllib.parse.quote(primary_key_value, safe="")
    source_id = f"csv:{doc_encoded}:{pk_encoded}"
    if len(source_id) > MAX_SOURCE_ID_LENGTH:
        raise ValueError(f"source_id exceeds maximum length of {MAX_SOURCE_ID_LENGTH}")
    return source_id


def parse_csv_document(input_doc: CSVDocumentInput) -> tuple[CSVRowInput, ...]:
    """Parse CSV bytes into a tuple of CSVRowInput instances.
    
    Args:
        input_doc: CSVDocumentInput with document_id, primary_key, and content
        
    Returns:
        Tuple of CSVRowInput instances, one per data row
        
    Raises:
        ValueError: On encoding, format, or validation errors
    """
    document_id = input_doc.document_id
    primary_key = input_doc.primary_key
    content = input_doc.content
    
    # Decode UTF-8 with BOM support
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ValueError(f"Failed to decode UTF-8: {e}") from e
    
    # Parse CSV with strict quoting
    reader = csv.reader(io.StringIO(text), strict=True)
    
    # Read and validate header
    try:
        header = next(reader)
    except StopIteration:
        raise ValueError("CSV document is empty")
    except csv.Error as e:
        raise ValueError(f"CSV format error in header: {e}") from e
    
    if not header:
        raise ValueError("CSV header is empty")
    
    # Validate header fields
    for idx, field in enumerate(header):
        if not field.strip():
            raise ValueError(f"Header field at index {idx} is blank")
    
    # Check for duplicate header fields
    if len(header) != len(set(header)):
        raise ValueError("Header contains duplicate field names")
    
    # Validate primary_key exists in header
    if primary_key not in header:
        raise ValueError(f"Primary key '{primary_key}' not found in header")
    
    primary_key_idx = header.index(primary_key)
    
    # Parse data rows
    rows: list[CSVRowInput] = []
    seen_primary: set[str] = set()
    row_num = 1
    
    try:
        for row in reader:
            row_num += 1
            
            # Skip completely empty rows
            if not row or all(field == "" for field in row):
                continue
            
            # Validate row width
            if len(row) != len(header):
                raise ValueError(
                    f"Row {row_num} has {len(row)} fields, expected {len(header)}"
                )
            
            # Extract and validate primary key value
            pk_value = row[primary_key_idx]
            if not pk_value.strip():
                raise ValueError(f"Row {row_num} has blank primary key value")
            
            # Check primary key uniqueness
            if pk_value in seen_primary:
                raise ValueError(
                    f"Row {row_num} has duplicate primary key value: {pk_value}"
                )
            seen_primary.add(pk_value)
            
            # Build CSVRowInput
            rows.append(
                CSVRowInput(
                    document_id=document_id,
                    primary_key=primary_key,
                    primary_key_value=pk_value,
                    columns=tuple(header),
                    values=tuple(row),
                )
            )
    except csv.Error as e:
        raise ValueError(f"CSV format error at row {row_num}: {e}") from e
    
    return tuple(rows)


CSV_ROW_SOURCE_ADAPTER = CSVRowSourceAdapter()
CSV_ROW_SOURCE_DEFINITION = AdapterSourceDefinition(
    CSV_ROW_SOURCE_ADAPTER,
    projections=(CSVRowTextEvidenceProjection(),),
)


__all__ = [
    "CSV_ROW_SOURCE_ADAPTER",
    "CSV_ROW_SOURCE_DEFINITION",
    "CSV_ROW_SOURCE_NAME",
    "CSVDocumentInput",
    "CSVRowInput",
    "CSVRowSource",
    "CSVRowSourceAdapter",
    "CSVRowTextEvidenceProjection",
    "csv_row_source_id",
    "parse_csv_document",
]
