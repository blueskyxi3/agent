"""Build a self-contained SDK v2 process archive on the target platform."""

import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "plugin.json").read_text())
version = os.environ.get("VERSION") or manifest["version"]
if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?", version):
    raise SystemExit("VERSION must be a version such as 1.0.1 or 1.0.1-rc.1")
manifest["version"] = version
node = pathlib.Path(subprocess.check_output(["node", "-p", "process.execPath"], text=True).strip())
major = int(subprocess.check_output([str(node), "-p", "process.versions.node.split('.')[0]"], text=True))
if major < 22:
    raise SystemExit("Node.js 22+ is required")
platform = subprocess.check_output(["go", "env", "GOOS", "GOARCH"], text=True).split()
if len(platform) != 2:
    raise SystemExit("cannot determine Go target platform")

subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
output_dir = ROOT / "dist"
output_dir.mkdir(exist_ok=True)
output = output_dir / f"agent-{version}-{'-'.join(platform)}.zip"

with tempfile.TemporaryDirectory(prefix="agent-package-") as temporary:
    stage = pathlib.Path(temporary)
    runtime = stage / "runtime"
    runtime.mkdir()
    shutil.copy2(node, runtime / "node")
    for source in ["package.json", "package-lock.json", "apps/server/package.json", "apps/web/package.json", "packages/contracts/package.json"]:
        destination = runtime / source
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / source, destination)
    for source in ["apps/server/dist", "apps/web/dist", "packages/contracts/dist", "node_modules"]:
        shutil.copytree(ROOT / source, runtime / source, symlinks=False)
    subprocess.run(["npm", "prune", "--omit=dev", "--ignore-scripts", "--offline"], cwd=runtime, check=True)
    contracts_link = runtime / "node_modules/@ai-hub-agent/contracts"
    if contracts_link.is_symlink():
        contracts_link.unlink()
    elif contracts_link.exists():
        shutil.rmtree(contracts_link)
    shutil.copytree(runtime / "packages/contracts", contracts_link)
    executable = stage / "agent"
    build_env = os.environ.copy()
    build_env.setdefault("GOCACHE", str(pathlib.Path(tempfile.gettempdir()) / "ai-hub-go-cache"))
    subprocess.run(["go", "build", "-ldflags", f"-X main.version={version}", "-o", str(executable), "./launcher"], cwd=ROOT, check=True, env=build_env)
    with zipfile.ZipFile(executable, "a", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as embedded:
        for file in sorted(runtime.rglob("*")):
            if file.is_file():
                embedded.write(file, "runtime/" + file.relative_to(runtime).as_posix())
    if executable.stat().st_size > 150 << 20:
        raise SystemExit("agent process binary exceeds the marketplace 150 MiB limit")
    subprocess.run(["go", "version", "-m", str(executable)], check=True, stdout=subprocess.DEVNULL)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.write(executable, "agent")
        package.writestr("plugin.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        package.write(ROOT / "config.example.yaml", "config.yaml")
print(output)
