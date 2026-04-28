import json
import re
import os
from typing import List, Dict, Any, Optional


def extract_json(text) -> List[str]:
    """Extracts JSON content from a string where JSON is embedded between ```json and ``` tags.

    Parameters:
        text (str): The text containing the JSON content.

    Returns:
        list: A list of extracted JSON strings.
    """
    # Define the regular expression pattern to match JSON blocks
    pattern = r"\`\`\`json(.*?)\`\`\`"

    # Find all non-overlapping matches of the pattern in the string
    matches = re.findall(pattern, text, re.DOTALL)

    # Return the list of matched JSON strings, stripping any leading or trailing whitespace
    try:
        return [match.strip() for match in matches]
    except Exception:
        raise ValueError(f"Failed to parse: {text}")


def get_mock_invoice_data() -> str:
    """Return mock invoice data, preferring mock.json; falls back to hardcoded default.

    Returns:
        str: Mock invoice JSON data string (no artificial sleep).
    """
    mock_file_path = os.path.join(os.path.dirname(__file__), 'mock.json')
    default_data = """
    [{
        "docType": "invoice",
        "nameOfInvoice": "御請求書",
        "invoiceNumber": "20393",
        "invoiceDate": "2025-05-02",
        "totalAmount": 23210935.00,
        "totalTaxAmount": 2110085.00,
        "currency": "JPY",
        "billToName": "TVS REGZA株式会社",
        "billFromName": "株式会社 ヒト・コミュニケーションズ",
        "lineItems": [
            {
                "description": "コールセンター業務委託料",
                "quantity": 1,
                "unitPrice": 21100850.00,
                "totalPrice": 21100850.00,
                "taxAmount": 2110085.00
            }
        ]
    }]
    """

    if os.path.exists(mock_file_path):
        try:
            with open(mock_file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                if content.strip():  # check content is not empty
                    # validate JSON but return as string
                    json.loads(content)
                    return content
        except (IOError, json.JSONDecodeError) as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Error reading or parsing mock.json: {e}. Falling back to default data.")

    return default_data


def should_use_mock_data() -> bool:
    """Check whether mock data should be used.

    Returns:
        bool: True if environment variable USE_MOCK_DATA is set to 'true', '1', or 'yes'.
    """
    mock_env = os.environ.get('USE_MOCK_DATA', '').lower()
    return mock_env in ('true', '1', 'yes')


def format_prompt_template(prompt: str, task_data: Optional[Dict[str, Any]] = None) -> str:
    """Format a prompt template by replacing {{key}} placeholders.

    Replaces {{key}} format placeholders in the prompt with corresponding
    values from task_data. Unresolved placeholders are left unchanged.

    Args:
        prompt: Prompt template containing placeholders.
        task_data: Dictionary of replacement values (usually from task['data']).

    Returns:
        str: Prompt text with placeholders replaced.

    Examples:
        >>> task_data = {"filename": "american", "type": "invoice"}
        >>> prompt = "Analyze {{filename}} of type {{type}}"
        >>> format_prompt_template(prompt, task_data)
        'Analyze american of type invoice'

        >>> # Missing keys are left unchanged
        >>> prompt = "Process {{filename}} and {{missing_key}}"
        >>> format_prompt_template(prompt, {"filename": "test"})
        'Process test and {{missing_key}}'
    """
    if not prompt or not task_data:
        return prompt

    placeholder_pattern = r'\{\{([^}]+)\}\}'

    def replace_placeholder(match):
        key = match.group(1).strip()

        if key in task_data:
            value = task_data[key]
            if isinstance(value, str):
                return value
            elif value is not None:
                return str(value)

        # Keep placeholder unchanged if key not found
        return match.group(0)

    return re.sub(placeholder_pattern, replace_placeholder, prompt)
