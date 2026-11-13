"""Offline reproducible release packaging; does not execute installer or app."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT.parents[1]
BASE = WORKSPACE / "work/daedongcad-quality-01a196be/candidates/1.4.1-candidate.6/runtime"
NODE = WORKSPACE / ".build-tools/rea/runtime/node_modules/node-win-x64/bin/node.exe"
ASAR = WORKSPACE / ".build-tools/rea/runtime/node_modules/@electron/asar/bin/asar.mjs"
NSIS = WORKSPACE / ".build-tools/electron-builder-cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/makensis.exe"
BASE_EXE = "44369e5970d7d29d3bb8fe69914278d3ae981256bd54d28ec93315070b729515"
BASE_ASAR = "c15ffc1c989b31dc1e648914a0b748b33cd22b73d4272fbad6b0845cc1cf0b74"


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def inventory(folder):
    rows = []
    for p in sorted(folder.rglob("*")):
        require(not p.is_symlink() and not p.is_junction(), "Linked input: " + str(p))
        if p.is_file():
            rows.append({"path": p.relative_to(folder).as_posix(), "bytes": p.stat().st_size, "sha256": sha(p)})
    return rows


def run(args, log, cwd=None):
    result = subprocess.run(list(map(str, args)), cwd=cwd, capture_output=True, timeout=600)
    log.write_bytes(result.stdout + b"\nSTDERR\n" + result.stderr)
    require(result.returncode == 0, "Build tool failed; see " + str(log))
    return result.stdout.decode("utf-8", "replace").strip()


def esc(value):
    return str(value).replace("$", "$$").replace('"', '$\\"')


def deletion_include(files, prefix, strict=False):
    lines = []
    for r in files:
        relative = r["path"].replace("/", "\\")
        lines += [f'StrCpy $CheckPath "{prefix}\\{relative}"',
                  'Call un.CheckReparse' if strict else 'Call CheckReparse',
                  "ClearErrors", f'Delete "{prefix}\\{relative}"']
        if strict:
            # Missing files are already removed; only an existing file with error blocks finalization.
            lines += [f'IfFileExists "{prefix}\\{relative}" uninstall_failed']
    dirs = {str(Path(r["path"]).parent).replace("/", "\\") for r in files}
    dirs.discard(".")
    for d in sorted(dirs, key=lambda p: (p.count("\\"), p), reverse=True):
        lines.append(f'RMDir "{prefix}\\{d}"')
    lines.append(f'RMDir "{prefix}"')
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edition", required=True)
    parser.add_argument("--runtime-base", type=Path)
    parser.add_argument("--runtime-lock", type=Path)
    parser.add_argument("--node", type=Path, default=NODE)
    parser.add_argument("--asar", type=Path, default=ASAR)
    parser.add_argument("--makensis", type=Path, default=NSIS)
    args = parser.parse_args()
    require(re.fullmatch(r"[A-Za-z0-9_-]+", args.edition), "Unsafe edition")
    out = ROOT / "builds" / args.edition
    require(not out.exists(), "Preserve prior output; choose a new edition")
    src = ROOT / "src"
    package = json.loads((src / "package.json").read_text(encoding="utf-8"))
    version = package["version"]
    require(re.fullmatch(r"\d+\.\d+\.\d+", version), "Stable semantic version required")
    require(version in (src / "app/daedong-cad.html").read_text(encoding="utf-8"), "HTML release version missing")
    require("DaedongCAD-Release" in (src / "main.js").read_text(encoding="utf-8"), "Separated profile missing")
    runtime = args.runtime_base.resolve(strict=True) if args.runtime_base else BASE
    if args.runtime_base:
        require(args.runtime_lock is not None, "Explicit runtime hash lock required")
        lock = json.loads(args.runtime_lock.read_text(encoding="utf-8"))
        expected = lock["files"]
        observed = [r for r in inventory(runtime) if r["path"] not in ("resources/app.asar", "release-manifest.json")]
        require(observed == expected, "Runtime input differs from the supplied hash lock")
    else:
        require(sha(BASE / "DaedongCAD.exe") == BASE_EXE and sha(BASE / "resources/app.asar") == BASE_ASAR, "Frozen runtime base changed")
    source_inventory = inventory(src)
    build_sources = [ROOT / "scripts/build-release.py", ROOT / "scripts/build-version-resource.py", ROOT / "packaging/installer.nsi.in"]
    build_source_hashes = {p.relative_to(ROOT).as_posix(): sha(p) for p in build_sources}
    out.mkdir(parents=True)
    payload = out / "payload"
    payload.mkdir()
    base_inventory = inventory(runtime)
    for r in base_inventory:
        if r["path"] in ("resources/app.asar", "release-manifest.json"):
            continue
        p = runtime / r["path"]
        q = payload / r["path"]
        q.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, q)
        require(sha(q) == r["sha256"], "Runtime copy mismatch")
    snap = out / "source-snapshot"
    shutil.copytree(src, snap)
    require(inventory(snap) == source_inventory, "Source changed during snapshot")
    run([args.node, args.asar, "pack", snap, payload / "resources/app.asar"], out / "asar-pack.log")
    extracted = out / "asar-verify"
    run([args.node, args.asar, "extract", payload / "resources/app.asar", extracted], out / "asar-extract.log")
    require(inventory(extracted) == source_inventory, "ASAR extracted bytes differ")
    spec = importlib.util.spec_from_file_location("version_resource", ROOT / "scripts/build-version-resource.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    exe_version = mod.update(payload / "DaedongCAD.exe", version)
    save(out / "exe-version.json", exe_version)
    rows = inventory(payload)
    save(payload / "release-manifest.json", {"productId": "com.daedongcad.desktop.release", "version": version,
        "unsigned": True, "runtimeBaseExeSha256": BASE_EXE, "sourceFiles": source_inventory, "files": rows})
    rows = inventory(payload)
    include = []
    for r in rows:
        rel = Path(r["path"])
        parent = "" if str(rel.parent) == "." else "\\" + str(rel.parent).replace("/", "\\")
        include += [f'StrCpy $CheckPath "$INSTDIR\\app.new{parent}\\{rel.name}"', 'Call CheckReparse',
                    f'SetOutPath "$INSTDIR\\app.new{parent}"', "IfErrors extract_failed",
                    f'File "{esc(payload / rel)}"', "IfErrors extract_failed"]
    (out / "payload.nsh").write_text("\n".join(include) + "\n", encoding="utf-8")
    (out / "clean-previous.nsh").write_text(deletion_include(rows, "$INSTDIR\\app.previous"), encoding="utf-8")
    (out / "uninstall.nsh").write_text(deletion_include(rows, "$INSTDIR\\app", True), encoding="utf-8")
    for mode, call in (("existing", "CheckMutableFile"), ("uninstall", "un.CheckMutableFile")):
        checks = []
        for r in rows:
            relative = r["path"].replace("/", "\\")
            checks += [f'StrCpy $CheckPath "$INSTDIR\\app\\{relative}"', f'Call {call}']
        checks += ['StrCpy $CheckPath "$INSTDIR\\Uninstall DaedongCAD.exe"', f'Call {call}']
        checks += ['StrCpy $CheckPath "$INSTDIR\\.daedongcad-install"', f'Call {call}']
        (out / f"check-{mode}.nsh").write_text("\n".join(checks) + "\n", encoding="utf-8")
    installer = out / f"DaedongCAD-Setup-{version}.exe"
    template = (ROOT / "packaging/installer.nsi.in").read_text(encoding="utf-8")
    for token, replacement in {"VERSION": version, "OUTPUT": installer, "PAYLOAD_INCLUDE": out / "payload.nsh",
            "CLEAN_PREVIOUS_INCLUDE": out / "clean-previous.nsh", "UNINSTALL_INCLUDE": out / "uninstall.nsh",
            "CHECK_EXISTING_INCLUDE": out / "check-existing.nsh", "CHECK_UNINSTALL_INCLUDE": out / "check-uninstall.nsh"}.items():
        template = template.replace("@" + token + "@", esc(replacement))
    (out / "installer.nsi").write_text(template, encoding="utf-8-sig")
    run([args.makensis, "/V3", out / "installer.nsi"], out / "nsis-build.log")
    installer_version = mod.read_version(installer)
    require(installer_version["FileVersion"] == version and installer_version["ProductVersion"] == version, "Installer version mismatch")
    require(inventory(src) == source_inventory, "Source changed during build; rebuild from frozen source")
    require({p.relative_to(ROOT).as_posix(): sha(p) for p in build_sources} == build_source_hashes, "Packaging source changed during build; preserve this attempt and rebuild")
    save(out / "build-evidence.json", {"version": version, "sourceFiles": source_inventory,
        "packagingSourceSha256": build_source_hashes,
        "generatedInstallerSourceSha256": {p.name: sha(p) for p in sorted(out.glob("*.ns*"))},
        "runtimeBase": {"path": str(runtime), "originalExeSha256": BASE_EXE, "originalUnchanged": sha(BASE / "DaedongCAD.exe") == BASE_EXE if BASE.exists() else None,
                        "engineVersionObservation": "Static original executable literals Electron/44.10.0 and Chrome/152.0.7977.169"},
        "toolVersions": {"asar": "4.2.0", "nsis": "3.0.4.1", "resourceEditor": "Windows VERSIONINFO API via Python; no app execution"},
        "tools": [{"path": str(p), "sha256": sha(p)} for p in (args.node, args.asar, args.makensis)],
        "payload": rows, "asarSha256": sha(payload / "resources/app.asar"), "exeSha256": sha(payload / "DaedongCAD.exe"),
        "installer": {"path": str(installer), "bytes": installer.stat().st_size, "sha256": sha(installer), "version": installer_version},
        "appExeVersion": exe_version, "signed": False, "installedOrExecuted": False})
    save(out / "runtime-base.lock.json", {"schema": 1, "description": "Runtime from this payload, excluding application ASAR and generated manifest", "files": [r for r in rows if r["path"] not in ("resources/app.asar", "release-manifest.json")]})
    print(json.dumps({"output": str(out), "version": version, "installerBytes": installer.stat().st_size,
                      "installerSha256": sha(installer)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
