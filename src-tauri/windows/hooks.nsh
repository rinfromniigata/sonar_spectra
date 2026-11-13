; NSIS のフック（tauri.conf.json の bundle.windows.nsis.installerHooks）
;
; 0.1.0 は表示名（productName）が sonar_spectra だったため、アンインストール情報のキーと
; インストール先が今の版と違い、インストーラーは同じアプリと見なさない。そこで、0.1.0 が
; 入っていれば、インストールの前に、設定と構成を残したまま取り除く（SPEC 7節、imple 6節）。
;
; 前提（tauri-bundler 2.10.4 の installer.nsi で確かめた）
; - 0.1.0 は既定の currentUser で入るため、キーは HKCU にある
; - UninstallString は、引用符で囲んだ "$INSTDIR\uninstall.exe"
; - インストール先は、引用符なしで ${MANUKEY}\${PRODUCTNAME} の既定値にある
;   （InstallLocation は引用符で囲まれている）
; - _?= を付けると、アンインストーラーはその場で動き、終わるまで ExecWait が待つ。
;   その代わり、自分自身とフォルダーは消せないため、終わったら消す
; - /UPDATE は付けない（付けるとショートカットなどが残る）
; - /S では確認の画面を出さず、$DeleteAppDataCheckboxState は空のまま（≠1）なので、
;   アプリのデータ（%APPDATA%\${BUNDLEID}）は消えない
; - /S で旧版が動いていれば、アンインストーラーが閉じてから取り除く
;
; 旧版が見つからなければ何もしない。取り除けなかったときは、旧版を残したまま、
; 今の版のインストールを続ける。

!define OLD_PRODUCTNAME "sonar_spectra"
!define OLD_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLD_PRODUCTNAME}"
; MANUFACTURER はこのファイルより後で定義されるため、マクロの中で直接使う（マクロは挿入した場所で展開される）

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  Push $R2

  ReadRegStr $R0 HKCU "${OLD_UNINSTKEY}" "UninstallString"
  ${If} $R0 != ""
    ; 旧版のインストール先。なければ InstallLocation から引用符を外して使う
    ReadRegStr $R1 HKCU "Software\${MANUFACTURER}\${OLD_PRODUCTNAME}" ""
    ${If} $R1 == ""
      ReadRegStr $R1 HKCU "${OLD_UNINSTKEY}" "InstallLocation"
      StrCpy $R2 $R1 1
      ${If} $R2 == '"'
        StrCpy $R1 $R1 "" 1
      ${EndIf}
      StrCpy $R2 $R1 1 -1
      ${If} $R2 == '"'
        StrCpy $R1 $R1 -1
      ${EndIf}
    ${EndIf}

    ${If} $R1 != ""
    ${AndIf} ${FileExists} "$R1\uninstall.exe"
      DetailPrint "Removing ${OLD_PRODUCTNAME} from $R1"
      ClearErrors
      ExecWait '"$R1\uninstall.exe" /S _?=$R1' $R2
      ${IfThen} ${Errors} ${|} StrCpy $R2 2 ${|}

      ${If} $R2 = 0
        Delete "$R1\uninstall.exe"
        RMDir "$R1"
        ; 旧版のインストール先と言語の記録（アプリのデータではない）
        DeleteRegKey HKCU "Software\${MANUFACTURER}\${OLD_PRODUCTNAME}"
        DeleteRegKey /ifempty HKCU "Software\${MANUFACTURER}"
      ${Else}
        DetailPrint "Could not remove ${OLD_PRODUCTNAME} (exit code $R2)"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  Pop $R2
  Pop $R1
  Pop $R0
!macroend
