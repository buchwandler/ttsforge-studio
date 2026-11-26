from __future__ import annotations

import importlib.util
import io
import stat
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch-uv.py"
SPEC = importlib.util.spec_from_file_location("fetch_uv", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
fetch_uv = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch_uv)


class FetchUvTests(unittest.TestCase):
    def test_runtime_manifest_selects_pinned_uv_release(self) -> None:
        manifest = fetch_uv.load_runtime_manifest()
        self.assertEqual(manifest["uv_version"], "0.13.7")
        self.assertIn(manifest["uv_version"], fetch_uv.RELEASES)

    def test_supported_targets_have_repository_pinned_digests(self) -> None:
        self.assertEqual(
            fetch_uv.RELEASES["0.13.7"],
            {
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
            },
        )

    def test_digest_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "uv.tar.gz"
            archive.write_bytes(b"not the pinned archive")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                fetch_uv.verify_sha256(archive, "0" * 64, archive.name)

    def test_extracts_exact_linux_executable(self) -> None:
        target = "x86_64-unknown-linux-gnu"
        asset, _ = fetch_uv.RELEASES["0.13.7"][target]
        member_name = fetch_uv.expected_member(asset, windows=False)
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / asset
            output = Path(directory) / "bin" / "uv"
            with tarfile.open(archive, "w:gz") as tar:
                info = tarfile.TarInfo(member_name)
                info.size = len(b"uv executable")
                tar.addfile(info, io.BytesIO(b"uv executable"))

            fetch_uv.extract_uv(archive, output, target, asset)

            self.assertEqual(output.read_bytes(), b"uv executable")
            self.assertTrue(output.stat().st_mode & stat.S_IXUSR)

    def test_extracts_exact_windows_executable(self) -> None:
        target = "x86_64-pc-windows-msvc"
        asset, _ = fetch_uv.RELEASES["0.13.7"][target]
        member_name = fetch_uv.expected_member(asset, windows=True)
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / asset
            output = Path(directory) / "bin" / "uv.exe"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr(member_name, b"uv executable")

            fetch_uv.extract_uv(archive, output, target, asset)

            self.assertEqual(output.read_bytes(), b"uv executable")

    def test_tar_path_traversal_and_absolute_members_are_rejected(self) -> None:
        target = "x86_64-unknown-linux-gnu"
        asset, _ = fetch_uv.RELEASES["0.13.7"][target]
        with tempfile.TemporaryDirectory() as directory:
            for index, member_name in enumerate(("../escape", "/absolute/escape")):
                archive = Path(directory) / f"bad-{index}.tar.gz"
                output = Path(directory) / f"out-{index}" / "uv"
                with tarfile.open(archive, "w:gz") as tar:
                    info = tarfile.TarInfo(member_name)
                    info.size = 4
                    tar.addfile(info, io.BytesIO(b"evil"))

                with self.subTest(member_name=member_name):
                    with self.assertRaisesRegex(ValueError, "Unsafe archive member"):
                        fetch_uv.extract_uv(archive, output, target, asset)
                    self.assertFalse(output.exists())

    def test_zip_windows_paths_are_rejected(self) -> None:
        target = "x86_64-pc-windows-msvc"
        asset, _ = fetch_uv.RELEASES["0.13.7"][target]
        with tempfile.TemporaryDirectory() as directory:
            for index, member_name in enumerate(("..\\escape.exe", "C:/absolute.exe")):
                archive = Path(directory) / f"bad-{index}.zip"
                output = Path(directory) / f"out-{index}" / "uv.exe"
                with zipfile.ZipFile(archive, "w") as zipped:
                    zipped.writestr(member_name, b"evil")

                with self.subTest(member_name=member_name):
                    with self.assertRaisesRegex(ValueError, "Unsafe archive member"):
                        fetch_uv.extract_uv(archive, output, target, asset)
                    self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
