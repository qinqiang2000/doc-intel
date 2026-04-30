from __future__ import annotations

import logging
import os
import pathlib
from typing import Any, List, Optional

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app.engine.config.manager import config_manager
from app.engine.processors.base import DocumentProcessor
from app.engine.utils import extract_json

logger = logging.getLogger(__name__)


class GeminiLMModelParams(BaseModel):
    temperature: Optional[float] = Field(
        0.0,
        description=(
            "温度：较高的数值会使输出更加随机，而较低的数值会使其更加集中和确定。"
            "如果设置为0，模型将使用对数概率自动增加温度，直到达到某些阈值。"
        ),
    )
    seed: Optional[int] = Field(None, description="随机种子")
    top_p: Optional[float] = Field(
        None,
        description="模型仅考虑概率累积为 top_p 的 token 结果。",
    )
    top_k: Optional[float] = Field(
        None,
        description="模型采样时要考虑的最大 token 数。",
    )
    candidate_count: Optional[int] = Field(
        None,
        description="返回的响应数。如果未设置，则默认为 1。",
    )
    max_output_tokens: Optional[int] = Field(
        None,
        description="允许生成的最大 token 数。",
    )
    stop_sequences: Optional[List[str]] = Field(
        None,
        description="最多可指定 5 个序列，API 遇到这些序列时将停止生成 token。",
    )
    presence_penalty: Optional[float] = Field(
        None,
        description="存在惩罚。",
    )
    frequency_penalty: Optional[float] = Field(
        None,
        description="频率惩罚。",
    )
    response_mime_type: Optional[str] = Field(
        "application/json",
        description="响应输出的 MIME 类型。",
    )
    response_schema: Optional[Any] = Field(
        default=None,
        description="Schema 对象允许定义输出数据类型。",
    )
    response_modalities: Optional[List[str]] = Field(
        default=None,
        description="响应的请求模态。",
    )
    thinking_config: Optional[Any] = Field(
        default=None,
        description="深度思考配置（由 _normalize_thinking 从 thinking_budget/thinking_level 翻译得到）",
    )


