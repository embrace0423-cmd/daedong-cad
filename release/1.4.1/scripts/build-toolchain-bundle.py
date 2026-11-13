"""Copy only the local ASAR dependency closure and Windows NSIS build tools."""
import hashlib
import json
import os
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W = ROOT.parents[1]
MODULES = W / ".build-tools/rea/runtime/node_modules"
NSIS = W / ".build-tools/electron-builder-cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n"
NODE = MODULES / "node-win-x64/bin/node.exe"
OUT = ROOT / "packaging/build-tools-offline.zip"


def sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def resolve(name, origin):
    for parent in (origin, *origin.parents):
        candidate = parent / "node_modules" / name
        if (candidate / "package.json").is_file():
            return candidate
    raise RuntimeError("Required installed dependency is missing: " + name)


def main():
    if OUT.exists():
        raise RuntimeError("Preserve prior build tool bundle")
    packages, pending, files = {}, [MODULES / "@electron/asar"], {}
    while pending:
        package = pending.pop()
        if package in packages:
            continue
        meta = json.loads((package / "package.json").read_text(encoding="utf-8"))
        packages[package] = {"name": meta["name"], "version": meta["version"], "path": package.relative_to(MODULES).as_posix()}
        for dep in meta.get("dependencies", {}):
            pending.append(resolve(dep, package))
        for p in package.rglob("*"):
            if "node_modules" in p.relative_to(package).parts:
                continue
            if p.is_symlink() or p.is_junction():
                raise RuntimeError("Linked package input: " + str(p))
            if p.is_file():
                files["asar/node_modules/" + p.relative_to(MODULES).as_posix()] = p
    for p in NSIS.rglob("*"):
        rel = p.relative_to(NSIS)
        if rel.parts[0] in ("linux", "mac") or p.name == ".DS_Store":
            continue
        if p.is_symlink() or p.is_junction():
            raise RuntimeError("Linked NSIS input: " + str(p))
        if p.is_file():
            files["nsis/" + rel.as_posix()] = p
    rows = [{"path": name, "bytes": p.stat().st_size, "sha256": sha(p)} for name, p in sorted(files.items())]
    node_meta = json.loads((MODULES / "node-win-x64/package.json").read_text(encoding="utf-8"))
    manifest = {"schema": 1, "nsis": "3.0.4.1", "asarPackages": sorted(packages.values(), key=lambda r: r["path"]),
        "prerequisitesNotRedistributed": {"node": {"version": node_meta["version"], "bytes": NODE.stat().st_size, "sha256": sha(NODE)},
            "python": "3.13.x; production validation uses Python 3.13.15 on Windows x64"},
        "contents": rows, "scope": "Offline public build-tool sources/binaries and license files only; no Node/Python/app runtime/profile/signing material"}
    with zipfile.ZipFile(OUT, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, p in sorted(files.items()):
            entry = zipfile.ZipInfo(name, (2026, 11, 11, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            with p.open("rb") as src, archive.open(entry, "w") as dst:
                for data in iter(lambda: src.read(1024 * 1024), b""):
                    dst.write(data)
        archive.writestr("TOOLCHAIN-MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    with zipfile.ZipFile(OUT) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Build tool bundle CRC mismatch")
        for row in rows:
            raw = archive.read(row["path"])
            if len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row["sha256"]:
                raise RuntimeError("Build tool bundle content mismatch")
    manifest["bundle"] = {"path": str(OUT), "bytes": OUT.stat().st_size, "sha256": sha(OUT)}
    (ROOT / "packaging/toolchain-lock.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"files": len(rows), "packages": len(packages), "bytes": OUT.stat().st_size, "sha256": sha(OUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
