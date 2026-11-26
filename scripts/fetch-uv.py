#!/usr/bin/env python3
"""Fetch the manifest-pinned uv sidecar for the current Tauri/Rust target."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import tomllib
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import BinaryIO

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "runtime" / "runtime-manifest.toml"
RELEASES = {
    "0.13.7": {
        "x86_64-unknown-linux-gnu": (
            "uv-x86_64-unknown-linux-gnu.tar.gz",
            "c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83",
        ),
        "aarch64-unknown-linux-gnu": (
            "uv-aarch64-unknown-linux-gnu.tar.gz",
            "71279f8d3c67241e807b9d8db872d1bf541579fb9f08b7d1eb1682196d1e57dc",
        ),
        "x86_64-apple-darwin": (
            "uv-x86_64-apple-darwin.tar.gz",
            "20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7",
        ),
        "aarch64-apple-darwin": (
            "uv-aarch64-apple-darwin.tar.gz",
            "81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731",
        ),
        "x86_64-pc-windows-msvc": (
            "uv-x86_64-pc-windows-msvc.zip",
            "0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021",
        ),
        "aarch64-pc-windows-msvc": (
            "uv-aarch64-pc-windows-msvc.zip",
            "505d9e65e7692bac3ddf98c66754aa26c5050c409c184af30a881a0a72cc85e3",
        ),
    }
}


def load_runtime_manifest(path: Path = MANIFEST_PATH) -> dict[str, object]:
    with path.open("rb") as stream:
        manifest = tomllib.load(stream)
    if not isinstance(manifest.get("uv_version"), str):
        raise ValueError("runtime manifest must define uv_version as a string")
    return manifest


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
    with urllib.request.urlopen(url, timeout=60) as source, destination.open("wb") as sink:
        shutil.copyfileobj(source, sink)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_sha256(path: Path, expected: str, filename: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError(f"Invalid repository-pinned SHA-256 for {filename}.")
    actual = sha256(path)
    if actual != expected:
        raise ValueError(
            f"SHA-256 mismatch for {filename}: expected {expected}, got {actual}"
        )


def validate_member_name(name: str) -> None:
    posix_path = PurePosixPath(name)
    windows_path = PureWindowsPath(name)
    if (
        not name
        or "\\" in name
        or posix_path.is_absolute()
        or windows_path.is_absolute()
        or windows_path.drive
        or ".." in posix_path.parts
        or ".." in windows_path.parts
    ):
        raise ValueError(f"Unsafe archive member path: {name!r}")


def expected_member(asset: str, windows: bool) -> str:
    if windows:
        if not asset.endswith(".zip"):
            raise ValueError(f"Unsupported Windows uv archive: {asset}")
        return "uv.exe"
    if not asset.endswith(".tar.gz"):
        raise ValueError(f"Unsupported uv archive: {asset}")
    directory = asset.removesuffix(".tar.gz")
    return f"{directory}/uv"


def copy_zip_member(archive: zipfile.ZipFile, wanted: str, destination: BinaryIO) -> None:
    matches = []
    for info in archive.infolist():
        validate_member_name(info.filename)
        if info.filename == wanted:
            matches.append(info)
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {wanted!r} executable in uv archive.")

    member = matches[0]
    file_type = stat.S_IFMT(member.external_attr >> 16)
    if member.is_dir() or file_type not in (0, stat.S_IFREG):
        raise ValueError(f"Expected {wanted!r} to be a regular executable file.")
    with archive.open(member) as source:
        shutil.copyfileobj(source, destination)


def copy_tar_member(archive: tarfile.TarFile, wanted: str, destination: BinaryIO) -> None:
    matches = []
    for member in archive.getmembers():
        validate_member_name(member.name)
        if member.name == wanted:
            matches.append(member)
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {wanted!r} executable in uv archive.")

    member = matches[0]
    if not member.isfile():
        raise ValueError(f"Expected {wanted!r} to be a regular executable file.")
    source = archive.extractfile(member)
    if source is None:
        raise ValueError(f"Could not read {wanted!r} from uv archive.")
    with source:
        shutil.copyfileobj(source, destination)


def extract_uv(archive_path: Path, out: Path, target: str, asset: str) -> None:
    windows = target.endswith("windows-msvc")
    wanted = expected_member(asset, windows)
    out.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=out.parent, prefix=f".{out.name}.", delete=False
        ) as destination:
            temporary = Path(destination.name)
            if asset.endswith(".zip"):
                with zipfile.ZipFile(archive_path) as archive:
                    copy_zip_member(archive, wanted, destination)
            else:
                with tarfile.open(archive_path, "r:gz") as archive:
                    copy_tar_member(archive, wanted, destination)
            destination.flush()
        if not windows:
            temporary.chmod(0o755)
        os.replace(temporary, out)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=None)
    parser.add_argument("--version", default=None)
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    args = parser.parse_args()

    try:
        manifest = load_runtime_manifest(args.manifest)
        version = str(manifest["uv_version"])
        if args.version is not None and args.version != version:
            raise ValueError(
                f"uv version is governed by the runtime manifest ({version}), not {args.version}."
            )
        release = RELEASES.get(version)
        if release is None:
            raise ValueError(
                f"No repository-pinned uv digests are available for version {version}."
            )

        target = args.target or host_target()
        platform = release.get(target)
        if platform is None:
            raise ValueError(
                f"Unsupported target {target!r}. Supported: {', '.join(sorted(release))}"
            )
        asset, digest = platform
        destination = ROOT / "src-tauri" / "binaries" / f"uv-{target}"
        if target.endswith("windows-msvc"):
            destination = destination.with_suffix(".exe")

        with tempfile.TemporaryDirectory() as temp_name:
            archive = Path(temp_name) / asset
            download(f"https://github.com/astral-sh/uv/releases/download/{version}/{asset}", archive)
            verify_sha256(archive, digest, asset)
            extract_uv(archive, destination, target, asset)
    except (KeyError, OSError, tarfile.TarError, ValueError, zipfile.BadZipFile) as exc:
        raise SystemExit(f"Could not stage uv: {exc}") from exc

    print(f"Staged uv {version}: {destination}")


if __name__ == "__main__":
    main()
