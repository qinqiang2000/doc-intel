import os
import logging
import re
import base64
import tempfile
import pandas as pd
import json
from pathlib import Path
from typing import Dict, Optional, List
from app.engine.analyzers.base import BaseAnalyzer
from app.engine.prompt import analysis_prompt

logger = logging.getLogger(__name__)

# Gemini imports
try:
    from google import genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logger.warning("Google GenAI not available. Install with: pip install google-genai")


class ExcelAnalyzer(BaseAnalyzer):
    """Excel file analyzer using Gemini document understanding"""

    def __init__(self):
        """Initialize Excel analyzer"""
        self.model_name = os.environ.get('ANALYSIS_MODEL', 'gemini-2.5-flash')
        self.api_key = os.environ.get('API_KEY')

        if not self.api_key:
            logger.warning("API_KEY environment variable not set for Excel analysis")

    async def analyze(self, excel_content: str, filename: str, context: Optional[Dict] = None,
                analysis_type: str = 'evaluation', prompt=None, **kwargs) -> str:
        """
        Analyze Excel file content using Gemini document understanding and return analysis in markdown format

        注意: 此方法有独立的处理逻辑，不使用配置管理器的模型选择，
        而是直接使用环境变量 API_KEY 和 ANALYSIS_MODEL 来配置 Gemini。

        Args:
            excel_content: Base64 encoded Excel file content
            filename: Excel filename for reference
            context: Optional context information
            analysis_type: Type of analysis to perform (default: 'evaluation')
            prompt: Custom prompt for analysis
            **kwargs: Additional parameters

        Returns:
            Markdown formatted analysis result from Gemini
        """
        logger.info("=== 接收到的prompt===")
        logger.info(prompt[:200] if prompt else "")
        logger.info("=== 请求数据打印完成 ===")

        custom_prompt = prompt
        if custom_prompt:
            logger.info(f"Using custom prompt from kwargs: {custom_prompt[:100]}...")
            base_prompt = custom_prompt
        else:
            logger.info("Using default analysis_prompt")
            base_prompt = analysis_prompt

        logger.info(f"Starting Excel analysis with Gemini for file: {filename}")

        # Check Gemini availability
        if not GEMINI_AVAILABLE:
            raise ImportError("Google GenAI package not available. Install with: pip install google-genai")

        # Get environment variables
        api_key = self.api_key or os.environ.get('API_KEY')
        model_name = self.model_name

        if not api_key:
            raise ValueError("API_KEY environment variable is required")

        logger.info(f"Using Gemini model: {model_name}")

        # Initialize Gemini client
        client = genai.Client(api_key=api_key)

        # Decode base64 content
        excel_bytes = base64.b64decode(excel_content)
        logger.info(f"Successfully decoded base64 content, size: {len(excel_bytes)} bytes")

        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            excel_filepath = temp_path / f"{filename}"

            # Save Excel file
            excel_filepath.write_bytes(excel_bytes)
            logger.info(f"Created temporary Excel file: {excel_filepath}")

            # Read Excel and convert sheets to CSV
            excel_data = self._read_excel_file(str(excel_filepath))
            csv_files = self._save_sheets_as_csv(excel_data, temp_path, filename)
            logger.info(f"Created {len(csv_files)} CSV files from Excel sheets")

            # 打印CSV文件信息
            for i, csv_file in enumerate(csv_files):
                logger.info(f"CSV文件 {i+1}: {csv_file.name} (大小: {csv_file.stat().st_size} bytes)")

            # Upload CSV files to Gemini File API
            uploaded_files = []
            for csv_file in csv_files:
                try:
                    uploaded_file = await client.aio.files.upload(
                        file=csv_file,
                        config=dict(mime_type='text/csv')
                    )
                    uploaded_files.append(uploaded_file)
                    logger.info(f"Uploaded CSV file to Gemini: {csv_file.name}")
                except Exception as e:
                    logger.error(f"Failed to upload {csv_file.name}: {str(e)}")
                    raise

            # Prepare content for Gemini analysis
            contents = uploaded_files.copy()

            # Add context information to prompt if provided
            context_info = ""
            if context:
                context_info = f"\n\n**附加上下文信息:**\n{json.dumps(context, ensure_ascii=False, indent=2)}"

            # Prepare analysis prompt
            full_prompt = f"""
                    {base_prompt}

                    **待分析文件信息:**
                    - 已处理工作表数量: {len(excel_data)} (仅前2个工作表)
                    - 工作表名称: {list(excel_data.keys())}
                    - CSV文件数量: {len(csv_files)}
                    {context_info}
                    """

            contents.append(full_prompt)

            # Call Gemini for analysis
            try:
                logger.info("Calling Gemini for document analysis...")
                logger.info(f"Sending prompt to Gemini (first 200 chars): {full_prompt[:200]}...")

                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=contents
                )

                analysis_result = response.text
                logger.info("Analysis completed successfully")

                # 打印Gemini返回的完整内容
                logger.info("=== GEMINI返回的完整分析结果 ===")
                logger.info(f"返回内容长度: {len(analysis_result)} 字符")
                logger.info("=== 返回内容开始 ===")
                logger.info(analysis_result[:200] + "..." if len(analysis_result) > 200 else analysis_result)
                logger.info("=== 返回内容结束 ===")

                return analysis_result

            except Exception as e:
                logger.error(f"Gemini analysis failed: {str(e)}")
                raise

            finally:
                # Cleanup uploaded files from Gemini
                for uploaded_file in uploaded_files:
                    try:
                        client.files.delete(name=uploaded_file.name)
                        logger.info(f"Cleaned up uploaded file: {uploaded_file.name}")
                    except Exception as cleanup_error:
                        logger.warning(f"Failed to cleanup file {uploaded_file.name}: {cleanup_error}")

    def _read_excel_file(self, filepath: str) -> Dict[str, pd.DataFrame]:
        """
        Read Excel file and return dictionary of sheet data (only first 2 sheets)
        """
        try:
            # Read all sheets first to get sheet names
            all_sheets = pd.read_excel(filepath, sheet_name=None, engine='openpyxl')
            sheet_names = list(all_sheets.keys())

            # Only keep first 2 sheets
            excel_data = {}
            sheets_to_process = sheet_names[:2]  # 只取前两个sheet

            logger.info(f"Total sheets found: {len(sheet_names)}, processing first {len(sheets_to_process)} sheets")
            logger.info(f"Sheet names: {sheet_names}")
            logger.info(f"Processing sheets: {sheets_to_process}")

            for i, sheet_name in enumerate(sheets_to_process):
                df = all_sheets[sheet_name]
                excel_data[sheet_name] = df
                logger.info(f"Sheet '{sheet_name}': {df.shape[0]} rows × {df.shape[1]} columns")

                # 打印第一个sheet的内容详情
                if i == 0:  # 第一个sheet
                    logger.info(f"=== 第一个Sheet内容详情 '{sheet_name}' ===")
                    logger.info(f"列名: {list(df.columns)}")

                    # 打印前5行数据（如果有的话）
                    if not df.empty:
                        logger.info(f"前5行数据:")
                        for idx, row in df.head(5).iterrows():
                            logger.info(f"行 {idx}: {dict(row)}")
                    else:
                        logger.info("Sheet为空")

                    # 打印数据类型信息
                    logger.info(f"数据类型:")
                    for col, dtype in df.dtypes.items():
                        logger.info(f"  {col}: {dtype}")

                    # 打印基本统计信息（仅数值列）
                    numeric_cols = df.select_dtypes(include=['number']).columns
                    if len(numeric_cols) > 0:
                        logger.info(f"数值列统计信息:")
                        for col in numeric_cols:
                            logger.info(f"  {col}: 最小值={df[col].min()}, 最大值={df[col].max()}, 平均值={df[col].mean():.2f}")

                    logger.info(f"=== 第一个Sheet内容详情结束 ===")

            return excel_data

        except Exception as e:
            logger.error(f"Failed to read Excel file: {str(e)}")
            raise

    def _save_sheets_as_csv(self, excel_data: Dict[str, pd.DataFrame],
                           temp_path: Path, original_filename: str) -> List[Path]:
        """
        Save each Excel sheet as a separate CSV file (only first 2 sheets)

        Args:
            excel_data: Dictionary of sheet name to DataFrame (already limited to first 2 sheets)
            temp_path: Temporary directory path
            original_filename: Original Excel filename for naming

        Returns:
            List of CSV file paths
        """
        csv_files = []
        base_name = Path(original_filename).stem

        # Process only first 2 sheets (should already be limited by _read_excel_file)
        sheet_items = list(excel_data.items())[:2]

        logger.info(f"Converting {len(sheet_items)} sheets to CSV files")

        for i, (sheet_name, df) in enumerate(sheet_items):
            # Clean sheet name for filename
            clean_sheet_name = re.sub(r'[^\w\-_.]', '_', sheet_name)
            csv_filename = f"{base_name}_sheet{i+1}_{clean_sheet_name}.csv"
            csv_filepath = temp_path / csv_filename

            # Save DataFrame to CSV
            try:
                df.to_csv(csv_filepath, index=False, encoding='utf-8')
                csv_files.append(csv_filepath)
                logger.info(f"Saved sheet {i+1} '{sheet_name}' to {csv_filename} ({df.shape[0]} rows × {df.shape[1]} columns)")
            except Exception as e:
                logger.error(f"Failed to save sheet '{sheet_name}' as CSV: {str(e)}")
                raise

        return csv_files

    def get_analyzer_info(self) -> dict[str, str]:
        """Return analyzer metadata."""
        return {
            "name": "ExcelAnalyzer",
            "model": self.model_name,
            "description": "Excel file analyzer using Gemini document understanding",
        }
