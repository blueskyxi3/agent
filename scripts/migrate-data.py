"""Copy stopped Agent history into a plugin data directory with a verified backup."""

import argparse
import hashlib
import pathlib
import shutil
import sqlite3
import tempfile


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def database_counts(path):
    with sqlite3.connect(str(path)) as database:
        if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError(f"SQLite integrity check failed: {path}")
        return tuple(database.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in ("threads", "messages"))


def copy_history(source, target):
    target.mkdir(mode=0o700)
    with sqlite3.connect(str(source / "agent.sqlite")) as old, sqlite3.connect(str(target / "agent.sqlite")) as new:
        old.backup(new)
    for path in source.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"symlink in Agent data: {path}")
        relative = path.relative_to(source)
        if relative.as_posix() in {"agent.sqlite", "agent.sqlite-wal", "agent.sqlite-shm"}:
            continue
        destination = target / relative
        if path.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)


def verify_copy(source, target):
    if database_counts(source / "agent.sqlite") != database_counts(target / "agent.sqlite"):
        raise ValueError("Agent thread or message count changed during migration")
    for path in source.rglob("*"):
        if not path.is_file() or path.name in {"agent.sqlite", "agent.sqlite-wal", "agent.sqlite-shm"}:
            continue
        if file_hash(path) != file_hash(target / path.relative_to(source)):
            raise ValueError(f"Agent attachment differs: {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path, help="stopped legacy AGENT_DATA_DIR")
    parser.add_argument("destination", type=pathlib.Path, help="plugin AGENT_DATA_DIR before installation")
    parser.add_argument("backup", type=pathlib.Path, help="new backup directory")
    args = parser.parse_args()
    source, destination, backup = (p.resolve() for p in (args.source, args.destination, args.backup))
    if not (source / "agent.sqlite").is_file():
        parser.error("source agent.sqlite is missing")
    if destination.exists() or backup.exists():
        parser.error("destination and backup must not already exist")
    if len({source, destination, backup}) != 3 or any(a in b.parents for a in (source, destination, backup) for b in (source, destination, backup) if a != b):
        parser.error("source, destination and backup must be separate directories")
    counts = database_counts(source / "agent.sqlite")
    with tempfile.TemporaryDirectory(prefix="agent-migration-") as temporary:
        stage = pathlib.Path(temporary)
        snapshot = stage / "backup"
        copy_history(source, snapshot)
        verify_copy(source, snapshot)
        migrated = stage / "destination"
        shutil.copytree(snapshot, migrated)
        verify_copy(source, migrated)
        backup.parent.mkdir(parents=True, exist_ok=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(snapshot), backup)
        shutil.move(str(migrated), destination)
    print(f"migrated {counts[0]} threads and {counts[1]} messages; backup: {backup}")


if __name__ == "__main__":
    main()
