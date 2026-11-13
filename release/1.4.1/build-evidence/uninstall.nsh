StrCpy $CheckPath "$INSTDIR\app\chrome_100_percent.pak"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\chrome_100_percent.pak"
IfFileExists "$INSTDIR\app\chrome_100_percent.pak" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\chrome_200_percent.pak"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\chrome_200_percent.pak"
IfFileExists "$INSTDIR\app\chrome_200_percent.pak" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\d3dcompiler_47.dll"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\d3dcompiler_47.dll"
IfFileExists "$INSTDIR\app\d3dcompiler_47.dll" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\DaedongCAD.exe"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\DaedongCAD.exe"
IfFileExists "$INSTDIR\app\DaedongCAD.exe" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\dxcompiler.dll"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\dxcompiler.dll"
IfFileExists "$INSTDIR\app\dxcompiler.dll" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\dxil.dll"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\dxil.dll"
IfFileExists "$INSTDIR\app\dxil.dll" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\ffmpeg.dll"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\ffmpeg.dll"
IfFileExists "$INSTDIR\app\ffmpeg.dll" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\icudtl.dat"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\icudtl.dat"
IfFileExists "$INSTDIR\app\icudtl.dat" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\LICENSE.electron.txt"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\LICENSE.electron.txt"
IfFileExists "$INSTDIR\app\LICENSE.electron.txt" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\LICENSES.chromium.html"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\LICENSES.chromium.html"
IfFileExists "$INSTDIR\app\LICENSES.chromium.html" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\locales\en-US.pak"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\locales\en-US.pak"
IfFileExists "$INSTDIR\app\locales\en-US.pak" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\locales\ko.pak"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\locales\ko.pak"
IfFileExists "$INSTDIR\app\locales\ko.pak" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\release-manifest.json"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\release-manifest.json"
IfFileExists "$INSTDIR\app\release-manifest.json" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\resources\app.asar"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\resources\app.asar"
IfFileExists "$INSTDIR\app\resources\app.asar" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\resources.pak"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\resources.pak"
IfFileExists "$INSTDIR\app\resources.pak" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\snapshot_blob.bin"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\snapshot_blob.bin"
IfFileExists "$INSTDIR\app\snapshot_blob.bin" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\v8_context_snapshot.bin"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\v8_context_snapshot.bin"
IfFileExists "$INSTDIR\app\v8_context_snapshot.bin" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\vk_swiftshader.dll"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\vk_swiftshader.dll"
IfFileExists "$INSTDIR\app\vk_swiftshader.dll" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\vk_swiftshader_icd.json"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\vk_swiftshader_icd.json"
IfFileExists "$INSTDIR\app\vk_swiftshader_icd.json" uninstall_failed
StrCpy $CheckPath "$INSTDIR\app\vulkan-1.dll"
Call un.CheckReparse
ClearErrors
Delete "$INSTDIR\app\vulkan-1.dll"
IfFileExists "$INSTDIR\app\vulkan-1.dll" uninstall_failed
RMDir "$INSTDIR\app\resources"
RMDir "$INSTDIR\app\locales"
RMDir "$INSTDIR\app"
