"""
OpenAI Document Processor for OpenAI models with Structured Outputs support
"""
from __future__ import annotations

import base64
import logging
import os
from typing import Any, Dict, Optional, Union

from openai import AsyncOpenAI

from app.engine.config.manager import config_manager
from app.engine.processors.base import DocumentProcessor

logger = logging.getLogger(__name__)


class OpenAIDocumentProcessor(DocumentProcessor):
    """OpenAI Document Processor with Structured Outputs support"""

    def __init__(self, model_name: str = "gpt-4o", **kwargs):
        """
        Initialize OpenAI processor

        Args:
            model_name: OpenAI model name (default: gpt-4o)
            **kwargs: Additional configuration
        """
        self.model_name = model_name
        self.client = None

        # YAML model.params 作为最低优先级基线（runtime_config 覆盖之）
        model_cfg = config_manager.get_model_config("openai", model_name)
        self._yaml_params: Dict[str, Any] = (
            dict(model_cfg.params) if model_cfg and model_cfg.params else {}
        )

        try:
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY environment variable is required")

            self.client = AsyncOpenAI(api_key=api_key)
            logger.info(f"OpenAI processor initialized with model: {model_name}")

        except Exception as e:
            logger.error(f"Failed to initialize OpenAI client: {e}")
            raise

    def get_model_version(self) -> str:
        """Get current model version"""
        return f"openai|{self.model_name}"

    async def chat_stream(self, *, system: str, user: str):
        """Stream LLM tokens via AsyncOpenAI."""
        if not self.client:
            raise RuntimeError("OpenAI client not initialized")
        stream = await self.client.chat.completions.create(
            model=self.model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            stream=True,
        )
        async for chunk in stream:
            try:
                delta = chunk.choices[0].delta.content
            except (IndexError, AttributeError):
                continue
            if delta:
                yield delta

    def _supports_temperature(self) -> bool:
        """
        Check if current model supports temperature parameter.

        GPT-5 series models do not support temperature parameter.
        """
        if "gpt-5" in self.model_name.lower():
            return False
        return True

    def _encode_image(self, image_path: str) -> str:
        """Encode image file to base64."""
        try:
            with open(image_path, "rb") as image_file:
                return base64.b64encode(image_file.read()).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to encode image {image_path}: {e}")
            raise

    def _is_image_file(self, filepath: str) -> bool:
        """Check if file is an image based on extension."""
        image_extensions = (".jpg", ".jpeg", ".png", ".bmp", ".gif")
        return filepath.lower().endswith(image_extensions)

    def _convert_gemini_schema_to_openai(self, schema: Dict) -> Dict:
        """
        Convert Gemini-style schema to OpenAI Structured Outputs compatible format.

        OpenAI Structured Outputs requirements:
        1. All properties must be in 'required' array
        2. Must set 'additionalProperties: false' on all objects
        3. Optional fields should use Union types with null
        4. Nested objects must follow same rules
        """
        def convert_schema_recursive(schema_obj):
            if not isinstance(schema_obj, dict):
                return schema_obj

            converted = {}

            for key, value in schema_obj.items():
                if key == "type":
                    converted[key] = value
                elif key == "properties":
                    converted_props = {}
                    for prop_key, prop_value in value.items():
                        converted_props[prop_key] = convert_schema_recursive(prop_value)
                    converted[key] = converted_props
                elif key == "items":
                    converted[key] = convert_schema_recursive(value)
                elif key == "required":
                    continue
                else:
                    converted[key] = value

            if converted.get("type") == "object" and "properties" in converted:
                converted["required"] = list(converted["properties"].keys())
                converted["additionalProperties"] = False

                original_required = schema_obj.get("required", [])
                all_props = list(converted["properties"].keys())
                optional_props = [prop for prop in all_props if prop not in original_required]

                for prop in optional_props:
                    prop_schema = converted["properties"][prop]
                    if isinstance(prop_schema, dict) and "type" in prop_schema:
                        converted["properties"][prop] = {
                            "anyOf": [
                                prop_schema,
                                {"type": "null"},
                            ]
                        }
                        logger.debug(f"Converted optional property '{prop}' to nullable type")

            return converted

        converted_schema = convert_schema_recursive(schema)
        logger.info("Converted Gemini schema to OpenAI Structured Outputs format")
        return converted_schema

    def _create_response_format(self, response_schema: Optional[Dict]) -> Optional[Dict]:
        """Create response_format for structured outputs."""
        if not response_schema:
            return None

        openai_schema = self._convert_gemini_schema_to_openai(response_schema)

        return {
            "type": "json_schema",
            "json_schema": {
                "name": "structured_response",
                "strict": True,
                "schema": openai_schema,
            },
        }

    async def _prepare_message_content(self, filepath: str, prompt: str) -> tuple:
        """
        Prepare message content for OpenAI API.

        Returns:
            Tuple of (content_list, use_instructions_api)
        """
        if self._is_image_file(filepath):
            base64_image = self._encode_image(filepath)
            content = [
                {"type": "input_text", "text": prompt},
                {
                    "type": "input_image",
                    "image_url": f"data:image/jpeg;base64,{base64_image}",
                },
            ]
            return content, False
        else:
            try:
                with open(filepath, "rb") as file:
                    uploaded_file = await self.client.files.create(
                        file=file,
                        purpose="user_data",
                    )
                    content = [{"type": "input_file", "file_id": uploaded_file.id}]
                    self._uploaded_file_id = uploaded_file.id
                    return content, True
            except Exception as e:
                logger.error(f"Failed to upload file {filepath}: {e}")
                raise

    async def process_document(
        self, file_path: str, instruction: str, runtime_config: Optional[Dict] = None
    ) -> str:
        """
        Process document using OpenAI Responses API with Structured Outputs support.

        Args:
            file_path: Path to document file
            instruction: Processing instruction/prompt
            runtime_config: Runtime configuration

        Returns:
            Processed document content as string (JSON if schema provided)
        """
        if not self.client:
            raise RuntimeError("OpenAI client not initialized")

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Document file not found: {file_path}")

        logger.info(f"Processing document with OpenAI {self.model_name}: {file_path}")

        try:
            # 合并优先级：runtime_config > YAML model.params > 内置默认
            effective = {**self._yaml_params, **(runtime_config or {})}
            temperature = effective.get("temperature", 0.1)
            max_tokens = effective.get("max_output_tokens", 4096)
            response_schema = effective.get("response_schema")

            content, use_instructions_api = await self._prepare_message_content(
                file_path, instruction
            )

            if use_instructions_api:
                api_params = {
                    "model": self.model_name,
                    "input": [{"role": "user", "content": content}],
                    "instructions": instruction,
                    "max_output_tokens": max_tokens,
                }
            else:
                api_params = {
                    "model": self.model_name,
                    "input": [{"role": "user", "content": content}],
                    "max_output_tokens": max_tokens,
                }

            if self._supports_temperature():
                api_params["temperature"] = temperature
            else:
                logger.info(
                    f"Skipping temperature parameter for model {self.model_name} (not supported)"
                )

            response_format = self._create_response_format(response_schema)
            if response_format:
                api_params["response_format"] = response_format
                logger.info("Using structured outputs with response schema")

            logger.info(
                f"Calling OpenAI API with parameters: {api_params.keys()}, "
                f"use_instructions_api={use_instructions_api}"
            )

            if response_format:
                # Use chat.completions.create for structured outputs support
                messages = []
                for input_item in api_params["input"]:
                    if input_item["role"] == "user":
                        messages.append({"role": "user", "content": input_item["content"]})

                chat_params = {
                    "model": api_params["model"],
                    "messages": messages,
                    "max_tokens": api_params["max_output_tokens"],
                    "response_format": response_format,
                }

                if self._supports_temperature():
                    chat_params["temperature"] = temperature

                response = await self.client.chat.completions.create(**chat_params)

                class MockResponse:
                    def __init__(self, chat_response):
                        self.output_text = chat_response.choices[0].message.content
                        self.output = [
                            type(
                                "obj",
                                (object,),
                                {
                                    "content": [
                                        type(
                                            "obj",
                                            (object,),
                                            {"text": chat_response.choices[0].message.content},
                                        )()
                                    ]
                                },
                            )()
                        ]

                response = MockResponse(response)
            else:
                # Use responses.create for regular processing
                response = await self.client.responses.create(**api_params)

            # Extract response content
            result = None
            if hasattr(response, "output_text") and response.output_text:
                result = response.output_text
            elif hasattr(response, "output") and response.output:
                for output_item in response.output:
                    if hasattr(output_item, "content") and output_item.content:
                        for content_item in output_item.content:
                            if hasattr(content_item, "text"):
                                result = content_item.text
                                break
                    if result:
                        break

            if not result:
                raise RuntimeError("No response content received from OpenAI")

            logger.info(f"OpenAI response: {result}")
            logger.info(
                f"Successfully processed document with OpenAI, result length: {len(result)}"
            )
            return result

        except Exception as e:
            logger.error(f"Document processing failed: {e}")
            raise RuntimeError(f"OpenAI document processing failed: {str(e)}") from e
        finally:
            if hasattr(self, "_uploaded_file_id"):
                try:
                    await self.client.files.delete(self._uploaded_file_id)
                    logger.info(f"Deleted uploaded file: {self._uploaded_file_id}")
                    delattr(self, "_uploaded_file_id")
                except Exception as cleanup_error:
                    logger.warning(f"Failed to delete uploaded file: {cleanup_error}")

    def get_supported_formats(self) -> list:
        """Get supported file formats"""
        return [
            ".pdf",
            ".docx",
            ".doc",
            ".txt",
            ".md",
            ".jpg",
            ".jpeg",
            ".png",
            ".bmp",
            ".gif",
        ]

    def validate_config(self, runtime_config: Optional[Dict] = None) -> bool:
        """Validate runtime configuration."""
        if not runtime_config:
            return True

        if "temperature" in runtime_config:
            temp = runtime_config["temperature"]
            if not isinstance(temp, (int, float)) or temp < 0 or temp > 2:
                logger.error(f"Invalid temperature: {temp}. Must be between 0 and 2")
                return False

        if "max_output_tokens" in runtime_config:
            max_tokens = runtime_config["max_output_tokens"]
            if not isinstance(max_tokens, int) or max_tokens <= 0:
                logger.error(
                    f"Invalid max_output_tokens: {max_tokens}. Must be positive integer"
                )
                return False

        if "response_schema" in runtime_config:
            schema = runtime_config["response_schema"]
            if schema is not None and not isinstance(schema, dict):
                logger.error(f"Invalid response_schema: {type(schema)}. Must be a dict or None")
                return False

            if schema and "type" not in schema:
                logger.error("response_schema must contain 'type' field")
                return False

        return True

    def supports_structured_outputs(self) -> bool:
        """Check if this processor supports structured outputs"""
        return True
