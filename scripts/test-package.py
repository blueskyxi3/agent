"""Verify a native process archive without an AI Hub checkout or system Node."""

import json
import os
import pathlib
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile


package_path = os.environ.get("AGENT_TEST_PACKAGE")
if not package_path:
    raise SystemExit("set AGENT_TEST_PACKAGE to a native agent ZIP")

with tempfile.TemporaryDirectory(prefix="agent-package-test-") as temporary:
    root = pathlib.Path(temporary)
    executable = root / "agent"
    with zipfile.ZipFile(package_path) as archive:
        manifest = json.loads(archive.read("plugin.json"))
        executable.write_bytes(archive.read("agent"))
    executable.chmod(0o700)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    secret = "agent-package-verification-secret-2026"
    config_path = root / "config.yaml"
    config_path.write_text(json.dumps({
        "plugin": {"id": "agent"},
        "server": {"address": f"127.0.0.1:{port}"},
        "host": {"base_url": "http://127.0.0.1:3000", "secret": secret},
        "database": {"sqlite_path": str(root / "data" / "agent.sqlite")},
    }))
    base_url = f"http://127.0.0.1:{port}"
    environment = {**os.environ, "PATH": "/nonexistent"}
    for attempt in range(2):
        process = subprocess.Popen([str(executable), "--config", str(config_path)], cwd=root, env=environment)
        try:
            deadline = time.monotonic() + 30
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f"Agent exited before readiness: {process.returncode}")
                try:
                    with urllib.request.urlopen(base_url + "/api/v1/health", timeout=1) as response:
                        health = json.load(response)
                    break
                except (urllib.error.URLError, TimeoutError):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.1)
            assert health["success"] and health["data"]["version"] == manifest["version"]
            request = urllib.request.Request(base_url + "/internal/manifest", headers={"X-AIHub-Plugin-Secret": secret})
            with urllib.request.urlopen(request, timeout=3) as response:
                installed = json.load(response)
            assert installed == manifest
            with urllib.request.urlopen(base_url + "/assets/plugin.js", timeout=3) as response:
                assert response.status == 200 and response.read()
            marker = root / "runtime" / manifest["version"] / ".complete"
            assert marker.read_text() == manifest["version"]
        finally:
            process.terminate()
            process.wait(timeout=10)
    assert (root / "data" / "agent.sqlite").is_file()
print(f"Verified native Agent {manifest['version']}: startup, assets, SQLite, and restart without system Node")
