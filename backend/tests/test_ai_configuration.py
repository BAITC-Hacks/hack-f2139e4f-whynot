import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.mark.parametrize("key,configured", [(None, False), ("", False), ("test-key", True)])
def test_health_reports_loaded_key_presence_without_revealing_it(key, configured):
    app = create_app(
        Settings(
            _env_file=None,
            database_url="sqlite://",
            ai_provider="openai",
            openai_api_key=key,
            demo_mode=False,
        )
    )
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "ai_provider": "openai",
        "openai_configured": configured,
        "demo_mode": False,
    }
    assert "test-key" not in response.text
    assert "OPENAI_API_KEY" not in response.text
