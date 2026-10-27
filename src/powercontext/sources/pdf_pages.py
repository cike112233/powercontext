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

"""PDF page-level Source collection and evidence retrieval."""

from __future__ import annotations

import hashlib
import urllib.parse
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

from powercontext.builtin.artifacts.memory.models import MemoryCitation
from powercontext.builtin.runtime import GetMemoryEntryRequest, SearchMemoryRequest
from powercontext.limits import MAX_SOURCE_ID_LENGTH
from powercontext.sources.definitions import AdapterSourceDefinition
from powercontext.sources.models import Source, SourceMaterialization
from powercontext.sources.projections import TEXT_EVIDENCE_PROJECTION_KEY, TextEvidence

PDF_PAGE_SOURCE_NAME = "pdf-page"


class PDFDocumentInput(BaseModel):
    """Input for parsing a complete PDF document."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    document_id: Annotated[str, Field(min_length=1)]
    content: bytes

    @field_validator("document_id")
    @classmethod
    def validate_document_id(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("document_id must not be empty or whitespace-only")
        return value


class PDFPageInput(BaseModel):
    """Input data for one PDF page Source."""

    document_id: str
    document_sha256: str
    page_number: int
    text: str

    @field_validator("document_id")
    @classmethod
    def validate_document_id(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("document_id must not be empty or whitespace-only")
        return value

    @field_validator("document_sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        if len(value) != 64:
            raise ValueError("document_sha256 must be 64 hex characters")
        try:
            int(value, 16)
        except ValueError:
            raise ValueError("document_sha256 must be hexadecimal")
        return value.lower()

    @field_validator("page_number")
    @classmethod
    def validate_page_number(cls, value: int) -> int:
        if value < 1:
            raise ValueError("page_number must be >= 1")
        return value


class PDFPageSource(Source):
    """Captured PDF page with original text and metadata."""

    source_id: str
    document_id: str
    document_sha256: str
    page_number: int
    text: str


class PDFPageSourceAdapter:
    """Resolve and read PDF page Sources."""

    input_class = PDFPageInput
    name = PDF_PAGE_SOURCE_NAME
    source_class = PDFPageSource

    async def resolve(self, value: PDFPageInput, /) -> PDFPageSource:
        source_id = pdf_page_source_id(value.document_id, value.document_sha256, value.page_number)
        return PDFPageSource(
            name=source_id,
            source_id=source_id,
            materialization=SourceMaterialization.CAPTURED,
            document_id=value.document_id,
            document_sha256=value.document_sha256,
            page_number=value.page_number,
            text=value.text,
        )

    async def read(self, source: PDFPageSource, /) -> PDFPageInput:
        return PDFPageInput(
            document_id=source.document_id,
            document_sha256=source.document_sha256,
            page_number=source.page_number,
            text=source.text,
        )


class PDFPageTextEvidenceProjection:
    """Project PDF page as TextEvidence with structured metadata."""

    name = TEXT_EVIDENCE_PROJECTION_KEY.name
    version = TEXT_EVIDENCE_PROJECTION_KEY.version
    source_class = PDFPageSource
    output_class: type[BaseModel] = TextEvidence

    def project(self, source: PDFPageSource, /) -> TextEvidence:
        content = f"{source.document_id}\n{source.text}"
        metadata: dict[str, JsonValue] = {
            "document_id": source.document_id,
            "document_sha256": source.document_sha256,
            "page_number": source.page_number,
        }
        return TextEvidence(
            source_type=PDF_PAGE_SOURCE_NAME,
            source_id=source.source_id,
            content=content,
            metadata=metadata,
        )


def pdf_page_source_id(document_id: str, document_sha256: str, page_number: int) -> str:
    """Build a stable source_id from document identity and page number."""
    doc_encoded = urllib.parse.quote(document_id, safe="")
    # Use first 16 chars of sha256 to keep ID under 256 chars
    sha_short = document_sha256[:16]
    source_id = f"pdf:{doc_encoded}:{sha_short}:{page_number}"
    if len(source_id) > MAX_SOURCE_ID_LENGTH:
        raise ValueError(f"source_id exceeds maximum length of {MAX_SOURCE_ID_LENGTH}")
    return source_id


def parse_pdf_document(input_doc: PDFDocumentInput) -> tuple[PDFPageInput, ...]:
    """Parse a PDF document into a tuple of PDFPageInput instances.

    Args:
        input_doc: PDFDocumentInput with document_id and content

    Returns:
        Tuple of PDFPageInput instances, one per physical page

    Raises:
        ValueError: On encoding, format, or validation errors
    """
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    document_id = input_doc.document_id
    content = input_doc.content

    # Validate content is not empty
    if not content:
        raise ValueError("PDF content is empty")

    # Compute SHA-256 of entire PDF
    document_sha256 = hashlib.sha256(content).hexdigest()

    # Parse PDF
    try:
        reader = PdfReader(stream=__import__("io").BytesIO(content))
    except PdfReadError as e:
        raise ValueError(f"Failed to parse PDF: {e}") from e
    except Exception as e:
        raise ValueError(f"Failed to read PDF: {e}") from e

    # Check if PDF is encrypted but has empty password (legal input)
    if reader.is_encrypted:
        try:
            # Try decrypting with empty password
            if not reader.decrypt(""):
                raise ValueError("PDF is encrypted and cannot be decrypted with empty password")
        except Exception as e:
            raise ValueError(f"Failed to decrypt PDF: {e}") from e

    # Extract text from all pages
    pages: list[PDFPageInput] = []
    try:
        for page_num, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception as e:
                raise ValueError(f"Failed to extract text from page {page_num}: {e}") from e

            pages.append(
                PDFPageInput(
                    document_id=document_id,
                    document_sha256=document_sha256,
                    page_number=page_num,
                    text=text,
                )
            )
    except Exception as e:
        raise ValueError(f"Failed to parse PDF pages: {e}") from e

    if not pages:
        raise ValueError("PDF has no pages")

    return tuple(pages)


async def search_pdf_pages(memory: Any, question: str, limit: int = 10) -> tuple[MemoryCitation, ...]:
    """Search for PDF pages relevant to the given question.

    Args:
        memory: Scoped Memory instance
        question: Natural language question
        limit: Maximum number of citations to return

    Returns:
        Tuple of MemoryCitation instances for relevant pages
    """
    # Search using Memory API with higher limit to ensure we get enough distinct pages
    search_request = SearchMemoryRequest(query=question, mode="fts", limit=limit * 2)
    page = await memory.search(search_request)

    # Collect citations from search results
    citations: list[MemoryCitation] = []

    for hit in page.hits:
        if len(citations) >= limit:
            break

        citation = MemoryCitation(
            memory_ref=hit.memory_ref,
            entry_id=hit.entry_id,
            entry_version_id=hit.entry_version_id,
        )
        citations.append(citation)

    return tuple(citations)


PDF_PAGE_SOURCE_ADAPTER = PDFPageSourceAdapter()
PDF_PAGE_SOURCE_DEFINITION = AdapterSourceDefinition(
    PDF_PAGE_SOURCE_ADAPTER,
    projections=(PDFPageTextEvidenceProjection(),),
)


__all__ = [
    "PDF_PAGE_SOURCE_ADAPTER",
    "PDF_PAGE_SOURCE_DEFINITION",
    "PDF_PAGE_SOURCE_NAME",
    "PDFDocumentInput",
    "PDFPageInput",
    "PDFPageSource",
    "PDFPageSourceAdapter",
    "PDFPageTextEvidenceProjection",
    "parse_pdf_document",
    "pdf_page_source_id",
    "search_pdf_pages",
]
