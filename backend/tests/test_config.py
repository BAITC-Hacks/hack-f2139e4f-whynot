from pathlib import Path

import pytest
from pydantic import SecretStr

from app import config
from app.config import Settings


@pytest.fixture(autouse=True)
def clear_runtime_settings(monkeypatch):
    for field in Settings.model_fields:
        monkeypatch.delenv(field.upper(), raising=False)
        monkeypatch.delenv(field.lower(), raising=False)


@pytest.fixture
def trusted_environment(tmp_path, monkeypatch):
    """Use synthetic configuration only; never inspect the developer's real .env."""
    backend = tmp_path / "project" / "backend"
    backend.mkdir(parents=True)
    env_file = backend / ".env"
    monkeypatch.setitem(Settings.model_config, "env_file", env_file)
    return env_file


def test_default_dotenv_path_is_explicit_backend_directory():
    expected = Path(config.__file__).resolve().parents[1] / ".env"
    assert Path(Settings.model_config["env_file"]).is_absolute()
    assert Path(Settings.model_config["env_file"]) == expected
    assert Settings.model_config["env_file_encoding"] == "utf-8-sig"


@pytest.mark.parametrize("directory", ["project", "backend", "foreign"])
def test_cwd_does_not_change_trusted_dotenv_or_load_nearby_key(
    trusted_environment,
    monkeypatch,
    tmp_path,
    directory,
):
    trusted_environment.write_text("OPENAI_API_KEY=synthetic-trusted-key\n", encoding="utf-8")
    choices = {
        "project": trusted_environment.parent.parent,
        "backend": trusted_environment.parent,
        "foreign": tmp_path / "foreign",
    }
    current = choices[directory]
    current.mkdir(exist_ok=True)
    if directory != "backend":
        (current / ".env").write_text("OPENAI_API_KEY=synthetic-untrusted-key\n", encoding="utf-8")
    monkeypatch.chdir(current)
    settings = Settings()
    assert settings.openai_api_key.get_secret_value() == "synthetic-trusted-key"
    assert settings.database_url == "sqlite:///./data/ai_sana.db"
    assert settings.mail_outbox_dir == "data/outbox"


def test_windows_bom_and_surrounding_whitespace_load_correctly(trusted_environment):
    trusted_environment.write_text(
        'OPENAI_API_KEY="  synthetic-bom-key  "\nAI_PROVIDER=openai\n',
        encoding="utf-8-sig",
    )
    settings = Settings()
    assert settings.openai_api_key.get_secret_value() == "synthetic-bom-key"
    assert settings.ai_provider == "openai"


@pytest.mark.parametrize("value", [None, "", "   \t\n", SecretStr(""), SecretStr(" \t")])
def test_blank_or_missing_api_key_becomes_none_without_secret_representation(value):
    settings = Settings(_env_file=None, openai_api_key=value)
    assert settings.openai_api_key is None


def test_blank_dotenv_key_is_not_a_configured_secret(trusted_environment):
    trusted_environment.write_text('OPENAI_API_KEY="   "\n', encoding="utf-8")
    assert Settings().openai_api_key is None


def test_explicit_disable_ignores_dotenv_but_keeps_environment_priority(
    trusted_environment,
    monkeypatch,
):
    trusted_environment.write_text("OPENAI_API_KEY=synthetic-file-key\n", encoding="utf-8")
    assert Settings(_env_file=None).openai_api_key is None
    monkeypatch.setenv("OPENAI_API_KEY", " synthetic-environment-key ")
    assert Settings(_env_file=None).openai_api_key.get_secret_value() == "synthetic-environment-key"


def test_init_then_runtime_environment_then_dotenv_priority(trusted_environment, monkeypatch):
    trusted_environment.write_text("OPENAI_API_KEY=synthetic-file-key\n", encoding="utf-8")
    assert Settings().openai_api_key.get_secret_value() == "synthetic-file-key"
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-environment-key")
    assert Settings().openai_api_key.get_secret_value() == "synthetic-environment-key"
    assert Settings(openai_api_key=" synthetic-init-key ").openai_api_key.get_secret_value() == (
        "synthetic-init-key"
    )
    assert Settings(openai_api_key=None).openai_api_key is None
    monkeypatch.setenv("OPENAI_API_KEY", "   ")
    assert Settings().openai_api_key is None


def test_explicit_env_file_override_still_works(trusted_environment, tmp_path):
    trusted_environment.write_text("OPENAI_API_KEY=synthetic-default-key\n", encoding="utf-8")
    override = tmp_path / "explicit.env"
    override.write_text("OPENAI_API_KEY=synthetic-override-key\n", encoding="utf-8-sig")
    assert (
        Settings(_env_file=override).openai_api_key.get_secret_value() == "synthetic-override-key"
    )


def test_key_stays_secret_in_repr_json_and_output(trusted_environment, caplog, capsys):
    candidate = "synthetic-private-test-key"
    trusted_environment.write_text(f"OPENAI_API_KEY={candidate}\n", encoding="utf-8-sig")
    settings = Settings()
    assert settings.openai_api_key.get_secret_value() == candidate
    assert candidate not in repr(settings)
    assert candidate not in str(settings.model_dump())
    assert candidate not in settings.model_dump_json()
    assert candidate not in caplog.text
    captured = capsys.readouterr()
    assert captured.out == "" and captured.err == ""
