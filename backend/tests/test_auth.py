"""Auth endpoint tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_register_creates_user_returns_token(client):
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "alice@x.com", "password": "secret123", "display_name": "Alice"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["token"]
    assert data["user"]["email"] == "alice@x.com"
    assert data["user"]["display_name"] == "Alice"


@pytest.mark.asyncio
async def test_register_duplicate_email_409(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "dup@x.com", "password": "secret123", "display_name": "A"},
    )
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "dup@x.com", "password": "secret123", "display_name": "B"},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "email_already_registered"


@pytest.mark.asyncio
async def test_login_correct_credentials(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "bob@x.com", "password": "secret123", "display_name": "Bob"},
    )
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "bob@x.com", "password": "secret123"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["token"]


@pytest.mark.asyncio
async def test_login_wrong_password_401(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "carol@x.com", "password": "secret123", "display_name": "C"},
    )
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "carol@x.com", "password": "WRONG"}
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_credentials"


@pytest.mark.asyncio
async def test_me_requires_token(client):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_and_empty_workspaces(client, registered_user):
    user, token = registered_user
    resp = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["user"]["email"] == user["email"]
    assert data["workspaces"] == []
