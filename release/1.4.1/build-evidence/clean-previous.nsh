StrCpy $CheckPath "$INSTDIR\app.previous\chrome_100_percent.pak"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\chrome_100_percent.pak"
StrCpy $CheckPath "$INSTDIR\app.previous\chrome_200_percent.pak"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\chrome_200_percent.pak"
StrCpy $CheckPath "$INSTDIR\app.previous\d3dcompiler_47.dll"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\d3dcompiler_47.dll"
StrCpy $CheckPath "$INSTDIR\app.previous\DaedongCAD.exe"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\DaedongCAD.exe"
StrCpy $CheckPath "$INSTDIR\app.previous\dxcompiler.dll"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\dxcompiler.dll"
StrCpy $CheckPath "$INSTDIR\app.previous\dxil.dll"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\dxil.dll"
StrCpy $CheckPath "$INSTDIR\app.previous\ffmpeg.dll"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\ffmpeg.dll"
StrCpy $CheckPath "$INSTDIR\app.previous\icudtl.dat"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\icudtl.dat"
StrCpy $CheckPath "$INSTDIR\app.previous\LICENSE.electron.txt"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\LICENSE.electron.txt"
StrCpy $CheckPath "$INSTDIR\app.previous\LICENSES.chromium.html"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\LICENSES.chromium.html"
StrCpy $CheckPath "$INSTDIR\app.previous\locales\en-US.pak"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\locales\en-US.pak"
StrCpy $CheckPath "$INSTDIR\app.previous\locales\ko.pak"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\locales\ko.pak"
StrCpy $CheckPath "$INSTDIR\app.previous\release-manifest.json"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\release-manifest.json"
StrCpy $CheckPath "$INSTDIR\app.previous\resources\app.asar"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\resources\app.asar"
StrCpy $CheckPath "$INSTDIR\app.previous\resources.pak"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\resources.pak"
StrCpy $CheckPath "$INSTDIR\app.previous\snapshot_blob.bin"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\snapshot_blob.bin"
StrCpy $CheckPath "$INSTDIR\app.previous\v8_context_snapshot.bin"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\v8_context_snapshot.bin"
StrCpy $CheckPath "$INSTDIR\app.previous\vk_swiftshader.dll"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\vk_swiftshader.dll"
StrCpy $CheckPath "$INSTDIR\app.previous\vk_swiftshader_icd.json"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\vk_swiftshader_icd.json"
StrCpy $CheckPath "$INSTDIR\app.previous\vulkan-1.dll"
Call CheckReparse
ClearErrors
Delete "$INSTDIR\app.previous\vulkan-1.dll"
RMDir "$INSTDIR\app.previous\resources"
RMDir "$INSTDIR\app.previous\locales"
RMDir "$INSTDIR\app.previous"
