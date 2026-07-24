; Inno Setup script — installs the MultiViewer conversion agent as a Windows
; service, bundling a portable LibreOffice so the target PC needs nothing else.
;
; Prerequisites next to this script before compiling (see packaging/README.md):
;   build\mv-agent.exe            (node packaging/build-agent.mjs --node node.exe --out build\mv-agent.exe)
;   vendor\LibreOffice\           (portable LibreOffice; program\soffice.exe inside)
;   vendor\nssm.exe               (https://nssm.cc — wraps the exe as a service)
;
; Compile with Inno Setup (iscc mv-agent.iss) on Windows.

#define AppName "MultiViewer Agent"
#define AppVer "0.1.0"
#define SvcName "MvAgent"
; Origin(s) of the web page(s) that call the agent. Wildcards supported, so one
; entry covers a whole domain family (recommended — no reinstall as services grow):
;   iscc /DAllowedOrigins="https://*.company.com" mv-agent.iss
; Multiple: comma-separated (e.g. "https://*.company.com,http://*.corp").
#ifndef AllowedOrigins
  #define AllowedOrigins ""
#endif
; Optional central list endpoint (feature A). The agent fetches allowed origins
; from here on start and periodically — manage them centrally, no reinstall:
;   iscc /DAllowedOriginsUrl="https://config.company.com/allowed-origins" ...
#ifndef AllowedOriginsUrl
  #define AllowedOriginsUrl ""
#endif
#ifndef AgentPort
  #define AgentPort "7391"
#endif

[Setup]
AppName={#AppName}
AppVersion={#AppVer}
DefaultDirName={autopf}\MultiViewerAgent
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename=mv-agent-setup
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "build\mv-agent.exe";        DestDir: "{app}";               Flags: ignoreversion
Source: "vendor\nssm.exe";           DestDir: "{app}";               Flags: ignoreversion
Source: "vendor\LibreOffice\*";      DestDir: "{app}\LibreOffice";   Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
; Register the service (NSSM wraps the console exe so the SCM can manage it).
Filename: "{app}\nssm.exe"; Parameters: "install {#SvcName} ""{app}\mv-agent.exe"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#SvcName} AppDirectory ""{app}"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#SvcName} Start SERVICE_AUTO_START"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set {#SvcName} AppEnvironmentExtra SOFFICE_PATH={app}\LibreOffice\program\soffice.exe MV_PORT={#AgentPort} MV_ALLOWED_ORIGINS={#AllowedOrigins} MV_ALLOWED_ORIGINS_URL={#AllowedOriginsUrl}"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "start {#SvcName}"; Flags: runhidden

[UninstallRun]
Filename: "{app}\nssm.exe"; Parameters: "stop {#SvcName}";   Flags: runhidden; RunOnceId: "StopSvc"
Filename: "{app}\nssm.exe"; Parameters: "remove {#SvcName} confirm"; Flags: runhidden; RunOnceId: "RemoveSvc"
