"""Exercise the remote deploy shell with fake Docker/curl; never contact a server."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

import pytest

from app.chaoxing.runtime import server_command

ROOT = Path(__file__).resolve().parents[2]


def test_worker_count_matches_connector_mode():
    assert server_command(True)[-2:] == ["--workers", "1"]
    assert server_command(False)[-2:] == ["--workers", "2"]


def test_chromium_download_uses_direct_chrome_for_testing_archive():
    dockerfile = (ROOT / "backend/Dockerfile").read_text()
    compose = (ROOT / "docker-compose.yml").read_text()

    assert "ARG CHROMIUM_FOR_TESTING_DOWNLOAD_HOST=" in dockerfile
    assert '"${CHROMIUM_FOR_TESTING_DOWNLOAD_HOST}/${chromium_version}/${platform}/${archive}"' in dockerfile
    assert '"https://cdn.playwright.dev/builds/cft/${chromium_version}/${platform}/${archive}"' in dockerfile
    assert "python -m playwright install-deps chromium" in dockerfile
    assert "EXAM_CHAOXING_BROWSER_EXECUTABLE: /usr/local/bin/chaoxing-chromium" in compose
    assert "CHROMIUM_FOR_TESTING_DOWNLOAD_HOST:" in compose
    assert "cdn.npmmirror.com/binaries/chrome-for-testing" in compose


@pytest.fixture
def deployment(tmp_path):
    app = tmp_path / "app"
    env_dir = app / "shared/env"
    nginx = app / "shared/nginx"
    env_dir.mkdir(parents=True)
    nginx.mkdir()
    backend_env = env_dir / "backend.env"
    backend_env.write_text("EXAM_SECRET_KEY=retain-this-value\n")
    (env_dir / "database.env").write_text("POSTGRES_USER=test\nPOSTGRES_DB=test\n")
    (env_dir / "deploy.env").write_text("COMPOSE_PROJECT_NAME=test\n")
    for slot in ("active_slot", "active_backend_slot", "active_frontend_slot"):
        (nginx / slot).write_text("blue\n")
    (nginx / "default.conf").write_text("previous nginx configuration\n")
    previous = app / "releases/old"
    previous.mkdir(parents=True)
    (app / "current").symlink_to(previous)
    release = tmp_path / "release"
    (release / "deploy/nginx").mkdir(parents=True)
    (release / "deploy/nginx/default.conf.template").write_text("backend=__BACKEND_SLOT__ frontend=__FRONTEND_SLOT__\n")
    archive = tmp_path / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as f:
        f.add(release, arcname=".")
    binary = tmp_path / "bin"
    binary.mkdir()
    events = tmp_path / "events.jsonl"
    docker = binary / "docker"
    docker.write_text(
        f"#!{sys.executable}\n"
        + r"""
import json, os, signal, sys
from pathlib import Path
a = sys.argv[1:]
with open(os.environ['EVENTS'], 'a') as f:
    f.write(json.dumps(a) + '\n')
if 'ps' in a:
    print('container-id')
elif 'inspect' in a:
    print('healthy')
elif 'run' in a and 'app.chaoxing.runtime' in a:
    if os.environ.get('FAIL_AT') == 'preflight': sys.exit(1)
    backend = Path(os.environ['APP_ROOT']) / 'shared/env/backend.env'
    enabled = 'EXAM_CHAOXING_ENABLED=false' not in backend.read_text()
    print('enabled' if enabled else 'disabled')
elif 'exec' in a and 'python' in a:
    print(os.environ.get('OLD_MODE', 'disabled'))
elif 'up' in a and 'backend_green' in a and os.environ.get('FAIL_AT') == 'start':
    sys.exit(1)
elif 'up' in a and 'backend_green' in a and os.environ.get('FAIL_AT') == 'interrupt':
    os.kill(os.getppid(), signal.SIGHUP)
