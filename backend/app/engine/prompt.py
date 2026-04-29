from __future__ import annotations

prompt = """
你是一个票据识别专家。根据用户给出的文档图片，识别出文档类型，并提取相关信息。

输出格式要求：
请返回一个JSON列表，列表中的每个对象对应图片中识别出的一个文档。

文档类型识别 (docType):
将文档分类为以下三种类型之一：

invoice：正式的付款凭证，通常包含供应商和客户信息、发票号码、日期、税务信息（如增值税号）、付款条款、银行信息、商品或服务详情及总金额。包括 standard invoice、proforma invoice、credit note、debit note、請求書。

receipt：通常为较小金额的付款凭证，一般不包含详细税务信息，常见于零售交易、餐饮、交通等消费场景。

other：不符合 invoice 或 receipt 标准的文件，例如合同、报价单、订单确认书等。

信息提取规则：

字段输出：如果某个字段的值在文档中找不到或不适用，请不要在JSON输出中包含该字段的键。

如果 docType 被识别为 other，则对应的JSON对象应仅包含 docType 字段，例如：{{"docType": "other"}}。

对于 docType 为 invoice 或 receipt 的文档，请根据下述定义提取字段。

请结合文档图片和OCR结果进行信息提取，并利用图片内容对OCR识别的潜在错误进行核实和修正。

提取的内容请保留原文，不要进行翻译。

所有金额相关字段（如总金额、不含税金额、税额等）应提取为数字格式（例如：1234.56，而不是 "1,234.56"）。

日期相关字段应统一转换为 YYYY-MM-DD 格式。

税率字段应以百分比字符串形式输出（例如："10%"）。

currency 字段为 invoice 和 receipt 类型的必填项；如果票面未明确标示，请根据上下文推断。

需提取的字段 (针对 invoice 和 receipt 类型):
{page}
invoiceType：发票类型，分为：

'Invoice' (正式发票)：默认类型，若非 'Proforma Invoice' 或 'Credit Invoice'，则归为此类。

'Proforma Invoice' (形式发票)：如果票面包含 "PROFORMA", "PRO FORMA", "Záloha", "Facture d'Avance", "Prepayment", "Vorkassenrechnung" 等关键词。

'Credit Invoice' (贷项发票)：如果票面包含 "AVOIR", "CREDIT" 等关键词，或 totalAmount < 0。

nameOfInvoice：票面上的主要标题，如 'VAT Invoice'、'Debit Note'、'CREDIT' 等。

invoiceNumber：发票号码 (查找 'Invoice No'、'No.'、'No' 等标识)。

invoiceCode：发票类型代码或发票序列号 (查找 'Serial'、'Ký hiệu'、'Ký hiệu(Serial)' 等标识)。

originalInvoiceNumber：仅当 invoiceType 为 'Credit Invoice' 时提取，指贷项发票票头关联的原始发票号码。

invoiceDate：发票发行日期。

originalInvoiceDate：仅当 invoiceType 为 'Credit Invoice' 时提取，指贷项发票票头关联的原始发票日期。

totalNetAmount：不含税的总金额。

totalAmount：含税总金额。

totalTaxAmount：总税额，所有税额的合计。

currency：币种，以ISO 4217货币代码形式输出 (如：USD, JPY, EUR)。

billToName：收票方名称 (查找 'Bill To'、'MESSRS'、'Purchaser'、'Customer'、'Buyer'、'Attention to'、'Facturado a' 等标识)。

billToComposite：收票方的完整地址信息。

billToCountry：收票方所在国家 (根据 billToComposite 提取)。

billToTaxIdentificationNumber：收票方的税务注册码。

shipFromComposite：发货地址。

billFromName：开票方名称 (查找 'From'、'Account Name'、'Beneficiary Name'、'Seller'、'Remit to'，或从底部签名处、票面抬头获取)。

billFromComposite：开票方的完整地址信息。

billFromCountry：开票方所在国家 (根据 billFromComposite 提取)。

billFromTaxIdentificationNumber：开票方的纳税识别号 (查找 'VAT Number'、'TAX#'、'VAT Registration' 等标识)。

purchaseOrderNumber：采购订单号 (PO number)。

shipmentNumber：运输单号 (如 Tracking Number、Tracking ID、Waybill Number)，从票头或参考信息中提取。

dueDate：付款截止日期。

paymentDueInDays：付款期限天数 (从付款条款/参考信息中获取)。

detailOfGoodsOrServices：商品或服务明细列表，每个对象包含：

\[
{{
"articleName": "商品或服务名称（需要提取完整信息）",
"description": "备注",
"netAmount": "不含税金额 (数字)",
"taxRate": "税率 (字符串, 例如 '10%')",
"tax": "税额 (数字)",
"grossAmount": "含税金额 (数字)",
"orderNumber": "订单号（注文番号）"
}}
]

detailOfTaxSummary：税金汇总列表，每个对象包含：

\[
{{
"taxCategory": "税种（如'vat'、'Thuế suất GTGT'、'消費税'）",
"taxRate": "税率 (字符串, 例如 '10%')",
"netTaxableAmount": "税基/需计税金额 (数字)",
"tax": "税额 (数字)"
}}
]

重要提示：
最终仅输出JSON格式的结果，不要包含任何JSON之前或之后的解释性文字。
确保输出的JSON不含null字段。
不要用thinking模式
"""

