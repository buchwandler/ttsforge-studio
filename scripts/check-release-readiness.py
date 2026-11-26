from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_SECRETS = (
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "KEYCHAIN_PASSWORD",
    "WINDOWS_CERTIFICATE",
    "WINDOWS_CERTIFICATE_PASSWORD",
    "WINDOWS_CERTIFICATE_THUMBPRINT",
)
TAG_PATTERN = re.compile(r"v(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\Z")


def release_readiness_errors(env: dict[str, str], root: Path = ROOT) -> list[str]:
    errors = [f"Missing required secret: {name}" for name in REQUIRED_SECRETS if not env.get(name)]

    thumbprint = env.get("WINDOWS_CERTIFICATE_THUMBPRINT", "")
    if thumbprint and not re.fullmatch(r"[0-9A-Fa-f]{40}", thumbprint):
        errors.append("WINDOWS_CERTIFICATE_THUMBPRINT must contain 40 hexadecimal characters")
    evidence = urlparse(env.get("SMOKE_TEST_EVIDENCE_URL", ""))
    if evidence.scheme != "https" or not evidence.netloc:
        errors.append("SMOKE_TEST_EVIDENCE_URL must be an HTTPS link to Linux, macOS, and Windows smoke-test evidence")

    if env.get("GITHUB_REF_TYPE") != "tag":
        errors.append("Release builds must run from a version tag")
    else:
        tag = TAG_PATTERN.fullmatch(env.get("GITHUB_REF_NAME", ""))
        if not tag:
            errors.append("Release tag must use vMAJOR.MINOR.PATCH naming")
        else:
            package = json.loads((root / "package.json").read_text(encoding="utf-8"))
            tauri = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
            if package["version"] != tag.group("version") or tauri["version"] != tag.group("version"):
                errors.append("Release tag version must match package.json and src-tauri/tauri.conf.json")

    return errors


def main() -> int:
    errors = release_readiness_errors(dict(os.environ))
    if errors:
        print("Release preflight blocked:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Release preflight passed for {os.environ['GITHUB_REF_NAME']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
