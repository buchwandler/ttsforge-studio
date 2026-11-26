import unittest
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_release = runpy.run_path(str(ROOT / "scripts/check-release-readiness.py"))
REQUIRED_SECRETS = _release["REQUIRED_SECRETS"]
release_readiness_errors = _release["release_readiness_errors"]


class ReleaseReadinessTests(unittest.TestCase):
    def ready_environment(self):
        return {
            **{name: "configured" for name in REQUIRED_SECRETS},
            "WINDOWS_CERTIFICATE_THUMBPRINT": "A" * 40,
            "SMOKE_TEST_EVIDENCE_URL": "https://example.com/smoke-tests",
            "GITHUB_REF_TYPE": "tag",
            "GITHUB_REF_NAME": "v0.1.0",
        }

    def test_fails_closed_when_signing_secrets_are_missing(self):
        errors = release_readiness_errors({"GITHUB_REF_TYPE": "branch"}, ROOT)
        self.assertIn("Missing required secret: APPLE_CERTIFICATE", errors)
        self.assertIn("Missing required secret: WINDOWS_CERTIFICATE", errors)
        self.assertTrue(any("smoke-test evidence" in error for error in errors))

    def test_rejects_missing_smoke_evidence_and_non_tag_dispatch(self):
        env = self.ready_environment()
        env["SMOKE_TEST_EVIDENCE_URL"] = ""
        env["GITHUB_REF_TYPE"] = "branch"
        errors = release_readiness_errors(env, ROOT)
        self.assertTrue(any("SMOKE_TEST_EVIDENCE_URL" in error for error in errors))
        self.assertTrue(any("version tag" in error for error in errors))

    def test_rejects_a_tag_that_does_not_match_the_app_versions(self):
        env = self.ready_environment()
        env["GITHUB_REF_NAME"] = "v9.9.9"
        errors = release_readiness_errors(env, ROOT)
        self.assertTrue(any("must match package.json" in error for error in errors))
    def test_rejects_invalid_windows_signing_thumbprint(self):
        env = self.ready_environment()
        env["WINDOWS_CERTIFICATE_THUMBPRINT"] = "not-a-thumbprint"
        errors = release_readiness_errors(env, ROOT)
        self.assertTrue(any("40 hexadecimal characters" in error for error in errors))


    def test_accepts_configured_tagged_release_with_smoke_evidence(self):
        self.assertEqual(release_readiness_errors(self.ready_environment(), ROOT), [])


if __name__ == "__main__":
    unittest.main()