"""
    )
    docker.chmod(0o755)
    curl = binary / "curl"
    curl.write_text('#!/bin/sh\n[ "${FAIL_AT:-}" != smoke ]\n')
    curl.chmod(0o755)
    # Keep the harness portable on macOS; real deployment runs these on Linux.
    hostname = binary / "hostname"
    hostname.write_text('#!/bin/sh\nprintf "127.0.0.1\\n"\n')
    hostname.chmod(0o755)
    xargs = binary / "xargs"
    xargs.write_text("#!/bin/sh\ncat >/dev/null\n")
    xargs.chmod(0o755)
    script = (ROOT / "scripts/deploy.sh").read_text().split("<<'REMOTE'\n", 1)[1].rsplit("\nREMOTE", 1)[0]
    remote = tmp_path / "remote.sh"
    remote.write_text(script)

    def run(*, target="backend", fail="", old="disabled"):
        env = {
            **os.environ,
            "PATH": f"{binary}:{os.environ['PATH']}",
            "APP_ROOT": str(app),
            "REMOTE_ARCHIVE": str(archive),
            "DEPLOY_TARGET": target,
            "DEPLOY_PORT": "3036",
            "DEPLOY_PRUNE_IMAGES": "0",
            "DEPLOY_PRUNE_BUILDER": "0",
            "EVENTS": str(events),
            "FAIL_AT": fail,
            "OLD_MODE": old,
        }
        result = subprocess.run(["bash", str(remote)], env=env, capture_output=True, text=True, timeout=10)
        calls = [json.loads(line) for line in events.read_text().splitlines()]
        return result, calls

    return run, backend_env, nginx, app, previous


def index(calls, *words):
    return next(i for i, c in enumerate(calls) if all(w in c for w in words))


def test_upgrade_adds_default_and_stops_old_before_starting_new(deployment):
    run, backend_env, nginx, _, _ = deployment
    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert backend_env.read_text().count("EXAM_CHAOXING_ENABLED=true") == 1
    assert "EXAM_SECRET_KEY=retain-this-value" in backend_env.read_text()
    check = index(calls, "run", "app.chaoxing.runtime", "check")
    migrate = index(calls, "run", "alembic")
    stop_old = index(calls, "stop", "backend_blue")
    start_new = index(calls, "up", "backend_green")
    assert check < migrate < stop_old < start_new
    assert (nginx / "active_backend_slot").read_text().strip() == "green"
    assert not any("prune" in c for c in calls)


def test_nginx_switch_does_not_start_or_pull_its_dependencies(deployment):
    run, _, _, _, _ = deployment
    result, calls = run()

    assert result.returncode == 0, result.stderr
    assert index(calls, "up", "--no-deps", "nginx")


def test_interrupted_handoff_restores_the_previous_backend_and_proxy(deployment):
    run, _, nginx, app, previous = deployment
    result, calls = run(fail="interrupt", old="enabled")

    assert result.returncode != 0
    assert index(calls, "up", "backend_green") < index(calls, "start", "backend_blue")
    assert (nginx / "default.conf").read_text() == "previous nginx configuration\n"
    assert (app / "current").resolve() == previous


def test_explicit_disable_preserved_with_normal_blue_green(deployment):
    run, backend_env, _, _, _ = deployment
    backend_env.write_text("EXAM_CHAOXING_ENABLED=false\n")
    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert backend_env.read_text() == "EXAM_CHAOXING_ENABLED=false\n"
    assert index(calls, "up", "backend_green") < index(calls, "stop", "backend_blue")


def test_disabling_previously_enabled_connector_still_hands_off(deployment):
    run, backend_env, _, _, _ = deployment
    backend_env.write_text("EXAM_CHAOXING_ENABLED=false\n")
    result, calls = run(old="enabled")
    assert result.returncode == 0, result.stderr
    assert index(calls, "stop", "backend_blue") < index(calls, "up", "backend_green")


@pytest.mark.parametrize("fail", ["start", "smoke"])
def test_failure_restores_previous_container_and_proxy(deployment, fail):
    run, _, nginx, app, previous = deployment
    result, calls = run(fail=fail, old="enabled")
    assert result.returncode != 0
    assert index(calls, "up", "backend_green") < index(calls, "start", "backend_blue")
    assert (nginx / "default.conf").read_text() == "previous nginx configuration\n"
    assert (nginx / "active_backend_slot").read_text().strip() == "blue"
    assert (app / "current").resolve() == previous
    assert not any("rm" in c and "backend_blue" in c for c in calls)


def test_failed_browser_check_does_not_stop_live_backend_or_migrate(deployment):
    run, _, _, _, _ = deployment
    result, calls = run(fail="preflight")
    assert result.returncode != 0
    assert not any("stop" in c and "backend_blue" in c for c in calls)
    assert not any("alembic" in c for c in calls)


def test_frontend_only_does_not_change_connector_config_or_restart_backend(deployment):
    run, backend_env, _, _, _ = deployment
    result, calls = run(target="frontend")
    assert result.returncode == 0, result.stderr
    assert "EXAM_CHAOXING_ENABLED" not in backend_env.read_text()
    assert not any("python" in c or ("stop" in c and "backend_blue" in c) for c in calls)


def test_app_builds_frontend_before_interrupting_backend(deployment):
    run, _, nginx, _, _ = deployment
    # Mixed active slots are valid after a frontend-only deployment.
    (nginx / "active_frontend_slot").write_text("green\n")
    result, calls = run(target="app")
    assert result.returncode == 0, result.stderr
    assert index(calls, "build", "frontend_blue") < index(calls, "stop", "backend_blue")
    assert not any("build" in c and "frontend_green" in c for c in calls)
