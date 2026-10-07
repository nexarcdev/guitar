; Fretline Engine installer (Inno Setup 6). Per-user: no admin prompt, installs under
; %LOCALAPPDATA%\Programs, optionally starts with Windows.
; Build: iscc /DAppVersion=0.1.0 fretline-engine.iss  (after cargo build --release)

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{8C3E6F1A-5B2D-4F7E-9A11-3D2C4B5E6F70}
AppName=Fretline Engine
AppVersion={#AppVersion}
AppVerName=Fretline Engine {#AppVersion}
AppPublisher=Fretline
AppPublisherURL=https://nexarcdev.github.io/guitar/
DefaultDirName={localappdata}\Programs\Fretline Engine
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\target\installer
OutputBaseFilename=FretlineEngineSetup
SetupIconFile=fretline.ico
UninstallDisplayIcon={app}\fretline.ico
UninstallDisplayName=Fretline Engine
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "startup"; Description: "Start the engine when I sign in to Windows (recommended)"

[Files]
Source: "..\target\release\fretline-engine.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "fretline.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\Fretline Engine"; Filename: "{app}\fretline-engine.exe"; IconFilename: "{app}\fretline.ico"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "FretlineEngine"; ValueData: """{app}\fretline-engine.exe"""; Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\fretline-engine.exe"; Description: "Start the Fretline engine now"; Flags: nowait postinstall

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM fretline-engine.exe"; Flags: runhidden; RunOnceId: "StopEngine"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\Fretline"

[Code]
// An engine that's running holds its exe open; stop it before replacing it.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM fretline-engine.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;
