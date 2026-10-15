; Included by electron-builder's NSIS installer (see electron-builder.yml).
;
; Adds a Windows Firewall rule so phones on the local network can reach the pairing server
; (HTTPS + WebSocket). It is the same rule the app's "Allow through firewall" button adds
; (src/main/firewall/powershell.ts): inbound TCP, this program only, private and domain
; networks. A program rule rather than a port rule, so it still applies when the default
; port is taken and the server falls back to a random one.
;
; netsh needs admin rights, which only an "anyone who uses this computer" install has. For a
; "only for me" install these calls fail quietly and the app offers the button (one UAC
; prompt) instead; a rule added that way outlives an "only for me" uninstall, harmlessly,
; since it names a program that is gone.

!macro shiftpaneNetsh ARGS
  Push $0
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall ${ARGS}'
  Pop $0 ; exit code, ignored as explained above
  Pop $0
!macroend

!macro customInstall
  ; Replace rather than duplicate the rule from an earlier install.
  !insertmacro shiftpaneNetsh 'delete rule name="ShiftPane" dir=in program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  !insertmacro shiftpaneNetsh 'add rule name="ShiftPane" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=tcp profile=private,domain enable=yes description="Lets phones on your local network pair with ShiftPane."'
!macroend

!macro customUnInstall
  !insertmacro shiftpaneNetsh 'delete rule name="ShiftPane" dir=in program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend
