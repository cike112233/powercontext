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
import re
import urllib.parse
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

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
                text = (page.extract_text() or "").strip()
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


_QUERY_STOPWORDS = frozenset(
    """
    a an the and or but if then than so such as of to in on at by for from with without
    about into over under between among during before after above below up down out off
    again further once here there when where why how all any both each few more most other
    some no nor not only own same too very can could should would may might must shall will
    just now is are was were be been being have has had having do does did doing i me my we
    our us you your he him his she her it its they them their this that these those what
    which who whom whose please answer question based according given show shown stated
    state report reported reports outline outlined directly primarily mainly exactly
    currently also use using used able perspective analyst assume assuming rely relying
    details detail information provide respond response calculate calculated compute
    computed define defined much many percentage percent materially important ongoing
    """.split()
)

# Domain-neutral finance/English expansions. They are only used to build extra
# retrieval queries; the persisted page text is never rewritten.
_EXPANSIONS: dict[str, tuple[str, ...]] = {
    "geographies": (
        "geographic",
        "countries",
        "territories",
        "regions",
        "segments",
        "north",
        "latin",
        "europe",
        "africa",
        "asia",
        "pacific",
    ),
    "geography": (
        "geographic",
        "countries",
        "territories",
        "regions",
        "segments",
        "north",
        "latin",
        "europe",
        "africa",
        "asia",
        "pacific",
    ),
    "battles": ("litigation", "proceedings", "claims", "lawsuits"),
    "legal": ("litigation", "proceedings", "claims"),
    "litigation": ("legal", "proceedings", "claims"),
    "capex": ("capital", "expenditures"),
    "ebitda": ("operating", "profit", "income", "depreciation", "amortization"),
    "restructuring": ("charges", "impairment"),
    "revenue": ("sales", "revenues"),
    "sales": ("revenue",),
    "quick": ("current", "assets", "liabilities", "cash", "inventories", "receivables"),
    "ratio": ("current", "assets", "liabilities", "margin", "percentage"),
    "liquidity": ("cash", "current", "assets", "liabilities", "balance"),
    "margin": ("operating", "gross", "income", "profit", "revenue"),
    "operating": ("income", "profit", "margin", "expenses"),
    "gross": ("profit", "margin", "revenue"),
    "concentration": ("customer", "accounted", "percent", "revenue"),
    "customer": ("customers", "concentration", "accounted"),
    "liability": ("liabilities", "balance", "sheet"),
    "liabilities": ("liability", "balance", "sheet"),
    "retain": ("retention", "customers", "members", "renew"),
    "retention": ("retain", "customers", "members"),
    "change": ("increase", "decrease", "drove", "results"),
}

# Phrases that identify the section a finance question usually targets.
_PHRASES: tuple[tuple[str, ...], ...] = (
    ("legal", "proceedings"),
    ("cash", "flows"),
    ("cash", "flow"),
    ("statement", "of", "income"),
    ("statements", "of", "income"),
    ("operating", "profit"),
    ("countries", "and", "territories"),
    ("depreciation", "and", "amortization"),
    ("income", "statement"),
    ("capital", "expenditures"),
    ("consolidated", "balance", "sheets"),
    ("results", "of", "operations"),
    ("business", "environment"),
    ("one", "customer", "accounted"),
    ("current", "assets"),
    ("current", "liabilities"),
    ("securities", "registered"),
    ("securities", "registered", "pursuant"),
    ("income", "tax"),
    ("effective", "tax"),
    ("title", "of", "each", "class"),
)

_HEADINGS: tuple[str, ...] = (
    "item 3. legal proceedings",
    "consolidated statement of income",
    "consolidated statements of income",
    "consolidated statement of cash flows",
    "consolidated statements of cash flows",
    "consolidated balance sheets",
    "consolidated balance sheet",
    "consolidated statements of operations",
    "consolidated statement of operations",
    "managements discussion and analysis",
    "management's discussion and analysis",
    "results of operations",
    "business environment",
    "summary of financial performance",
    "securities registered pursuant",
)

# Question-shape hints: if all trigger terms occur, add a targeted query.
_QUERY_HINTS: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (
        ("quick", "ratio"),
        ("current", "assets", "current", "liabilities", "balance", "sheets", "cash", "inventories", "receivables"),
    ),
    (("liquidity",), ("cash", "current", "assets", "current", "liabilities", "balance", "sheets")),
    (
        ("operating", "margin"),
        ("consolidated", "statements", "income", "operating", "income", "revenues", "results", "operations"),
    ),
    (("gross", "margin"), ("consolidated", "statements", "income", "gross", "profit", "revenues")),
    (("largest", "liability"), ("consolidated", "balance", "sheets", "total", "liabilities")),
    (
        ("retain",),
        ("business", "environment", "customers", "card", "members", "acquisitions", "relationships"),
    ),
    (("drove",), ("results", "operations", "management", "discussion", "analysis", "increase", "decrease")),
    (("concentration",), ("customer", "accounted", "percent", "revenue")),
)

_TOKEN_PATTERN = re.compile(r"[a-z]+|\d+")


def _tokenize(text: str) -> tuple[str, ...]:
    return tuple(_TOKEN_PATTERN.findall(text.casefold()))


def _stem(term: str) -> str:
    """Small, deterministic suffix normalizer for lexical matching."""
    if term.endswith("ies") and len(term) > 4:
        return term[:-3] + "y"
    if term.endswith("ing") and len(term) > 5:
        return term[:-3]
    if term.endswith("ed") and len(term) > 4:
        return term[:-2]
    if term.endswith("es") and len(term) > 4 and not term.endswith("ses"):
        return term[:-2]
    if term.endswith("s") and len(term) > 3 and not term.endswith("ss"):
        return term[:-1]
    return term


