param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$destination = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$office = Join-Path $env:WINDIR 'assembly\GAC_MSIL\office\15.0.0.0__71e9bce111e9429c\OFFICE.DLL'
$extensibility = Join-Path $env:WINDIR 'assembly\GAC\Extensibility\7.0.3300.0__b03f5f7f11d50a3a\extensibility.dll'
foreach ($file in @($compiler, $office, $extensibility)) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing build prerequisite: $file. Install Windows x64 desktop Office with .NET programmability support." }
}
& $compiler /nologo /target:library "/out:$destination\CircuitCanvas.dll" "/reference:$office" "/reference:$extensibility" /reference:Microsoft.CSharp.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "$PSScriptRoot\src\CircuitCanvas.cs" "$PSScriptRoot\src\HistoryDialog.cs" "$PSScriptRoot\src\RibbonArtwork.cs"
if ($LASTEXITCODE -ne 0) { throw 'Add-in compilation failed' }
& $compiler /nologo /target:winexe "/out:$destination\CircuitCanvas.Setup.exe" /reference:System.Windows.Forms.dll "$PSScriptRoot\src\Installer.cs"
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
foreach ($file in @('empty.icproj.json','README.html','install.ps1','install.cmd','uninstall.cmd')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $destination -Force
}
