"""Update only VERSIONINFO in an owned unsigned EXE copy; never execute it."""
import ctypes
import json
import struct
import sys
from ctypes import wintypes
from pathlib import Path


def aligned(data):
    return data + b"\0" * (-len(data) % 4)


def block(key, value=b"", value_length=0, kind=1, children=()):
    data = aligned(struct.pack("<HHH", 0, value_length, kind) + (key + "\0").encode("utf-16le")) + value
    for child in children:
        data = aligned(data) + child
    return struct.pack("<H", len(data)) + data[2:]


def version_blob(version):
    major, minor, patch = map(int, version.split("."))
    fixed = struct.pack("<13I", 0xFEEF04BD, 0x10000, major << 16 | minor, patch << 16,
                        major << 16 | minor, patch << 16, 0x3F, 0, 0x40004, 1, 0, 0, 0)
    values = {"CompanyName": "대동", "FileDescription": "대동 CAD", "FileVersion": version,
              "InternalName": "DaedongCAD", "OriginalFilename": "DaedongCAD.exe", "ProductName": "대동 CAD",
              "ProductVersion": version, "LegalCopyright": "대동 CAD"}
    strings = [block(k, (v + "\0").encode("utf-16le"), len(v) + 1) for k, v in values.items()]
    table = block("StringFileInfo", children=[block("040904B0", children=strings)])
    trans = block("VarFileInfo", children=[block("Translation", struct.pack("<HH", 1033, 1200), 4, 0)])
    return block("VS_VERSION_INFO", fixed, len(fixed), 0, [table, trans])


def read_version(path):
    v = ctypes.WinDLL("version", use_last_error=True)
    v.GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
    v.GetFileVersionInfoSizeW.restype = wintypes.DWORD
    v.GetFileVersionInfoW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID]
    v.VerQueryValueW.argtypes = [wintypes.LPCVOID, wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.UINT)]
    size = v.GetFileVersionInfoSizeW(str(path), None)
    if not size:
        raise ctypes.WinError(ctypes.get_last_error())
    buf = ctypes.create_string_buffer(size)
    if not v.GetFileVersionInfoW(str(path), 0, size, buf):
        raise ctypes.WinError(ctypes.get_last_error())
    result = {}
    for key in ("FileVersion", "ProductVersion", "ProductName", "OriginalFilename"):
        ptr, length = ctypes.c_void_p(), wintypes.UINT()
        ok = v.VerQueryValueW(buf, "\\StringFileInfo\\040904B0\\" + key, ctypes.byref(ptr), ctypes.byref(length))
        result[key] = ctypes.wstring_at(ptr, length.value).rstrip("\0") if ok else None
    return result


def update(path, version):
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
    k.LoadLibraryExW.restype = wintypes.HMODULE
    k.FreeLibrary.argtypes = [wintypes.HMODULE]
    k.EnumResourceLanguagesW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ssize_t]
    k.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    k.BeginUpdateResourceW.restype = wintypes.HANDLE
    k.UpdateResourceW.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wintypes.WORD, wintypes.LPVOID, wintypes.DWORD]
    k.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    # LOAD_LIBRARY_AS_DATAFILE: no process, entry point or DLL initialization.
    module = k.LoadLibraryExW(str(path), None, 2)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())
    langs = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, wintypes.WORD, ctypes.c_ssize_t)
    callback = callback_type(lambda _m, _t, _n, lang, _p: (langs.append(lang) or True))
    try:
        k.EnumResourceLanguagesW(module, ctypes.c_void_p(16), ctypes.c_void_p(1), callback, 0)
    finally:
        k.FreeLibrary(module)
    handle = k.BeginUpdateResourceW(str(path), False)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        for lang in langs:
            if not k.UpdateResourceW(handle, ctypes.c_void_p(16), ctypes.c_void_p(1), lang, None, 0):
                raise ctypes.WinError(ctypes.get_last_error())
        data = version_blob(version)
        buf = ctypes.create_string_buffer(data)
        if not k.UpdateResourceW(handle, ctypes.c_void_p(16), ctypes.c_void_p(1), 1033, buf, len(data)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not k.EndUpdateResourceW(handle, False):
            raise ctypes.WinError(ctypes.get_last_error())
        handle = None
    finally:
        if handle:
            k.EndUpdateResourceW(handle, True)
    got = read_version(path)
    if got["FileVersion"] != version or got["ProductVersion"] != version:
        raise RuntimeError(got)
    return got


if __name__ == "__main__":
    p = Path(sys.argv[1]).resolve(strict=True)
    if len(sys.argv) == 3:
        if not p.name == "DaedongCAD.exe" or "builds" not in p.parts:
            raise RuntimeError("Only owned build copies may be modified")
        result = update(p, sys.argv[2])
    else:
        result = read_version(p)
    print(json.dumps(result, ensure_ascii=False))
