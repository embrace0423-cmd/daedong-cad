"""Verify transport parts and safely reconstruct a ZIP; never extract or run it."""
import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath

BLOCK = 1024 * 1024
PART_BYTES = 29_000_000
FILE_LIMIT = 30_000_000
MAX_PARTS = 9999
MANIFEST_LIMIT = 8 * 1024 * 1024
SCHEMA = "daedongcad-transport-v2"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, low, high, label):
    require(type(value) is int and low <= value <= high, f"Invalid {label}")
    return value


def digest_value(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value), "Invalid SHA256")
    return value


def safe_component(value):
    require(isinstance(value, str) and value and value not in (".", ".."), "Unsafe filename")
    require(not any(ord(c) < 32 or c in '<>:"/\\|?*' for c in value), "Unsafe filename")
    require(value == value.rstrip(" .") and not PureWindowsPath(value).drive, "Unsafe filename")
    stem = value.split(".")[0].upper()
    require(stem not in {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"}
            and not re.fullmatch(r"(?:COM|LPT)[0-9¹²³]", stem), "Reserved filename")
    return value


def plain_path(path, *, must_exist=False, file=False, directory=False):
    """Reject symlinks/junctions before resolving; do not traverse linked ancestors."""
    path = Path(os.path.abspath(path))
    for item in reversed((path, *path.parents)):
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        require(not stat.S_ISLNK(info.st_mode)
                and not (getattr(info, "st_file_attributes", 0) & 0x400),
                f"Linked/reparse path is not allowed: {item}")
    if must_exist:
        require(path.exists(), f"Missing path: {path}")
    if file:
        require(path.is_file(), f"Not a regular file: {path}")
    if directory:
        require(path.is_dir(), f"Not a directory: {path}")
    return path


def sha_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


def check_zip(path):
    """Check all CRCs and portable relative entry names without extracting files."""
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = set()
        total = 0
        for info in infos:
            name = info.filename
            require(name and "\\" not in name and not name.startswith("/"), "Unsafe archive path")
            require(not PureWindowsPath(name).drive, "Unsafe archive drive")
            components = name[:-1].split("/") if info.is_dir() else name.split("/")
            for component in components:
                safe_component(component)
            normalized = PurePosixPath(*components).as_posix().casefold()
            require(normalized not in names, f"Duplicate archive entry: {name}")
            names.add(normalized)
            require(not stat.S_ISLNK(info.external_attr >> 16), "Archive symlink is not allowed")
            require(not info.flag_bits & 1, "Encrypted archive is not supported")
            total += info.file_size
        require(archive.testzip() is None, "Original ZIP CRC verification failed")
    return {"zip_entries": len(infos), "uncompressed_bytes": total}


def load_manifest(path):
    path = plain_path(path, must_exist=True, file=True)
    require(path.stat().st_size <= MANIFEST_LIMIT, "Manifest is too large")
    with path.open("r", encoding="utf-8") as stream:
        value = json.load(stream)
    require(isinstance(value, dict) and value.get("schema") == SCHEMA, "Unknown manifest schema")
    require(value.get("max_file_bytes_exclusive") == FILE_LIMIT, "Unexpected file limit")
    chunk = integer(value.get("part_bytes"), 1, PART_BYTES, "part_bytes")
    original = value.get("original")
    require(isinstance(original, dict), "Missing original ZIP metadata")
    safe_component(original.get("name"))
    require(original["name"].lower().endswith(".zip"), "Output must be a ZIP filename")
    size = integer(original.get("bytes"), 1, MAX_PARTS * PART_BYTES, "original size")
    digest_value(original.get("sha256"))
    integer(original.get("zip_entries"), 0, 10_000_000, "ZIP entry count")
    integer(original.get("uncompressed_bytes"), 0, 2**63 - 1, "uncompressed size")
    rows = value.get("parts")
    require(isinstance(rows, list) and 1 <= len(rows) <= MAX_PARTS, "Invalid part count")
    require(len(rows) == (size + chunk - 1) // chunk, "Part count does not match original size")
    for number, row in enumerate(rows, 1):
        require(isinstance(row, dict), "Invalid part metadata")
        require(row.get("file") == f"{number:02d}-data.zip"
                and row.get("entry") == f"backup.part{number:03d}", "Invalid part order/name")
        expected = min(chunk, size - (number - 1) * chunk)
        require(integer(row.get("bytes"), 1, PART_BYTES, "raw part size") == expected,
                "Raw part size does not match position")
        integer(row.get("zip_bytes"), expected, FILE_LIMIT - 1, "part ZIP size")
        digest_value(row.get("sha256"))
        digest_value(row.get("zip_sha256"))
    return value


def stream_parts(manifest, folder, destination):
    combined_hash = hashlib.sha256()
    total = 0
    for row in manifest["parts"]:
        path = plain_path(folder / row["file"], must_exist=True, file=True)
        require(path.stat().st_size == row["zip_bytes"], f"Wrong ZIP size: {row['file']}")
        require(sha_file(path) == row["zip_sha256"], f"ZIP hash mismatch: {row['file']}")
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            require(len(entries) == 1 and entries[0].filename == row["entry"],
                    f"Unexpected ZIP entry: {row['file']}")
            entry = entries[0]
            require(entry.compress_type == zipfile.ZIP_STORED and entry.file_size == row["bytes"]
                    and entry.compress_size == row["bytes"] and not entry.flag_bits & 1,
                    f"Invalid raw part: {row['file']}")
            digest = hashlib.sha256()
            size = 0
            with archive.open(entry) as stream:
                for block in iter(lambda: stream.read(BLOCK), b""):
                    size += len(block)
                    require(size <= row["bytes"], "Part exceeded declared size")
                    digest.update(block)
                    combined_hash.update(block)
                    destination.write(block)
            require(size == row["bytes"] and digest.hexdigest() == row["sha256"],
                    f"Raw part hash mismatch: {row['file']}")
            total += size
    original = manifest["original"]
    require(total == original["bytes"] and combined_hash.hexdigest() == original["sha256"],
            "Combined ZIP hash/size mismatch")
    return {"bytes": total, "sha256": combined_hash.hexdigest(), "parts": len(manifest["parts"])}


def restore(manifest_path, parts_dir, output=None, verify_only=False, expected_sha256=None):
    manifest = load_manifest(manifest_path)
    if expected_sha256 is not None:
        require(manifest["original"]["sha256"] == digest_value(expected_sha256.lower()),
                "Original SHA256 does not match trusted expected hash")
    folder = plain_path(parts_dir, must_exist=True, directory=True)
    output = plain_path(output if output is not None else folder / manifest["original"]["name"])
    safe_component(output.name)
    require(output.suffix.lower() == ".zip", "Output must end with .zip")
    plain_path(output.parent, must_exist=True, directory=True)
    if not verify_only:
        require(not os.path.lexists(output), f"Will not overwrite: {output}")
    # Verification also stages a complete ZIP because its central directory needs seeking.
    # Only this uniquely created temporary file may be removed on normal failure.
    fd, temp_name = tempfile.mkstemp(prefix=".daedong-restore-", suffix=".partial", dir=output.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as target:
            result = stream_parts(manifest, folder, target)
            target.flush()
            os.fsync(target.fileno())
        require(temp.stat().st_size == result["bytes"] and sha_file(temp) == result["sha256"],
                "Written ZIP verification failed")
        inventory = check_zip(temp)
        require(all(inventory[key] == manifest["original"][key] for key in inventory),
                "Original ZIP inventory mismatch")
        result.update(inventory)
        if verify_only:
            return {"status": "verified", **result}
        # Atomic no-replace publication. No unsafe rename/copy fallback on unsupported filesystems.
        plain_path(output.parent, must_exist=True, directory=True)
        require(not os.path.lexists(output), f"Will not overwrite: {output}")
        os.link(temp, output)
        return {"status": "restored", "output": str(output), **result}
    finally:
        temp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("transfer-manifest.json"))
    parser.add_argument("--parts-dir", type=Path, default=Path(__file__).absolute().parent.parent)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--expect-sha256", help="Optional whole ZIP hash obtained from a trusted source")
    args = parser.parse_args()
    try:
        result = restore(args.manifest, args.parts_dir, args.output, args.verify_only, args.expect_sha256)
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError) as error:
        parser.exit(1, f"ERROR: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
