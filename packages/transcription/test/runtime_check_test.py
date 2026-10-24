import importlib.util
import json
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("runtime_check", Path(__file__).parents[1] / "runtime" / "runtime_check.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.whisper = Mock()
        self.pipeline = Mock()
        self.torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
        self.modules = patch.dict("sys.modules", {
            "faster_whisper": types.SimpleNamespace(WhisperModel=self.whisper),
            "pyannote": types.ModuleType("pyannote"),
            "pyannote.audio": types.SimpleNamespace(Pipeline=self.pipeline),
            "torch": self.torch,
        })
        self.modules.start()
        self.which = patch.object(runtime.shutil, "which", return_value="/usr/bin/ffmpeg")
        self.which.start()
        self.environment = patch.dict(os.environ)
        self.environment.start()
        self.env = {"SONAVRA_DIARIZATION_MODEL": self.directory.name}

    def tearDown(self):
        self.modules.stop()
        self.which.stop()
        self.environment.stop()
        self.directory.cleanup()

    def test_provisioned_models_load_offline(self):
        result = runtime.check_runtime(self.env)
        self.assertTrue(result["ready"])
        self.assertTrue(self.whisper.call_args.kwargs["local_files_only"])
        self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
        self.pipeline.from_pretrained.assert_called_once_with(self.directory.name)

    def test_missing_whisper_and_corrupt_diarization_are_unavailable(self):
        self.whisper.side_effect = RuntimeError("private model or credential details")
        self.pipeline.from_pretrained.side_effect = RuntimeError("private details")
        result = runtime.check_runtime(self.env)
        self.assertFalse(result["ready"])
        self.assertFalse(result["checks"]["whisper"])
        self.assertFalse(result["checks"]["diarization"])
        self.assertNotIn("private", json.dumps(result))

    def test_diarization_path_and_gpu_are_checked(self):
        self.assertFalse(runtime.check_runtime({})["ready"])
        self.assertFalse(runtime.check_runtime({**self.env, "SONAVRA_TRANSCRIPTION_DEVICE": "cuda"})["checks"]["device"])

    def test_component_probe_does_not_pretend_to_load_models(self):
        self.assertTrue(runtime.check_runtime({}, components_only=True)["ready"])
        self.whisper.assert_not_called()
        self.pipeline.from_pretrained.assert_not_called()


if __name__ == "__main__":
    unittest.main()
