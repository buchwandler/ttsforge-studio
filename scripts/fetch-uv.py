#!/usr/bin/env python3
"""Fetch the pinned uv sidecar for the current Tauri/Rust target.

Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

UV_VERSION = "0.13.7"
BASE = f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}"

ASSETS = {
    "x86_64-unknown-linux-gnu": "uv-x86_64-unknown-linux-gnu.tar.gz",
    "aarch64-unknown-linux-gnu": "uv-aarch64-unknown-linux-gnu.tar.gz",
    "x86_64-apple-darwin": "uv-x86_64-apple-darwin.tar.gz",
    "aarch64-apple-darwin": "uv-aarch64-apple-darwin.tar.gz",
    "x86_64-pc-windows-msvc": "uv-x86_64-pc-windows-msvc.zip",
    "aarch64-pc-windows-msvc": "uv-aarch64-pc-windows-msvc.zip",
}


def host_target() -> str:
    try:
        output = subprocess.check_output(
            ["rustc", "--print", "host-tuple"], text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        try:
            output = subprocess.check_output(["rustc", "-vV"], text=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            raise SystemExit(
                "rustc is required to infer the Tauri target; pass --target explicitly."
            ) from exc
        for line in output.splitlines():
            if line.startswith("host: "):
                return line.partition(": ")[2].strip()
        raise SystemExit("Could not determine rustc host target.")
    if not output:
        raise SystemExit("rustc returned an empty host target.")
    return output


def download(url: str, destination: Path) -> None:
    print(f"Downloading {url}")
    with urllib.request.urlopen(url) as source, destination.open("wb") as sink:
        shutil.copyfileobj(source, sink)


def expected_sha(text: str) -> str:
    first = text.strip().split()[0]
    if len(first) != 64:
        raise SystemExit("Published checksum file did not contain a SHA-256 hash.")
    return first.lower()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def extract_uv(archive: Path, out: Path, windows: bool) -> None:
    wanted = "uv.exe" if windows else "uv"
    with tempfile.TemporaryDirectory() as temp_name:
        temp = Path(temp_name)
        if archive.suffix == ".zip":
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(temp)
        else:
            with tarfile.open(archive, "r:gz") as tf:
                tf.extractall(temp)

        candidates = [p for p in temp.rglob(wanted) if p.is_file()]
        if not candidates:
            raise SystemExit(f"{wanted} was not found in {archive.name}.")
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidates[0], out)
        if not windows:
            out.chmod(0o755)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=None)
    parser.add_argument("--version", default=UV_VERSION)
    args = parser.parse_args()

    if args.version != UV_VERSION:
        raise SystemExit(
            f"This MVP is pinned to uv {UV_VERSION}; update the script and runtime manifest together."
        )

    target = args.target or host_target()
    asset = ASSETS.get(target)
    if asset is None:
        raise SystemExit(
            f"Unsupported target {target!r}. Supported: {', '.join(sorted(ASSETS))}"
        )

    root = Path(__file__).resolve().parents[1]
    extension = ".exe" if "windows" in target else ""
    destination = root / "src-tauri" / "binaries" / f"uv-{target}{extension}"

    with tempfile.TemporaryDirectory() as temp_name:
        temp = Path(temp_name)
        archive = temp / asset
        checksum = temp / f"{asset}.sha256"
        download(f"{BASE}/{asset}", archive)
        download(f"{BASE}/{asset}.sha256", checksum)

        expected = expected_sha(checksum.read_text(encoding="utf-8"))
        actual = sha256(archive)
        if actual != expected:
            raise SystemExit(
                f"SHA-256 mismatch for {asset}: expected {expected}, got {actual}"
            )

        extract_uv(archive, destination, "windows" in target)

    print(f"Staged uv {UV_VERSION}: {destination}")


if __name__ == "__main__":
    main()