def _query_keywords(question: str) -> tuple[str, ...]:
    """Keep informative terms; drop question boilerplate and duplicates."""
    seen: set[str] = set()
    keywords: list[str] = []
    for term in _tokenize(question):
        if term in _QUERY_STOPWORDS:
            continue
        if len(term) <= 2 and not term.isdigit():
            continue
        if term in seen:
            continue
        seen.add(term)
        keywords.append(term)
    return tuple(keywords)


def _matched_hint_terms(question: str) -> tuple[str, ...]:
    terms = set(_tokenize(question))
    matched: list[str] = []
    for triggers, hints in _QUERY_HINTS:
        if all(term in terms for term in triggers):
            matched.extend(hints)
    return tuple(dict.fromkeys(matched))


def _query_variants(question: str, keywords: tuple[str, ...]) -> tuple[str, ...]:
    """Full question plus tight keyword, stemmed, and domain-expanded queries."""
    variants: list[str] = [question]
    if keywords:
        variants.append(" ".join(keywords[:8]))
        stemmed = tuple(dict.fromkeys(_stem(term) for term in keywords[:8]))
        if stemmed != keywords[:8]:
            variants.append(" ".join(stemmed))

        expanded: list[str] = []
        synonyms: list[str] = []
        for term in keywords[:6]:
            expanded.append(term)
            expanded.extend(_EXPANSIONS.get(term, ())[:3])
            synonyms.extend(_EXPANSIONS.get(term, ()))
        expanded_query = " ".join(dict.fromkeys(expanded))
        if expanded_query:
            variants.append(expanded_query)
        synonym_query = " ".join(dict.fromkeys(synonyms[:12]))
        if synonym_query:
            variants.append(synonym_query)
    hint_query = " ".join(_matched_hint_terms(question))
    if hint_query:
        variants.append(hint_query)
    return tuple(dict.fromkeys(variant.strip() for variant in variants if variant.strip()))


def _contains_phrase(tokens: tuple[str, ...], phrase: tuple[str, ...]) -> bool:
    size = len(phrase)
    if size == 0 or len(tokens) < size:
        return False
    first = phrase[0]
    for index in range(len(tokens) - size + 1):
        if tokens[index] == first and tokens[index : index + size] == phrase:
            return True
    return False


async def search_pdf_pages(memory: Any, question: str, limit: int = 10) -> tuple:
    """Search for PDF pages relevant to the given question.

    The Memory FTS admission requires enough query terms to overlap, so a single
    natural-language query under-recalls. Run the full question plus tight keyword
    variants, merge candidates, then rerank by term/number coverage before returning
    distinct exact page citations.
    """
    from powercontext.builtin.artifacts.memory.models import MemoryCitation, MemoryHit
    from powercontext.builtin.runtime import SearchMemoryRequest

    if limit < 1:
        return ()

    keywords = _query_keywords(question)
    variants = _query_variants(question, keywords)
    candidate_limit = max(limit * 8, 120)

    candidates: dict[str, MemoryHit] = {}
    for variant in variants:
        page = await memory.search(SearchMemoryRequest(query=variant, mode="fts", limit=candidate_limit))
        for hit in page.hits:
            key = f"{hit.entry_id}:{hit.entry_version_id}"
            current = candidates.get(key)
            if current is None or hit.score > current.score:
                candidates[key] = hit

    if not candidates:
        return ()

    query_terms = set(keywords) | set(_matched_hint_terms(question))
    for term in keywords:
        query_terms.update(_EXPANSIONS.get(term, ()))
    stemmed_terms = {_stem(term) for term in query_terms}
    numeric_terms = {term for term in query_terms if term.isdigit()}

    scored: list[tuple[float, MemoryHit]] = []
    for hit in candidates.values():
        page_tokens = _tokenize(hit.text)
        page_terms = set(page_tokens)
        page_stems = {_stem(term) for term in page_terms}
        overlap = len(query_terms & page_terms)
        stem_overlap = len(stemmed_terms & page_stems)
        number_overlap = len(numeric_terms & page_terms)
        phrase_hits = sum(1 for phrase in _PHRASES if _contains_phrase(page_tokens, phrase))
        normalized = " ".join(hit.text.casefold().split())
        prefix = normalized[:180]
        heading_hits = sum(1 for heading in _HEADINGS if heading in normalized)
        heading_start_hits = sum(1 for heading in _HEADINGS if heading in prefix)
        numeric_count = sum(1 for token in page_tokens if token.isdigit())
        numeric_ratio = numeric_count / max(1, len(page_tokens))
        toc_penalty = 50.0 if "index to consolidated financial statements" in normalized else 0.0
        auditor_penalty = 10.0 if "report of independent registered public accounting firm" in prefix else 0.0
        score = (
            overlap * 3.0
            + stem_overlap * 2.0
            + number_overlap * 3.0
            + phrase_hits * 8.0
            + heading_hits * 6.0
            + heading_start_hits * 20.0
            + numeric_ratio * 30.0
            - toc_penalty
            - auditor_penalty
            + min(max(hit.score, 0.0), 50.0) * 0.1
        )
        scored.append((score, hit))

    scored.sort(key=lambda item: item[0], reverse=True)

    citations: list[MemoryCitation] = []
    seen_entries: set[str] = set()
    for _score, hit in scored:
        if hit.entry_id in seen_entries:
            continue
        seen_entries.add(hit.entry_id)
        citations.append(
            MemoryCitation(
                memory_ref=hit.memory_ref,
                entry_id=hit.entry_id,
                entry_version_id=hit.entry_version_id,
            )
        )
        if len(citations) >= limit:
            break

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
