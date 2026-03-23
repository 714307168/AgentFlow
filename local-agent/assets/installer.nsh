!include "getProcessInfo.nsh"

Var pid

!macro customCheckAppRunning
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    ${if} ${isUpdated}
      Sleep 300
    ${endIf}

    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      ${if} ${isUpdated}
        Sleep 1000
        Goto doStopProcess
      ${endIf}

      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
      Quit

      doStopProcess:
      DetailPrint `Closing running "${PRODUCT_NAME}"...`

      StrCpy $R1 0

      close_loop:
        IntOp $R1 $R1 + 1

        !ifdef INSTALL_MODE_PER_ALL_USERS
          nsExec::Exec `taskkill /t /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid"`
        !else
          nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /t /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
        !endif
        Sleep 1200

        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 != 0
          Goto not_running
        ${endif}

        !ifdef INSTALL_MODE_PER_ALL_USERS
          nsExec::Exec `taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid"`
        !else
          nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
        !endif
        Sleep 1800

        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 != 0
          Goto not_running
        ${endif}

        ${if} $R1 < 4
          DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
          Goto close_loop
        ${endif}

        MessageBox MB_OK|MB_ICONSTOP "Unable to close ${PRODUCT_NAME} automatically.$\r$\n$\r$\n请先关闭正在运行的程序，然后重新打开安装包。"
        Quit

      not_running:
    ${endIf}
  ${endIf}
!macroend