class GeminiProcessor(DocumentProcessor):
    """Gemini-based document processor"""

    def __init__(self, model_name: str = "gemini-3-flash-preview"):
        self.client = genai.Client(api_key=os.environ.get("API_KEY"))
        self.model_name = model_name
        # 从环境变量构建 LLM 配置，使用默认值
        self.llm_param_config = self._build_param_config({})

    def _load_yaml_params(self) -> dict:
        """从 models.yaml 中加载当前 model 的默认 params 块。"""
        model_cfg = config_manager.get_model_config("gemini", self.model_name)
        if model_cfg and model_cfg.params:
            return dict(model_cfg.params)
        return {}

    def _load_env_params(self) -> dict:
        """从环境变量读取 Gemini 调参（保持向后兼容）。"""
        env_config: dict = {}

        if os.environ.get("GEMINI_TEMPERATURE"):
            env_config["temperature"] = float(os.environ.get("GEMINI_TEMPERATURE"))

        if os.environ.get("GEMINI_MAX_OUTPUT_TOKENS"):
            env_config["max_output_tokens"] = int(os.environ.get("GEMINI_MAX_OUTPUT_TOKENS"))

        if os.environ.get("GEMINI_TOP_P"):
            env_config["top_p"] = float(os.environ.get("GEMINI_TOP_P"))

        if os.environ.get("GEMINI_TOP_K"):
            env_config["top_k"] = int(os.environ.get("GEMINI_TOP_K"))

        if os.environ.get("GEMINI_SEED"):
            env_config["seed"] = int(os.environ.get("GEMINI_SEED"))

        if os.environ.get("GEMINI_CANDIDATE_COUNT"):
            env_config["candidate_count"] = int(os.environ.get("GEMINI_CANDIDATE_COUNT"))

        if os.environ.get("GEMINI_STOP_SEQUENCES"):
            env_config["stop_sequences"] = os.environ.get("GEMINI_STOP_SEQUENCES").split(",")

        if os.environ.get("GEMINI_PRESENCE_PENALTY"):
            env_config["presence_penalty"] = float(os.environ.get("GEMINI_PRESENCE_PENALTY"))

        if os.environ.get("GEMINI_FREQUENCY_PENALTY"):
            env_config["frequency_penalty"] = float(os.environ.get("GEMINI_FREQUENCY_PENALTY"))

        if os.environ.get("GEMINI_RESPONSE_MIME_TYPE"):
            env_config["response_mime_type"] = os.environ.get("GEMINI_RESPONSE_MIME_TYPE")

        if os.environ.get("GEMINI_THINKING_BUDGET"):
            env_config["thinking_budget"] = int(os.environ.get("GEMINI_THINKING_BUDGET"))

        if os.environ.get("GEMINI_THINKING_LEVEL"):
            env_config["thinking_level"] = os.environ.get("GEMINI_THINKING_LEVEL")

        return env_config

    def _normalize_thinking(self, cfg: dict) -> dict:
        """将 thinking_budget / thinking_level 收口转成 ThinkingConfig。

        thinking_level（gemini-3+）与 thinking_budget（gemini-2.x）二选一；
        若同时存在，thinking_level 胜出并 log warning。
        """
        level = cfg.pop("thinking_level", None)
        budget = cfg.pop("thinking_budget", None)
        if level is not None and budget is not None:
            logger.warning(
                "Both thinking_level=%r and thinking_budget=%r set; preferring thinking_level.",
                level, budget,
            )
        if level is not None:
            cfg["thinking_config"] = types.ThinkingConfig(thinking_level=str(level).upper())
        elif budget is not None:
            cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=int(budget))
        return cfg

    def _build_param_config(self, custom_config: dict) -> dict:
        """合并 YAML model.params → env vars → custom_config，再 normalize thinking。"""
        yaml_params = self._load_yaml_params()
        env_config = self._load_env_params()
        merged = {**yaml_params, **env_config, **(custom_config or {})}
        merged = self._normalize_thinking(merged)
        logger.debug(f"Built Gemini param config: {merged}")
        return merged

    def _normalize_schema(self, schema):
        """
        标准化 JSON Schema 格式
        将大写的类型名称转换为小写，修复结构问题
        """
        if not isinstance(schema, dict):
            return schema

        normalized = {}

        for key, value in schema.items():
            if key == "type" and isinstance(value, str):
                normalized[key] = value.lower()
            elif key == "properties" and isinstance(value, dict):
                normalized_props = {}
                for prop_key, prop_value in value.items():
                    if prop_key != "required":
                        normalized_props[prop_key] = self._normalize_schema(prop_value)
                normalized[key] = normalized_props
            elif key in ["items", "anyOf", "oneOf", "allOf"] and isinstance(
                value, (dict, list)
            ):
                if isinstance(value, dict):
                    normalized[key] = self._normalize_schema(value)
                elif isinstance(value, list):
                    normalized[key] = [self._normalize_schema(item) for item in value]
            else:
                normalized[key] = value

        return normalized

    async def process_document(
        self, file_path: str, instruction: str, runtime_config: Optional[dict] = None
    ) -> str:
        """
        处理文档

        Args:
            file_path: 文档文件路径
            instruction: 处理指令
            runtime_config: 运行时配置

        Returns:
            处理结果的JSON字符串
        """
        contents = [
            types.Part.from_bytes(
                data=pathlib.Path(file_path).read_bytes(),
                mime_type=(
                    "application/pdf"
                    if file_path.lower().endswith(".pdf")
                    else (
                        "image/png"
                        if file_path.lower().endswith(".png")
                        else (
                            "image/jpeg"
                            if file_path.lower().endswith((".jpg", ".jpeg"))
                            else "application/octet-stream"
                        )
                    )
                ),
            )
        ]

        # 合并运行时配置：runtime_config > 缓存的 llm_param_config（已含 YAML+env）
        merged_config = {**self.llm_param_config}
        if runtime_config:
            merged_config.update(runtime_config)
            merged_config = self._normalize_thinking(merged_config)
            logger.debug(f"Applied runtime config: {runtime_config}")

        # 标准化 response_schema 格式（修复大写类型名称问题）
        if "response_schema" in merged_config and merged_config["response_schema"]:
            merged_config["response_schema"] = self._normalize_schema(
                merged_config["response_schema"]
            )
            logger.info("Normalized response_schema format")

        # 构造完整的参数配置
        param_config = GeminiLMModelParams(**merged_config).model_dump(exclude_none=True)
        param_config["system_instruction"] = [types.Part.from_text(text=instruction)]

        generate_content_config = types.GenerateContentConfig(**param_config)

        logger.info(f"calling genai: {self.model_name}")
        logger.info(f"Model configuration: {generate_content_config}")

        response = await self.client.aio.models.generate_content(
            model=self.model_name,
            contents=contents,
            config=generate_content_config,
        )
        logger.info(f"Gemini response: {response.text}")

        # extract_json returns a list of JSON strings, so we take the first element
        json_string = response.text

        # if the response_mime_type is text/plain, we need to extract the JSON string
        current_mime_type = merged_config.get("response_mime_type", "application/json")
        if current_mime_type == "text/plain":
            json_string = extract_json(response.text)
            if isinstance(json_string, list) and len(json_string) > 0:
                json_string = json_string[0]

        return json_string

    def get_model_version(self) -> str:
        return f"gemini|{self.model_name}"

    async def chat_stream(self, *, system: str, user: str):
        """Stream LLM tokens via google.genai aio API."""
        from google.genai import types as _types
        try:
            stream = await self.client.aio.models.generate_content_stream(
                model=self.model_name,
                contents=[user],
                config=_types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=0.0,
                ),
            )
            async for chunk in stream:
                text = getattr(chunk, "text", None)
                if text:
                    yield text
        except AttributeError:
            # SDK may not expose generate_content_stream; fall back to non-stream
            r = await self.client.aio.models.generate_content(
                model=self.model_name,
                contents=[user],
                config=_types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=0.0,
                ),
            )
            text = getattr(r, "text", None)
            if text:
                yield text
