"""Offline downloader regression: verified reuse, conflict and partial failure."""
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "models", Path(__file__).resolve().parents[1] / "scripts/comfyui/download-models.py"
)
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)


class DownloadTest(unittest.TestCase):
    def test_verified_reuse_conflict_and_corrupt_download(self):
        content = b"test model, not actual weights"
        revision = "a" * 40
        sha = hashlib.sha256(content).hexdigest()
        metadata = json.dumps({"sha": revision, "siblings": [
            {"rfilename": "split_files/vae/test.bin", "lfs": {"sha256": sha}}
        ]}).encode()
        calls = []

        def respond(url, **kwargs):
            calls.append(url)
            return io.BytesIO(metadata if "/api/models/" in url else content)

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / "vae/test.bin"
            with patch.object(models.urllib.request, "urlopen", side_effect=respond):
                result = models.download(root, "org/model", "vae", "test.bin")
                self.assertEqual(result["sha256"], sha)
                self.assertIn(f"/resolve/{revision}/", calls[-1])
                self.assertEqual(target.read_bytes(), content)
                calls.clear()
                models.download(root, "org/model", "vae", "test.bin")
                self.assertEqual(len(calls), 1, "Verified existing model was downloaded again")
                target.write_bytes(b"keep conflicting file")
                with self.assertRaises(AssertionError):
                    models.download(root, "org/model", "vae", "test.bin")
                self.assertEqual(target.read_bytes(), b"keep conflicting file")
            target.unlink()
            with patch.object(models.urllib.request, "urlopen", side_effect=[
                io.BytesIO(metadata), io.BytesIO(b"partial")
            ]):
                with self.assertRaises(AssertionError):
                    models.download(root, "org/model", "vae", "test.bin")
            self.assertFalse(target.exists(), "Corrupt download was published")
            with patch.object(models.urllib.request, "urlopen", side_effect=respond):
                models.download(root, "org/model", "vae", "test.bin")
            self.assertEqual(target.read_bytes(), content, "Interrupted download did not recover")


if __name__ == "__main__":
    unittest.main()
