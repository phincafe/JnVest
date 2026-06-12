"""Auth hardening tests: rate limiting, timing-safe login, timed sessions,
and the production default-credential boot guard."""

import pytest
from fastapi.testclient import TestClient

from app import main


def make_client() -> TestClient:
    # No context manager on purpose: skips lifespan (bot/alerts loops and the
    # production-credential guard), exercising just the request path.
    return TestClient(main.app)


def test_wrong_password_401_then_rate_limited_429():
    main._login_attempts.clear()
    c = make_client()
    for _ in range(main._LOGIN_MAX_ATTEMPTS):
        r = c.post("/api/auth/login", json={"password": "definitely-wrong"})
        assert r.status_code == 401
    r = c.post("/api/auth/login", json={"password": "definitely-wrong"})
    assert r.status_code == 429
    main._login_attempts.clear()


def test_correct_password_sets_owner_session(monkeypatch):
    main._login_attempts.clear()
    monkeypatch.setattr(main.settings, "app_password", "test-pw")
    c = make_client()
    r = c.post("/api/auth/login", json={"password": "test-pw"})
    assert r.status_code == 200
    assert r.json()["role"] == "owner"
    # Cookie round-trips to owner role on the status endpoint.
    r2 = c.get("/api/auth/status")
    assert r2.json()["role"] == "guest" or r2.json()["role"] == "owner"
    c.cookies.set("jnvest_session", r.cookies["jnvest_session"])
    r3 = c.get("/api/auth/status")
    assert r3.json()["role"] == "owner"


def test_successful_login_resets_rate_limit(monkeypatch):
    main._login_attempts.clear()
    monkeypatch.setattr(main.settings, "app_password", "test-pw")
    c = make_client()
    for _ in range(main._LOGIN_MAX_ATTEMPTS - 1):
        c.post("/api/auth/login", json={"password": "wrong"})
    r = c.post("/api/auth/login", json={"password": "test-pw"})
    assert r.status_code == 200
    assert main._login_attempts == {}


def test_expired_session_token_is_guest(monkeypatch):
    token = main.serializer.dumps("ok")
    # Any age > -1 counts as expired; avoids sleeping in the test.
    monkeypatch.setattr(main, "SESSION_MAX_AGE", -1)
    c = make_client()
    c.cookies.set("jnvest_session", token)
    r = c.get("/api/auth/status")
    assert r.json()["role"] == "guest"


def test_garbage_session_token_is_guest():
    c = make_client()
    c.cookies.set("jnvest_session", "not-a-real-token")
    r = c.get("/api/auth/status")
    assert r.json()["role"] == "guest"


def test_production_guard_rejects_default_credentials(monkeypatch):
    s = main.get_settings()
    monkeypatch.setattr(s, "database_url", "postgresql://prod-db/jnvest")
    monkeypatch.setattr(s, "app_password", main._DEFAULT_PASSWORD)
    with pytest.raises(RuntimeError, match="APP_PASSWORD"):
        main._assert_production_credentials()


def test_production_guard_accepts_real_credentials(monkeypatch):
    s = main.get_settings()
    monkeypatch.setattr(s, "database_url", "postgresql://prod-db/jnvest")
    monkeypatch.setattr(s, "app_password", "a-real-password")
    monkeypatch.setattr(s, "session_secret", "a-real-secret")
    main._assert_production_credentials()  # must not raise


def test_sqlite_dev_allows_defaults(monkeypatch):
    s = main.get_settings()
    monkeypatch.setattr(s, "database_url", "sqlite:///./jnvest.db")
    monkeypatch.setattr(s, "app_password", main._DEFAULT_PASSWORD)
    main._assert_production_credentials()  # must not raise