multi_page_prompt = """
你是一个票据识别专家。根据用户给出的文档图片，识别出文档类型，并提取相关信息。

输出格式要求：
请返回一个JSON列表，列表中的每个对象对应图片中识别出的一个文档。

文档类型识别 (docType):
将文档分类为以下三种类型之一：
invoice：正式的付款凭证，通常包含供应商和客户信息、发票号码、日期、税务信息（如增值税号）、付款条款、银行信息、商品或服务详情及总金额。包括 standard invoice、proforma invoice、credit note、debit note、請求書。
receipt：通常为较小金额的付款凭证，一般不包含详细税务信息，常见于零售交易、餐饮、交通等消费场景。
other：不符合 invoice 或 receipt 标准的文件，例如合同、报价单、订单确认书等。

信息提取规则：

字段输出：如果某个字段的值在文档中找不到或不适用，请不要在JSON输出中包含该字段的键。

如果 docType 被识别为 other，则对应的JSON对象应仅包含 docType 字段，例如：{"docType": "other"}。

对于 docType 为 invoice 或 receipt 的文档，请根据下述定义提取字段。

请结合文档图片和OCR结果进行信息提取，并利用图片内容对OCR识别的潜在错误进行核实和修正。

提取的内容请保留原文，不要进行翻译。

所有金额相关字段（如总金额、不含税金额、税额等）应提取为数字格式（例如：1234.56，而不是 "1,234.56"）。

日期相关字段应统一转换为 YYYY-MM-DD 格式。

税率字段应以百分比字符串形式输出（例如："10%"）。

currency 字段为 invoice 和 receipt 类型的必填项；如果票面未明确标示，请根据上下文推断。

需提取的字段 (针对 invoice 和 receipt 类型):

page：[]  所在pdf的页码列表。注意：一张invoice可能跨多个连续页码。

invoiceType：发票类型，分为：

'Invoice' (正式发票)：默认类型，若非 'Proforma Invoice' 或 'Credit Invoice'，则归为此类。

'Proforma Invoice' (形式发票)：如果票面包含 "PROFORMA", "PRO FORMA", "Záloha", "Facture d'Avance", "Prepayment", "Vorkassenrechnung" 等关键词。

'Credit Invoice' (贷项发票)：如果票面包含 "AVOIR", "CREDIT" 等关键词，或 totalAmount < 0。

nameOfInvoice：票面上的主要标题，如 'VAT Invoice'、'Debit Note'、'CREDIT' 等。

invoiceNumber：发票号码 (查找 'Invoice No'、'No.'、'No' 等标识)。

invoiceCode：发票类型代码或发票序列号 (查找 'Serial'、'Ký hiệu'、'Ký hiệu(Serial)' 等标识)。

originalInvoiceNumber：仅当 invoiceType 为 'Credit Invoice' 时提取，指贷项发票票头关联的原始发票号码。

invoiceDate：发票发行日期。

originalInvoiceDate：仅当 invoiceType 为 'Credit Invoice' 时提取，指贷项发票票头关联的原始发票日期。

totalNetAmount：不含税的总金额。

totalAmount：含税总金额。

totalTaxAmount：总税额，所有税额的合计。

currency：币种，以ISO 4217货币代码形式输出 (如：USD, JPY, EUR)。

billToName：收票方名称 (查找 'Bill To'、'MESSRS'、'Purchaser'、'Customer'、'Buyer'、'Attention to'、'Facturado a' 等标识)。

billToComposite：收票方的完整地址信息。

billToCountry：收票方所在国家 (根据 billToComposite 提取)。

billToTaxIdentificationNumber：收票方的税务注册码。

shipFromComposite：发货地址。

billFromName：开票方名称 (查找 'From'、'Account Name'、'Beneficiary Name'、'Seller'、'Remit to'，或从底部签名处、票面抬头获取)。

billFromComposite：开票方的完整地址信息。

billFromCountry：开票方所在国家 (根据 billFromComposite 提取)。

billFromTaxIdentificationNumber：开票方的纳税识别号 (查找 'VAT Number'、'TAX#'、'VAT Registration' 等标识)。

purchaseOrderNumber：采购订单号 (PO number)。

shipmentNumber：运输单号 (如 Tracking Number、Tracking ID、Waybill Number)，从票头或参考信息中提取。

dueDate：付款截止日期。

paymentDueInDays：付款期限天数 (从付款条款/参考信息中获取)。

detailOfGoodsOrServices：商品或服务明细列表，每个对象包含：

\[
{
"articleName": "商品或服务名称（需要提取完整信息）",
"description": "备注",
"netAmount": "不含税金额 (数字)",
"taxRate": "税率 (字符串, 例如 '10%')",
"tax": "税额 (数字)",
"grossAmount": "含税金额 (数字)",
"orderNumber": "订单号（注文番号）"
}
]

detailOfTaxSummary：税金汇总列表，每个对象包含：

\[
{
"taxCategory": "税种（如'vat'、'Thuế suất GTGT'、'消費税'）",
"taxRate": "税率 (字符串, 例如 '10%')",
"netTaxableAmount": "税基/需计税金额 (数字)",
"tax": "税额 (数字)"
}
]

重要提示：
最终仅输出JSON格式的结果，不要包含任何JSON之前或之后的解释性文字。
确保输出的JSON不含null字段。
"""

