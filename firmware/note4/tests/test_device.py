"""Check backup gates offline, without accessing a serial device."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import contextlib
import io

SCRIPT = Path(__file__).resolve().parents[3] / "scripts/note4-device.py"
spec = importlib.util.spec_from_file_location("note4_device", SCRIPT)
device = importlib.util.module_from_spec(spec)
spec.loader.exec_module(device)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.image = self.root / "factory.bin"
        with self.image.open("wb") as image:
            image.truncate(device.FLASH_BYTES)
        self.metadata = {"hardware_scope": device.SCOPE, "verified": True,
                         "image": self.image.name, "sha256": device.digest(self.image)}
        self.manifest = self.root / "factory.json"

    def save(self):
        self.manifest.write_text(json.dumps(self.metadata))

    def test_valid_backup(self):
        self.save()
        self.assertEqual(device.validate_backup(self.manifest)[1], self.image)

    def test_modified_image_is_rejected(self):
        self.save()
        with self.image.open("r+b") as image:
            image.write(b"changed")
        with self.assertRaises(RuntimeError):
            device.validate_backup(self.manifest)

    def test_unverified_or_wrong_scope_is_rejected(self):
        for key, value in [("verified", False), ("hardware_scope", "note4c")]:
            original = self.metadata[key]
            self.metadata[key] = value
            self.save()
            with self.assertRaises(RuntimeError):
                device.validate_backup(self.manifest)
            self.metadata[key] = original

    def test_path_escape_is_rejected(self):
        self.metadata["image"] = "../factory.bin"
        self.save()
        with self.assertRaises(RuntimeError):
            device.validate_backup(self.manifest)

    def test_truncated_image_is_rejected(self):
        self.save()
        self.image.write_bytes(b"partial")
        with self.assertRaises(RuntimeError):
            device.validate_backup(self.manifest)

    def test_loader_reset_uses_watchdog_without_writing_flash(self):
        with patch.object(device, "esptool", return_value="watchdog requested") as tool, \
             contextlib.redirect_stdout(io.StringIO()):
            device.reset_device("/dev/test", manual_boot=True)
            tool.assert_called_once_with("/dev/test", "flash_id", before="no_reset",
                                         after="watchdog_reset")

    def test_watchdog_disconnect_is_not_reported_as_confirmed_boot(self):
        error = "Hard resetting with a watchdog... RTC_CNTL_WDTWPROTECT_REG, 0 OSError: [Errno 83] Device error"
        output = io.StringIO()
        with patch.object(device, "esptool", side_effect=RuntimeError(error)), \
             contextlib.redirect_stdout(output):
            device.reset_device("/dev/test", manual_boot=True)
        self.assertIn("arranque sin confirmar", output.getvalue())
        with patch.object(device, "esptool", side_effect=RuntimeError("No serial data")):
            with self.assertRaises(RuntimeError):
                device.reset_device("/dev/test", manual_boot=True)

    def test_other_device_cannot_be_flashed(self):
        self.metadata["mac"] = "00:11:22:33:44:55"
        self.save()
        with patch.object(device, "detect_port", return_value="/dev/test"), \
             patch.object(device, "identity", return_value="66:77:88:99:aa:bb"), \
             patch.object(device, "esptool") as tool, \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "no corresponde"):
                device.flash(self.manifest, None, manual_boot=True)
            tool.assert_not_called()

    def test_custom_build_keeps_backup_and_artifact_boundary(self):
        self.metadata["mac"] = "00:11:22:33:44:55"
        self.save()
        build = self.root / "generic-build"
        build.mkdir()
        (build / "app.bin").write_bytes(b"synthetic app")
        manifest = {"flash_settings": {"flash_size": "16MB", "flash_mode": "dio", "flash_freq": "80m"},
                    "flash_files": {"0x330000": "app.bin"}}
        (build / "flasher_args.json").write_text(json.dumps(manifest))
        with patch.object(device, "detect_port", return_value="/dev/test"), \
             patch.object(device, "identity", return_value=self.metadata["mac"]), \
             patch.object(device, "esptool", return_value="verified") as tool, \
             patch.object(device, "reset_device") as reset, \
             contextlib.redirect_stdout(io.StringIO()):
            device.flash(self.manifest, None, build_dir=build)
            self.assertIn(str((build / "app.bin").resolve()), tool.call_args_list[0].args)
            reset.assert_called_once_with("/dev/test", manual_boot=True)
            manifest["flash_files"] = {"0x330000": "../factory.bin"}
            (build / "flasher_args.json").write_text(json.dumps(manifest))
            tool.reset_mock()
            with self.assertRaisesRegex(RuntimeError, "fuera del directorio"):
                device.flash(self.manifest, None, build_dir=build)
            tool.assert_not_called()


if __name__ == "__main__":
    unittest.main()
