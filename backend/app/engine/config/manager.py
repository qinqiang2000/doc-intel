"""
配置管理器 - 统一管理模型配置
"""
from __future__ import annotations

import os
import yaml
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ModelConfig:
    """模型配置数据类"""
    name: str
    description: str
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProcessorConfig:
    """处理器配置数据类"""
    type: str
    name: str
    description: str
    enabled: bool
    default_model: str
    env_vars: Dict[str, str]
    models: Dict[str, ModelConfig]


class ConfigManager:
    """配置管理器 - 单例模式"""

    _instance = None
    _config = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConfigManager, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if self._config is None:
            self.load_config()

    def load_config(self, config_path: Optional[str] = None) -> None:
        """
        加载配置文件

        Args:
            config_path: 配置文件路径，默认为同目录下的 models.yaml
        """
        if config_path is None:
            config_path = Path(__file__).parent / "models.yaml"

        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                raw_config = yaml.safe_load(f)

            # 解析配置
            self._config = self._parse_config(raw_config)
            logger.info(f"Configuration loaded successfully from {config_path}")

        except FileNotFoundError:
            logger.error(f"Configuration file not found: {config_path}")
            # 使用默认配置
            self._config = self._get_default_config()

        except yaml.YAMLError as e:
            logger.error(f"Error parsing YAML configuration: {e}")
            self._config = self._get_default_config()

        except Exception as e:
            logger.error(f"Unexpected error loading configuration: {e}")
            self._config = self._get_default_config()

    def _parse_config(self, raw_config: Dict) -> Dict:
        """解析原始配置为结构化数据"""
        parsed_config = {
            'defaults': raw_config.get('defaults', {}),
            'processors': {}
        }

        # 解析处理器配置
        for processor_type, processor_data in raw_config.get('processors', {}).items():
            models = {}
            for model_name, model_data in processor_data.get('models', {}).items():
                models[model_name] = ModelConfig(
                    name=model_data['name'],
                    description=model_data['description'],
                    params=dict(model_data.get('params') or {}),
                )

            parsed_config['processors'][processor_type] = ProcessorConfig(
                type=processor_data['type'],
                name=processor_data['name'],
                description=processor_data['description'],
                enabled=processor_data['enabled'],
                default_model=processor_data['default_model'],
                env_vars=processor_data['env_vars'],
                models=models
            )

        return parsed_config

    def _get_default_config(self) -> Dict:
        """获取默认配置（当配置文件加载失败时使用）"""
        logger.warning("Using default configuration due to config file loading failure")
        return {
            'defaults': {'processor': 'mock'},
            'processors': {
                'mock': ProcessorConfig(
                    type='mock',
                    name='Mock Processor',
                    description='Emergency fallback mock processor',
                    enabled=True,
                    default_model='mock-v1.0',
                    env_vars={},
                    models={
                        'mock-v1.0': ModelConfig(
                            name='mock-v1.0',
                            description='Emergency fallback model'
                        )
                    }
                )
            }
        }

    def get_processor_config(self, processor_type: str) -> Optional[ProcessorConfig]:
        """获取指定处理器的配置"""
        return self._config['processors'].get(processor_type)

    def get_available_processors(self) -> List[str]:
        """获取所有可用的处理器类型"""
        return [
            proc_type for proc_type, config in self._config['processors'].items()
            if config.enabled
        ]

    def get_model_config(self, processor_type: str, model_name: str) -> Optional[ModelConfig]:
        """获取指定模型的配置"""
        processor_config = self.get_processor_config(processor_type)
        if processor_config:
            return processor_config.models.get(model_name)
        return None

    def get_default_model(self, processor_type: str) -> Optional[str]:
        """获取处理器的默认模型"""
        processor_config = self.get_processor_config(processor_type)
        if processor_config:
            # 检查环境变量是否有覆盖
            env_var_name = processor_config.env_vars.get('model_override')
            if env_var_name:
                env_model = os.environ.get(env_var_name)
                if env_model and env_model in processor_config.models:
                    return env_model

            return processor_config.default_model
        return None

    def get_recommended_models(self, processor_type: str) -> List[str]:
        """获取推荐的模型列表 (现在返回默认模型)"""
        default_model = self.get_default_model(processor_type)
        return [default_model] if default_model else []

    def get_all_versions(self) -> List[Dict[str, Any]]:
        """
        获取所有可用的模型版本信息

        Returns:
            List of version dictionaries for API response
        """
        versions = []

        for processor_type, processor_config in self._config['processors'].items():
            if not processor_config.enabled:
                continue

            for model_name, model_config in processor_config.models.items():
                versions.append({
                    "processor_type": processor_type,
                    "model_name": model_name,
                    "version_string": f"{processor_type}|{model_name}",
                    "description": model_config.description,
                    "is_default": model_name == processor_config.default_model
                })

        return versions

    def validate_model_version(self, version_string: str) -> Tuple[Optional[str], Optional[str]]:
        """
        验证并解析模型版本字符串

        Args:
            version_string: 格式为 "processor_type|model_name" 或 "model_name"

        Returns:
            Tuple of (processor_type, model_name) or (None, None) if invalid
        """
        if '|' in version_string:
            processor_type, model_name = version_string.split('|', 1)
        else:
            # 如果没有分隔符，尝试在所有处理器中查找该模型
            model_name = version_string
            processor_type = None

            for proc_type, proc_config in self._config['processors'].items():
                if model_name in proc_config.models:
                    processor_type = proc_type
                    break

            if processor_type is None:
                return None, None

        # 验证处理器和模型是否存在
        processor_config = self.get_processor_config(processor_type)
        if processor_config and model_name in processor_config.models:
            return processor_type, model_name

        return None, None

    def get_env_vars_for_processor(self, processor_type: str) -> Dict[str, str]:
        """获取处理器所需的环境变量映射"""
        processor_config = self.get_processor_config(processor_type)
        if processor_config:
            return processor_config.env_vars
        return {}

    def reload_config(self) -> None:
        """重新加载配置"""
        logger.info("Reloading configuration...")
        self.load_config()


# 全局配置管理器实例
config_manager = ConfigManager()
