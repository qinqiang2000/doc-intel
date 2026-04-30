from __future__ import annotations

import base64
import json
import logging
import os
import pathlib
from typing import Any, List, Optional

import httpx
from pydantic import BaseModel, Field

from app.engine.config.manager import config_manager
from app.engine.processors.base import DocumentProcessor
from app.engine.processors.piaozone_token import get_piaozone_token
from app.engine.utils import extract_json

logger = logging.getLogger(__name__)


class PiaoZoneModelParams(BaseModel):
    temperature: Optional[float] = Field(
        0.1,
        description="温度：较高的数值会使输出更加随机，而较低的数值会使其更加集中和确定。",
    )
    seed: Optional[int] = Field(12345, description="随机种子")
    top_p: Optional[float] = Field(
        None,
        description="模型仅考虑概率累积为 top_p 的 token 结果。",
    )
    top_k: Optional[float] = Field(
        None,
        description="模型采样时要考虑的最大 token 数。",
    )
    max_output_tokens: Optional[int] = Field(
        None,
        description="允许生成的最大 token 数。",
    )
    response_mime_type: Optional[str] = Field(
        "application/json",
        description="响应输出的 MIME 类型。",
    )
    response_schema: Optional[Any] = Field(
        default=None,
        description="Schema 对象允许定义输出数据类型。",
    )
    thinking_budget: Optional[int] = Field(
        0,
        description="深度思考配置预算",
    )


