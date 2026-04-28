from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)


class PiaoZoneTokenManager:
    """管理PiaoZone API的token获取和缓存"""

    def __init__(self):
        self._token: Optional[str] = None
        self._token_expiry: Optional[datetime] = None
        self._client_id: Optional[str] = os.environ.get("PIAOZONE_CLIENT_ID")
        self._client_secret: Optional[str] = os.environ.get("PIAOZONE_CLIENT_SECRET")
        self._token_url: str = os.environ.get(
            "PIAOZONE_TOKEN_URL",
            "https://api-sit.piaozone.com/base/oauth/token",
        )
        self._token_duration_hours: int = int(
            os.environ.get("PIAOZONE_TOKEN_DURATION_HOURS", "24")
        )
        self._lock = asyncio.Lock()

    def _calculate_sign(self, timestamp: int) -> str:
        """计算签名：MD5(client_id + client_secret + timestamp)"""
        sign_string = f"{self._client_id}{self._client_secret}{timestamp}"
        return hashlib.md5(sign_string.encode()).hexdigest()

    async def _fetch_new_token(self) -> Dict[str, Any]:
        """从PiaoZone API获取新的token"""
        if not self._client_id or not self._client_secret:
            raise ValueError("PIAOZONE_CLIENT_ID and PIAOZONE_CLIENT_SECRET must be set")

        timestamp = int(time.time())
        sign = self._calculate_sign(timestamp)

        request_data = {
            "client_id": self._client_id,
            "timestamp": str(timestamp),
            "sign": sign,
        }

        logger.info("Fetching new token from PiaoZone API")
        logger.debug(f"Token request data: client_id={self._client_id}, timestamp={timestamp}")

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(read=30.0, connect=5.0, write=10.0, pool=5.0)
            ) as client:
                response = await client.post(
                    self._token_url,
                    json=request_data,
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()

                # 记录原始响应
                logger.debug(f"Response status code: {response.status_code}")
                logger.debug(f"Response headers: {response.headers}")
                logger.debug(f"Raw response text: {response.text}")

                # 检查响应是否为空
                if not response.text.strip():
                    logger.error("Empty response from PiaoZone token API")
                    raise RuntimeError("Empty response from PiaoZone token API")

                try:
                    token_data = response.json()
                    logger.info("Successfully fetched new token from PiaoZone API")
                    logger.debug(f"Token response data: {token_data}")
                    return token_data
                except ValueError as e:
                    logger.error(f"Failed to parse JSON response: {e}")
                    logger.error(f"Response text: {response.text}")
                    raise RuntimeError(f"Invalid JSON response from PiaoZone token API: {e}")

        except httpx.HTTPError as e:
            logger.error(f"Failed to fetch token from PiaoZone API: {e}")
            raise RuntimeError(f"Failed to fetch PiaoZone token: {e}")

    async def get_token(self) -> str:
        """获取有效的token，如果需要会自动刷新"""
        async with self._lock:
            # 优先使用环境变量中的静态token（向后兼容）
            static_token = os.environ.get("PIAOZONE_ACCESS_TOKEN")
            if static_token:
                logger.debug("Using static token from environment variable")
                return static_token

            # 检查缓存的token是否有效
            if self._token and self._token_expiry and datetime.now() < self._token_expiry:
                logger.debug("Using cached token")
                return self._token

            # 获取新token
            logger.info("Token expired or not available, fetching new token")
            try:
                token_data = await self._fetch_new_token()
            except Exception as e:
                logger.error(f"Failed to fetch new token: {e}")
                raise RuntimeError(f"Failed to get PiaoZone access token: {e}")

            # 检查token_data是否为有效响应
            if not token_data:
                raise RuntimeError(
                    "Failed to get PiaoZone access token: Empty response from token API"
                )

            # 提取token和过期时间
            if (
                isinstance(token_data, dict)
                and "data" in token_data
                and token_data["data"] is not None
                and "access_token" in token_data["data"]
            ):
                self._token = token_data["data"]["access_token"]
                # 设置过期时间（比实际过期时间提前5分钟刷新）
                self._token_expiry = (
                    datetime.now()
                    + timedelta(hours=self._token_duration_hours)
                    - timedelta(minutes=5)
                )
                logger.info(f"Token will expire at {self._token_expiry}")
                return self._token
            elif isinstance(token_data, dict) and "access_token" in token_data:
                self._token = token_data["access_token"]
                # 从expires_in字段获取过期时间（如果有的话）
                expires_in_seconds = token_data.get(
                    "expires_in", self._token_duration_hours * 3600
                )
                self._token_expiry = (
                    datetime.now()
                    + timedelta(seconds=expires_in_seconds)
                    - timedelta(minutes=5)
                )
                logger.info(f"Token will expire at {self._token_expiry}")
                return self._token
            else:
                raise RuntimeError(f"Unexpected token response format: {token_data}")

    def clear_cache(self):
        """清除缓存的token"""
        self._token = None
        self._token_expiry = None
        logger.info("Token cache cleared")


# 全局单例实例
_token_manager = PiaoZoneTokenManager()


async def get_piaozone_token() -> str:
    """获取PiaoZone API访问token的便捷函数"""
    return await _token_manager.get_token()


def clear_piaozone_token_cache():
    """清除token缓存的便捷函数"""
    _token_manager.clear_cache()