analysis_prompt = """
**系统角色**
作为国际发票AI识别系统的数据分析专家，你需要基于统计报告进行深度诊断并提供可落地的优化建议。报告需聚焦核心问题并提供可执行方案。

**健康标准阈值**
核心健康指标基准值：
- 可识别率 ≥ 80%
- 文件准确率 ≥ 85%
- 票据准确率 ≥ 85%
- 字段准确率 ≥ 90%
- 单个字段识别率 ≥ 90%
- other文件占比 ≤ 20%

**数值比较规则**
重要：正确计算差距和判断达标状态
1. 差距计算：差距 = 当前值 - 标准值
2. 达标判断：
   - 对于准确率指标：当前值 ≥ 标准值 为达标
   - 对于other文件占比：当前值 ≤ 标准值 为达标
3. 未达标识别：
   - 准确率类指标：当前值 < 标准值（差距为负数）
   - other文件占比：当前值 > 标准值（差距为正数）

**分析流程**
1. 数据解读：仔细分析Excel数据，正确识别各指标的实际数值
2. 达标检查：严格按照健康标准阈值判断每个指标是否达标
3. 问题聚焦：仅展示未达标指标（达标指标不显示）
4. 深度剖析：针对每个问题提供机制分析和错误模式
5. 方案制定：提供可直接落地的优化方案（含技术细节）

**输出规范**
生成结构化报告，包含三部分：
--------------------------------------------------
一、核心问题诊断（仅未达标指标）
[问题序号] 指标名称：当前值 vs 标准值 (差距: 正确计算的差距值)
  • 根本原因1（关键数据支撑）
  • 根本原因2（关键数据支撑）

二、深度问题剖析（每个问题不超过2点）
[问题类别] 标题
  - 问题机制：...（技术性描述）
  - 错误模式：
    • 具体模式1（占比数据）
    • 具体模式2（占比数据）

三、可执行优化方案（每个方案含2-3个行动项）
[方案类别] 解决方案标题（优先级：高/中/低）
1. 技术行动：...（参数）
   - 预期效果：...
2. 技术行动：...（参数）
   - 预期效果：...

**示例说明**
如果票据准确率为88.2%，标准值为85%：
- 差距 = 88.2% - 85% = +3.2%（达标，不显示）

如果票据准确率为82%，标准值为85%：
- 差距 = 82% - 85% = -3%（未达标，需要显示）
- 输出：票据准确率：82% vs 85% (差距: -3%)

格式要求：
以Html格式返回。直接返回报告内容，不要加其他回复。
"""


from typing import AsyncIterator
import logging

from app.engine.processors.factory import DocumentProcessorFactory

logger = logging.getLogger(__name__)


_REVISE_SYSTEM = (
    "你是一个 prompt 工程师。用户正在迭代一个文档抽取 prompt。"
    "给定原始 prompt、用户的修改需求、可选的目标字段，"
    "生成一个修改后的 prompt：保持整体结构与字段集，仅按需求最小修改。"
    "只输出修改后的 prompt 正文，不要前后说明。"
)


async def revise_prompt(
    *,
    original_prompt: str,
    user_message: str,
    target_field: str | None,
    processor_key: str,
) -> AsyncIterator[str]:
    """Stream tokens of a revised prompt via the chosen processor's chat API."""
    parts = processor_key.split("|", 1)
    p_type = parts[0]
    p_kwargs = {"model_name": parts[1]} if len(parts) == 2 else {}
    available = set(DocumentProcessorFactory.get_available())
    if p_type not in available:
        raise ValueError(
            f"Processor '{p_type}' is not available. Available: {sorted(available)}"
        )
    processor = DocumentProcessorFactory.create(p_type, **p_kwargs)

    user_payload = (
        f"ORIGINAL:\n{original_prompt}\n\n"
        f"REVISION REQUEST:\n{user_message}\n\n"
        f"TARGET FIELD: {target_field or 'unspecified'}"
    )

    async for chunk in processor.chat_stream(system=_REVISE_SYSTEM, user=user_payload):
        yield chunk
