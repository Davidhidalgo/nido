#!/usr/bin/env python3
"""NOTE4 factory backup and guarded flashing. Private artifacts stay in .local."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
FIRMWARE = ROOT / "firmware/note4"
BACKUPS = ROOT / ".local/note4/backups"
FLASH_BYTES = 16 * 1024 * 1024
SCOPE = "zectrix-note4-devkit-monochrome-v1"


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def run(command: list[str], timeout: int = 900) -> str:
    # Never invoke a shell with metadata, file paths or hardware identifiers.
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stdout[-6000:])
    return result.stdout


def esptool(port: str, *args: str, before: str = "default_reset", after: str = "hard_reset") -> str:
    command = [sys.executable, "-m", "esptool", "--chip", "esp32s3",
               "--port", port, "--baud", "921600", "--before", before,
               "--after", after, *args]
    if args[0] not in {"read_flash", "verify_flash"}:
        return run(command)
    log = ROOT / ".local/note4" / f"device-{args[0]}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("w") as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT,
                                timeout=900)
    output = log.read_text()
    if result.returncode:
        raise RuntimeError(output[-6000:])
    return output


def detect_port(requested: str | None, wait_seconds: int = 0) -> str:
    from serial.tools import list_ports
    deadline = time.monotonic() + wait_seconds
    while True:
        ports = [item.device for item in list_ports.comports() if item.vid == 0x303A]
        if ports or time.monotonic() >= deadline:
            break
        time.sleep(0.2)
    if requested:
        if requested not in ports:
            raise RuntimeError("El puerto indicado no identifica un USB Espressif conectado.")
        return requested
    if len(ports) != 1:
        raise RuntimeError("Se necesita un único NOTE4 USB conectado, o --port PUERTO.")
    return ports[0]


def identity(port: str, manual_boot: bool = False, keep_loader: bool = False) -> str:
    output = esptool(port, "flash_id", before="no_reset" if manual_boot else "default_reset",
                     after="no_reset" if keep_loader else "hard_reset")
    mac = re.search(r"MAC:\s*([0-9a-f:]{17})", output, re.IGNORECASE)
    if not mac or not re.search(r"Detected flash size:\s*16MB", output):
        raise RuntimeError("No se ha verificado ESP32-S3 con flash de 16 MB.")
    return mac.group(1).lower()


def validate_backup(path: Path) -> tuple[dict, Path]:
    metadata = json.loads(path.read_text())
    if metadata.get("hardware_scope") != SCOPE or metadata.get("verified") is not True:
        raise RuntimeError("Respaldo sin verificación de lectura o de otro hardware.")
    image = path.parent / metadata["image"]
    if image.resolve().parent != path.resolve().parent:
        raise RuntimeError("La imagen debe estar junto a sus metadatos.")
    if image.stat().st_size != FLASH_BYTES or digest(image) != metadata.get("sha256"):
        raise RuntimeError("El respaldo no tiene 16 MB o su SHA-256 ha cambiado.")
    return metadata, image


def backup(requested: str | None) -> Path:
    port = detect_port(requested)
    mac = identity(port)
    BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = f"factory-{stamp}-{mac.replace(':', '')}-{uuid.uuid4().hex[:6]}"
    image = BACKUPS / f"{name}.bin"
    metadata_path = BACKUPS / f"{name}.json"
    print("Leyendo los 16 MB del firmware original y verificándolos...", flush=True)
    print(esptool(port, "read_flash", "0", str(FLASH_BYTES), str(image))[-1200:])
    os.chmod(image, 0o600)
    if image.stat().st_size != FLASH_BYTES:
        raise RuntimeError("Lectura incompleta; no se permite flashear.")
    print(esptool(port, "verify_flash", "0", str(image))[-1200:])
    metadata = {"hardware_scope": SCOPE, "chip": "esp32s3", "mac": mac,
                "port": port, "image": image.name, "size": FLASH_BYTES,
                "sha256": digest(image), "verified": True, "created_at": stamp}
    with metadata_path.open("x") as handle:
        os.chmod(metadata_path, 0o600)
        json.dump(metadata, handle, indent=2)
        handle.write("\n")
    print(f"Respaldo verificado: {metadata_path}")
    return metadata_path


def flash(path: Path, requested: str | None, restore: bool = False, manual_boot: bool = False, build_dir: Path | None = None) -> None:
    metadata, image = validate_backup(path.resolve())
    print("Esperando NOTE4 USB (hasta 60 segundos); despiértalo con el lateral inferior...", flush=True)
    port = detect_port(requested, wait_seconds=60)
    if identity(port, manual_boot=manual_boot, keep_loader=True) != metadata["mac"]:
        raise RuntimeError("El dispositivo conectado no corresponde al respaldo.")
    if restore:
        print(esptool(port, "write_flash", "--flash_size", "16MB", "0", str(image),
                      before="no_reset", after="no_reset")[-2000:])
        print(esptool(port, "verify_flash", "0", str(image), before="no_reset",
                      after="no_reset")[-1200:])
        print("Restauración verificada.", flush=True)
        reset_device(port, manual_boot=True)
        return
    build = (build_dir or FIRMWARE / "build").resolve()
    args_path = build / "flasher_args.json"
    if not args_path.exists():
        raise RuntimeError("Primero compila con scripts/note4-firmware build.")
    args = json.loads(args_path.read_text())
    if args.get("flash_settings", {}).get("flash_size") != "16MB":
        raise RuntimeError("El binario no tiene el tamaño de flash esperado.")
    files = args["flash_files"]
    verified_files = []
    for offset, filename in files.items():
        binary = (build / filename).resolve()
        if not binary.is_relative_to(build.resolve()) or not binary.is_file():
            raise RuntimeError("Artefacto fuera del directorio de compilación.")
        verified_files.extend([offset, str(binary)])
    print("Flasheando Nido NOTE4 con respaldo verificado...", flush=True)
    settings = args["flash_settings"]
    print(esptool(port, "write_flash", "--flash_size", "16MB",
                  "--flash_mode", settings["flash_mode"], "--flash_freq", settings["flash_freq"],
                  *verified_files, before="no_reset", after="no_reset")[-3000:])
    print(esptool(port, "verify_flash", *verified_files, before="no_reset",
                  after="no_reset")[-1200:])
    print("Firmware verificado.", flush=True)
    reset_device(port, manual_boot=True)


def reset_device(port: str, manual_boot: bool = False) -> None:
    # USB RTS reset can retain download mode after manual boot on ESP32-S3.
    # Use the supported RTC watchdog reset; this command does not write flash.
    try:
        output = esptool(port, "flash_id", before="no_reset" if manual_boot else "default_reset",
                         after="watchdog_reset")
    except RuntimeError as error:
        output = str(error)
        # On macOS the full reset can disconnect USB before esptool relocks WDT.
        # This proves only that activation was reached, not that firmware booted.
        if ("Hard resetting with a watchdog..." not in output or
            "RTC_CNTL_WDTWPROTECT_REG, 0" not in output or
            "OSError: [Errno 83] Device error" not in output):
            raise
        print("USB desconectado durante la activación del watchdog; arranque sin confirmar.", flush=True)
        return
    print(output[-1200:])
    print("Reinicio por watchdog solicitado; arranque pendiente de comprobar.", flush=True)


def capture(port: str, seconds: int, reset: bool) -> None:
    """Observe serial across USB disconnects caused by deep sleep."""
    import termios
    import tty
    if reset:
        reset_device(port)
    deadline = time.monotonic() + seconds
    connection = None
    pending = b""
    while time.monotonic() < deadline:
        try:
            if connection is None:
                # Native USB does not need modem-line ioctls. Pyserial clears
                # RTS even when configured false before open, resetting S3.
                connection = os.open(port, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
                tty.setraw(connection)
                settings = termios.tcgetattr(connection)
                settings[2] = (settings[2] | termios.CLOCAL | termios.CREAD) & ~termios.HUPCL
                settings[4] = settings[5] = termios.B115200
                termios.tcsetattr(connection, termios.TCSANOW, settings)
                print("[NOTE4 USB conectado]", flush=True)
            block = os.read(connection, 4096)
            if not block:
                raise OSError("USB disconnected")
            pending += block
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                print(line.decode("utf-8", errors="replace").rstrip(), flush=True)
        except BlockingIOError:
            time.sleep(0.05)
        except (OSError, termios.error):
            if connection is not None:
                os.close(connection)
                connection = None
                pending = b""
                print("[NOTE4 USB desconectado; esperando despertar]", flush=True)
            time.sleep(0.2)
    if connection is not None:
        os.close(connection)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["list", "backup", "flash", "restore", "capture", "reset"])
    parser.add_argument("--port")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--manual-boot", action="store_true")
    args = parser.parse_args()
    if args.command == "list":
        from serial.tools import list_ports
        for item in list_ports.comports():
            if item.vid == 0x303A:
                print(f"{item.device}: {item.description}")
    elif args.command == "reset":
        reset_device(detect_port(args.port), manual_boot=args.manual_boot)
    elif args.command == "backup":
        backup(args.port)
    elif args.command == "capture":
        if not 1 <= args.seconds <= 300:
            parser.error("--seconds debe estar entre 1 y 300")
        capture(args.port or detect_port(None), args.seconds, args.reset)
    elif not args.backup:
        parser.error("flash y restore necesitan --backup METADATA.json")
    else:
        flash(args.backup, args.port, restore=args.command == "restore", manual_boot=args.manual_boot, build_dir=args.build_dir)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f"NOTE4: {error}", file=sys.stderr)
        sys.exit(1)
