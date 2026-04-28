"""Hardcoded Project templates. Modify in code; no DB or admin UI in S1.

`expected_fields` are field names used by S2/S3 to seed initial PromptVersion.
`recommended_processor` matches a key in app.engine.processors.factory.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProjectTemplate:
    key: str
    display_name: str
    description: str
    expected_fields: list[str]
    recommended_processor: str


BUILTIN_TEMPLATES: list[ProjectTemplate] = [
    ProjectTemplate(
        key="china_vat",
        display_name="🇨🇳 中国增值税发票",
        description="标准增值税专用发票/普通发票字段提取",
        expected_fields=[
            "invoice_number", "invoice_date", "buyer_name", "buyer_tax_id",
            "seller_name", "seller_tax_id", "total_amount", "tax_amount",
            "amount_in_words", "items",
        ],
        recommended_processor="gemini",
    ),
    ProjectTemplate(
        key="us_invoice",
        display_name="🇺🇸 US Standard Invoice",
        description="US-style invoice with vendor / customer / line items",
        expected_fields=[
            "invoice_number", "invoice_date", "due_date", "vendor_name",
            "customer_name", "subtotal", "tax", "total", "currency", "items",
        ],
        recommended_processor="gemini",
    ),
    ProjectTemplate(
        key="japan_receipt",
        display_name="🇯🇵 日本領収書",
        description="日本式领収書（小票）字段提取",
        expected_fields=[
            "doc_type", "merchant_name", "issue_date", "total_amount",
            "tax_amount", "currency",
        ],
        recommended_processor="gemini",
    ),
    ProjectTemplate(
        key="de_rechnung",
        display_name="🇩🇪 Deutsche Rechnung",
        description="德式发票字段提取（含 USt-IdNr.）",
        expected_fields=[
            "rechnungsnummer", "rechnungsdatum", "kunde_name", "ust_id",
            "nettobetrag", "umsatzsteuer", "gesamtbetrag", "items",
        ],
        recommended_processor="gemini",
    ),
    ProjectTemplate(
        key="custom",
        display_name="✨ 自定义",
        description="空模板，字段在工作台中由用户定义",
        expected_fields=[],
        recommended_processor="gemini",
    ),
]


def get_template(key: str) -> ProjectTemplate | None:
    return next((t for t in BUILTIN_TEMPLATES if t.key == key), None)


VALID_TEMPLATE_KEYS: frozenset[str] = frozenset(t.key for t in BUILTIN_TEMPLATES)