class PiaoZoneProcessor(DocumentProcessor):
    """PiaoZone-based document processor"""

    def __init__(self, model_name: str = "gemini-2.5-flash-preview-04-17"):
        # 从环境变量获取API配置
        self.api_url = os.environ.get(
            "PIAOZONE_API_URL",
            "https://api-sit.piaozone.com/ai/knowledge/v1/chat/completions",
        )
        self.model_name = model_name

        # 从环境变量构建 LLM 配置，使用默认值
        self.llm_param_config = self._build_param_config({})

        logger.info(f"Initialized PiaoZone processor with model: {model_name}")

    def _load_yaml_params(self) -> dict:
        """从 models.yaml 中加载当前 model 的默认 params 块。"""
        model_cfg = config_manager.get_model_config("piaozone", self.model_name)
        if model_cfg and model_cfg.params:
            return dict(model_cfg.params)
        return {}

    def _build_param_config(self, custom_config: dict) -> dict:
        """合并 YAML model.params → env vars → custom_config。"""
        yaml_params = self._load_yaml_params()
        env_config = {}

        if os.environ.get("PIAOZONE_TEMPERATURE"):
            env_config["temperature"] = float(os.environ.get("PIAOZONE_TEMPERATURE"))

        if os.environ.get("PIAOZONE_MAX_OUTPUT_TOKENS"):
            env_config["max_output_tokens"] = int(os.environ.get("PIAOZONE_MAX_OUTPUT_TOKENS"))

        if os.environ.get("PIAOZONE_TOP_P"):
            env_config["top_p"] = float(os.environ.get("PIAOZONE_TOP_P"))

        if os.environ.get("PIAOZONE_TOP_K"):
            env_config["top_k"] = int(os.environ.get("PIAOZONE_TOP_K"))

        if os.environ.get("PIAOZONE_SEED"):
            env_config["seed"] = int(os.environ.get("PIAOZONE_SEED"))

        if os.environ.get("PIAOZONE_RESPONSE_MIME_TYPE"):
            env_config["response_mime_type"] = os.environ.get("PIAOZONE_RESPONSE_MIME_TYPE")

        if os.environ.get("PIAOZONE_THINKING_BUDGET"):
            env_config["thinking_budget"] = int(os.environ.get("PIAOZONE_THINKING_BUDGET"))

        final_config = {**yaml_params, **env_config, **(custom_config or {})}
        logger.debug(f"Built PiaoZone param config: {final_config}")
        return final_config

    def _normalize_schema(self, schema):
        """
        标准化 JSON Schema 格式
        将大写的类型名称转换为大写 (PiaoZone API 需要大写)
        """
        if not isinstance(schema, dict):
            return schema

        normalized = {}

        for key, value in schema.items():
            if key == "type" and isinstance(value, str):
                normalized[key] = value.upper()
            elif key == "properties" and isinstance(value, dict):
                normalized_props = {}
                for prop_key, prop_value in value.items():
                    if prop_key != "required":
                        normalized_props[prop_key] = self._normalize_schema(prop_value)
                normalized[key] = normalized_props
            elif key in ["items", "anyOf", "oneOf", "allOf"] and isinstance(value, (dict, list)):
                if isinstance(value, dict):
                    normalized[key] = self._normalize_schema(value)
                elif isinstance(value, list):
                    normalized[key] = [self._normalize_schema(item) for item in value]
            else:
                normalized[key] = value

        return normalized

    def _get_mime_type(self, file_path: str) -> str:
        """根据文件扩展名确定MIME类型"""
        if file_path.lower().endswith(".pdf"):
            return "application/pdf"
        elif file_path.lower().endswith(".png"):
            return "image/png"
        elif file_path.lower().endswith((".jpg", ".jpeg")):
            return "image/jpeg"
        else:
            return "application/octet-stream"

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
        # 读取文件并转换为base64
        file_data = pathlib.Path(file_path).read_bytes()
        file_base64 = base64.b64encode(file_data).decode("utf-8")
        file_name = os.path.basename(file_path)
        mime_type = self._get_mime_type(file_path)

        # 合并运行时配置：runtime_config > 默认配置
        merged_config = {**self.llm_param_config}
        if runtime_config:
            merged_config.update(runtime_config)
            logger.debug(f"Applied runtime config: {runtime_config}")

        # 标准化 response_schema 格式（转换为大写类型名称）
        if "response_schema" in merged_config and merged_config["response_schema"]:
            merged_config["response_schema"] = self._normalize_schema(
                merged_config["response_schema"]
            )
            logger.info("Normalized response_schema format for PiaoZone API")

        # 构造完整的参数配置
        param_config = PiaoZoneModelParams(**merged_config).model_dump(exclude_none=True)

        # 尝试简化的请求格式（使用文本内容）
        if mime_type == "application/octet-stream" and file_name.endswith(".txt"):
            try:
                text_content = pathlib.Path(file_path).read_text(encoding="utf-8")
                logger.info(f"Using text content instead of file: {text_content[:100]}...")

                request_data = {
                    "llm_type": "gemini",
                    "data": {
                        "model": self.model_name,
                        "contents": [
                            {
                                "parts": [
                                    {
                                        "text": (
                                            f"Document content:\n{text_content}\n\n"
                                            f"Instruction: {instruction}"
                                        )
                                    }
                                ]
                            }
                        ],
                        "generation_config": param_config,
                    },
                }
            except Exception as e:
                logger.warning(f"Failed to read text content: {e}, falling back to file format")
                request_data = {
                    "llm_type": "gemini",
                    "data": {
                        "model": self.model_name,
                        "contents": [
                            {
                                "type": "file",
                                "file": {
                                    "mime_type": mime_type,
                                    "data": file_base64,
                                    "name": file_name,
                                },
                            }
                        ],
                        "generation_config": {
                            **param_config,
                            "system_instruction": instruction,
                        },
                    },
                }
        else:
            # 对于PDF和图片，使用文件格式
            request_data = {
                "llm_type": "gemini",
                "data": {
                    "model": self.model_name,
                    "contents": [
                        {
                            "type": "file",
                            "file": {
                                "mime_type": mime_type,
                                "data": file_base64,
                                "name": file_name,
                            },
                        }
                    ],
                    "generation_config": {
                        **param_config,
                        "system_instruction": instruction,
                    },
                },
            }

        # 获取动态token
        try:
            access_token = await get_piaozone_token()
        except Exception as e:
            logger.error(f"Failed to get PiaoZone access token: {e}")
            raise RuntimeError(f"Failed to get PiaoZone access token: {e}")

        # 添加access_token到URL参数
        api_url_with_token = f"{self.api_url}?access_token={access_token}"

        logger.info(f"Calling PiaoZone API: {self.model_name}")
        logger.info(f"API URL: {api_url_with_token}")

        # 创建一个用于日志的请求数据副本，缩短base64内容
        log_request_data = json.loads(json.dumps(request_data))
        if "data" in log_request_data and "contents" in log_request_data["data"]:
            for content in log_request_data["data"]["contents"]:
                if "file" in content and "data" in content["file"]:
                    original_length = len(content["file"]["data"])
                    content["file"]["data"] = f"<base64_data_length_{original_length}>"

        logger.info(
            f"Request data structure: {json.dumps(log_request_data, ensure_ascii=False, indent=2)}"
        )

        # 发送HTTP请求
        try:
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "client-platform": "common",
            }

            logger.info(f"Request headers: {headers}")
            logger.info("Request method: POST")

            async with httpx.AsyncClient(
                timeout=httpx.Timeout(read=120.0, connect=5.0, write=30.0, pool=5.0)
            ) as client:
                resp = await client.post(
                    api_url_with_token,
                    json=request_data,
                    headers=headers,
                )

            logger.info(f"Response status code: {resp.status_code}")
            logger.info(f"Response headers: {dict(resp.headers)}")

            if resp.status_code >= 400:
                logger.error(f"Error response body: {resp.text}")

            resp.raise_for_status()

            # 解析响应
            response_data = resp.json()
            logger.debug(f"PiaoZone API response: {response_data}")

            # 提取响应内容 - 优先从parsed获取，否则从text获取
            content = None

            if "data" in response_data and "parsed" in response_data["data"]:
                parsed_data = response_data["data"]["parsed"]
                if parsed_data is not None:
                    content = json.dumps(parsed_data, ensure_ascii=False)
                    logger.info("Got parsed data from PiaoZone API response")

            if content is None:
                if (
                    "data" in response_data
                    and "candidates" in response_data["data"]
                    and len(response_data["data"]["candidates"]) > 0
                ):
                    candidate = response_data["data"]["candidates"][0]
                    if (
                        "content" in candidate
                        and "parts" in candidate["content"]
                        and len(candidate["content"]["parts"]) > 0
                    ):
                        text_content = candidate["content"]["parts"][0].get("text", "")
                        if text_content:
                            content = text_content
                            logger.info("Got text content from PiaoZone API response")

                elif "choices" in response_data and len(response_data["choices"]) > 0:
                    content = response_data["choices"][0].get("message", {}).get("content", "")
                elif "data" in response_data and "content" in response_data["data"]:
                    content = response_data["data"]["content"]

            if content is None:
                content = json.dumps(response_data, ensure_ascii=False)
                logger.warning("Could not extract content from response, returning full response")

            logger.info(f"PiaoZone API response content: {content[:200]}...")

            current_mime_type = merged_config.get("response_mime_type", "application/json")
            if isinstance(content, str) and current_mime_type == "text/plain":
                json_string = extract_json(content)
                if isinstance(json_string, list) and len(json_string) > 0:
                    json_string = json_string[0]
                else:
                    json_string = content
            else:
                json_string = content

            return json_string

        except httpx.HTTPError as e:
            logger.error(f"PiaoZone API request failed: {e}")
            raise RuntimeError(f"PiaoZone API request failed: {e}")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse PiaoZone API response: {e}")
            raise RuntimeError(f"Failed to parse PiaoZone API response: {e}")
        except Exception as e:
            logger.error(f"Unexpected error in PiaoZone processor: {e}")
            raise RuntimeError(f"Unexpected error in PiaoZone processor: {e}")

    def get_model_version(self) -> str:
        return f"piaozone|{self.model_name}"
