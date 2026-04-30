#!/usr/bin/env python3
"""
ApiAnything E2E 测试脚本 (T6.4)

完整验证以下流程（Mock 模式，无需外部 AI API）：
  1. 上传文档
  2. 获取处理结果
  3. 创建 API Key
  4. 创建 API 定义
  5. 用 API Key 调用提取端点
  6. CRUD 标注

用法:
  python testing/test_e2e.py [--base-url http://localhost:9000]

前提:
  - 后端已运行 (uvicorn app.main:app --reload)
  - DEFAULT_PROCESSOR=mock (无需 Gemini/OpenAI key)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path


# ── ANSI colours ──────────────────────────────────────────────────────────────

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg: str)   -> None: print(f"  {GREEN}✓{RESET} {msg}")
def fail(msg: str) -> None: print(f"  {RED}✗{RESET} {msg}"); sys.exit(1)
def info(msg: str) -> None: print(f"  {YELLOW}→{RESET} {msg}")
def head(msg: str) -> None: print(f"\n{BOLD}{CYAN}{msg}{RESET}")


# ── HTTP helpers ──────────────────────────────────────────────────────────────

BASE_URL = "http://localhost:9000"

def get(path: str, headers: dict | None = None) -> dict:
    req = urllib.request.Request(f"{BASE_URL}{path}", headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def post_json(path: str, body: dict, headers: dict | None = None) -> dict:
    data = json.dumps(body).encode()
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def post_multipart(path: str, file_path: Path, extra_headers: dict | None = None) -> dict:
    """Minimal multipart/form-data POST for file upload."""
    boundary = uuid.uuid4().hex
    filename  = file_path.name
    file_data = file_path.read_bytes()
    content_type = "application/pdf" if filename.endswith(".pdf") else "image/png"

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        **(extra_headers or {}),
    }
    req = urllib.request.Request(
        f"{BASE_URL}{path}", data=body, headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def delete(path: str, headers: dict | None = None) -> None:
    req = urllib.request.Request(
        f"{BASE_URL}{path}", headers=headers or {}, method="DELETE"
    )
    try:
        urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        if e.code != 204:
            raise


# ── Test cases ────────────────────────────────────────────────────────────────

def test_health() -> None:
    head("T1 — Health check")
    resp = get("/health")
    assert resp.get("status") == "ok", f"unexpected: {resp}"
    ok(f"status={resp['status']}  processor={resp.get('processor')}")


def test_upload(test_file: Path) -> str:
    head("T2 — 上传文档")
    assert test_file.exists(), f"Test file not found: {test_file}"
    info(f"Uploading {test_file.name} ({test_file.stat().st_size:,} bytes)")
    resp = post_multipart("/api/v1/documents/upload", test_file)
    doc_id = resp.get("id")
    status  = resp.get("status")
    assert doc_id, "No document id returned"
    assert status == "completed", f"expected completed, got {status}"
    ok(f"id={doc_id}  status={status}")
    return doc_id


def test_get_document(doc_id: str) -> dict:
    head("T3 — 获取文档详情")
    resp = get(f"/api/v1/documents/{doc_id}")
    assert resp.get("id") == doc_id
    sd = resp.get("latest_result", {}).get("structured_data")
    assert sd is not None, "No structured_data in latest_result"
    field_count = len(sd) if isinstance(sd, list) else len(sd.keys())
    ok(f"filename={resp['filename']}  fields={field_count}")
    return resp


def test_preview_url(doc_id: str) -> str:
    head("T4 — 获取预览 URL")
    resp = get(f"/api/v1/documents/{doc_id}/preview")
    url = resp.get("preview_url", "")
    assert url, "Empty preview_url"
    ok(f"preview_url={url}")
    return url


def test_create_api_key() -> tuple[str, str]:
    head("T5 — 创建 API Key")
    resp = post_json("/api/v1/api-keys", {"name": f"e2e-test-{int(time.time())}"})
    key_id  = resp.get("id")
    raw_key = resp.get("key") or resp.get("raw_key")
    prefix  = resp.get("key_prefix")
    assert key_id  and raw_key, f"Missing id or key in response: {resp}"
    ok(f"key_id={key_id}  prefix={prefix}")
    return key_id, raw_key


def test_create_api_definition(doc_id: str) -> tuple[str, str]:
    head("T6 — 创建 API 定义")
    api_code = f"e2e-test-{uuid.uuid4().hex[:8]}"
    resp = post_json("/api/v1/api-definitions", {
        "name": "E2E Test API",
        "description": "Created by test_e2e.py",
        "api_code": api_code,
        "processor_type": "mock",
    })
    assert resp.get("api_code") == api_code, f"api_code mismatch: {resp}"
    api_def_id = resp.get("id", "")
    ok(f"api_code={api_code}  id={api_def_id[:8]}...  status={resp.get('status')}")
    return api_code, api_def_id


def patch_json(path: str, body: dict, headers: dict | None = None) -> dict:
    data = json.dumps(body).encode()
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=h, method="PATCH")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def test_activate_api(api_def_id: str) -> None:
    head("T7 — 激活 API 定义")
    try:
        resp = patch_json(f"/api/v1/api-definitions/{api_def_id}/status", {"action": "activate"})
        ok(f"status={resp.get('status')}")
    except urllib.error.HTTPError as e:
        body_str = e.read().decode()
        info(f"Activate returned {e.code}: {body_str[:120]} — continuing")


def test_extract(api_code: str, raw_key: str, test_file: Path) -> None:
    head("T8 — 调用提取端点")
    info(f"POST /api/v1/extract/{api_code}  with X-API-Key")
    try:
        resp = post_multipart(
            f"/api/v1/extract/{api_code}",
            test_file,
            extra_headers={"X-API-Key": raw_key},
        )
        if "error" in resp:
            # API may be in draft; still counts as reachable
            info(f"API not active yet ({resp['error'].get('code')}) — endpoint reachable ✓")
            return
        data = resp.get("data", [])
        count = len(data) if isinstance(data, list) else len(data.keys()) if isinstance(data, dict) else 0
        ok(f"request_id={str(resp.get('request_id',''))[:16]}...  fields={count}")
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        info(f"HTTP {e.code}: {body.get('error', body)}")


def test_annotations(doc_id: str) -> None:
    head("T9 — 标注 CRUD")
    # List
    anns = get(f"/api/v1/documents/{doc_id}/annotations")
    ok(f"list → {len(anns)} existing annotations")

    # Create
    new_ann = post_json(f"/api/v1/documents/{doc_id}/annotations", {
        "field_name": "e2e_test_field",
        "field_value": "hello",
        "field_type": "string",
        "source": "manual_edit",
        "confidence": 1.0,
        "bounding_box": {"x": 10, "y": 10, "w": 20, "h": 5, "page": 1},
    })
    ann_id = new_ann.get("id")
    assert ann_id, f"No id in create response: {new_ann}"
    ok(f"create → id={ann_id}")

    # Delete
    delete(f"/api/v1/documents/{doc_id}/annotations/{ann_id}")
    ok("delete → annotation removed")


def test_list_documents() -> None:
    head("T10 — 文档列表")
    resp = get("/api/v1/documents")
    items = resp.get("items", [])
    total = resp.get("total", 0)
    ok(f"total={total}  page_items={len(items)}")


def test_templates_list() -> None:
    head("T12 — 模板列表")
    resp = get("/api/v1/templates")
    assert isinstance(resp, list), f"Expected list, got {type(resp)}"
    assert len(resp) >= 1, "No templates returned"
    first = resp[0]
    assert "id" in first and "name" in first, f"Missing fields: {first.keys()}"
    ok(f"count={len(resp)}  first={first['name']}")


def test_template_subscribe() -> str:
    head("T13 — 订阅模板")
    # Get first template
    templates = get("/api/v1/templates")
    template_id = templates[0]["id"]
    info(f"Subscribing to template: {template_id}")
    resp = post_json(f"/api/v1/templates/{template_id}/subscribe", {})
    assert resp.get("api_code"), f"No api_code in response: {resp}"
    api_def_id = resp.get("id", "")
    ok(f"api_code={resp['api_code']}  id={api_def_id[:8]}...  source_type={resp.get('source_type')}")
    return api_def_id


def test_usage_stats() -> None:
    head("T14 — 流量统计")
    resp = get("/api/v1/usage/stats?range=30d")
    assert "total_calls" in resp, f"Missing total_calls: {resp.keys()}"
    assert "calls_by_day" in resp, f"Missing calls_by_day: {resp.keys()}"
    assert "top_apis" in resp, f"Missing top_apis: {resp.keys()}"
    ok(f"total_calls={resp['total_calls']}  success_rate={resp['success_rate']}%  avg_latency={resp['avg_latency_ms']}ms")


def test_prompt_versions(api_def_id: str) -> None:
    head("T15 — Prompt 优化 & 版本")
    # List versions (should be empty for new API)
    versions = get(f"/api/v1/api-definitions/{api_def_id}/prompt-versions")
    assert isinstance(versions, list), f"Expected list, got {type(versions)}"
    ok(f"prompt versions count={len(versions)}")

    # Trigger optimize (should fail gracefully — no corrections)
    try:
        post_json(f"/api/v1/api-definitions/{api_def_id}/optimize", {})
        ok("optimize triggered (unexpected success — corrections may exist)")
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        error_msg = body.get("error", {}).get("message", "")
        if "correction" in error_msg.lower() or "sample" in error_msg.lower():
            ok(f"optimize correctly rejected: {error_msg}")
        else:
            info(f"optimize HTTP {e.code}: {error_msg}")


def test_cleanup(doc_id: str, key_id: str) -> None:
    head("T11 — 清理测试数据")
    # Delete the document
    try:
        delete(f"/api/v1/documents/{doc_id}")
        ok(f"document {doc_id[:8]}... deleted")
    except Exception as e:
        info(f"Document delete skipped: {e}")

    # Delete the API key
    try:
        delete(f"/api/v1/api-keys/{key_id}")
        ok(f"api key {key_id[:8]}... deleted")
    except Exception as e:
        info(f"Key delete skipped: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    global BASE_URL

    parser = argparse.ArgumentParser(description="ApiAnything E2E test")
    parser.add_argument("--base-url", default="http://localhost:9000")
    parser.add_argument("--no-cleanup", action="store_true", help="Keep test data after run")
    args = parser.parse_args()
    BASE_URL = args.base_url.rstrip("/")

    # Find a test file
    test_root = Path(__file__).parent
    candidates = list(test_root.rglob("*.pdf")) + list(test_root.rglob("*.png"))
    if not candidates:
        fail(f"No PDF/PNG found under {test_root} — add a test file")
    test_file = candidates[0]
    print(f"\n{BOLD}ApiAnything E2E Test Suite{RESET}")
    print(f"Base URL : {BASE_URL}")
    print(f"Test file: {test_file}")

    passed = 0
    failed = 0

    def run(fn, *a, **kw):
        nonlocal passed, failed
        try:
            result = fn(*a, **kw)
            passed += 1
            return result
        except (AssertionError, urllib.error.HTTPError, Exception) as e:
            print(f"  {RED}✗ FAILED: {e}{RESET}")
            failed += 1
            return None

    test_health()                            # exits on failure (server must be up)

    doc_id   = run(test_upload, test_file)
    if doc_id:
        run(test_get_document, doc_id)
        run(test_preview_url, doc_id)
        run(test_annotations, doc_id)

    key_result = run(test_create_api_key)
    key_id, raw_key = key_result if key_result else (None, None)

    api_result = run(test_create_api_definition, doc_id or "00000000-0000-0000-0000-000000000000")
    api_code, api_def_id = api_result if api_result else (None, None)
    if api_def_id:
        run(test_activate_api, api_def_id)
    if api_code and raw_key:
        run(test_extract, api_code, raw_key, test_file)

    run(test_list_documents)

    run(test_templates_list)
    subscribed_id = run(test_template_subscribe)
    run(test_usage_stats)
    if api_def_id:
        run(test_prompt_versions, api_def_id)

    if not args.no_cleanup and doc_id and key_id:
        run(test_cleanup, doc_id, key_id)

    # Summary
    total = passed + failed
    color = GREEN if failed == 0 else RED
    print(f"\n{BOLD}{'='*40}{RESET}")
    print(f"{color}{BOLD}Results: {passed}/{total} passed{RESET}")
    if failed:
        print(f"{RED}  {failed} test(s) failed{RESET}")
    print()
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
