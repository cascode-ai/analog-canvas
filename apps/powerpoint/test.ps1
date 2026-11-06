param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1') -Output $Output
$destination = [IO.Path]::GetFullPath($Output)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$office = Join-Path $env:WINDIR 'assembly\GAC_MSIL\office\15.0.0.0__71e9bce111e9429c\OFFICE.DLL'
$extensibility = Join-Path $env:WINDIR 'assembly\GAC\Extensibility\7.0.3300.0__b03f5f7f11d50a3a\extensibility.dll'
& $compiler /nologo "/out:$destination\VerifyTransparency.exe" "/r:$destination\CircuitCanvas.dll" "/r:$office" "/r:$extensibility" /r:Microsoft.CSharp.dll /r:System.Drawing.dll "$PSScriptRoot\tests\VerifyTransparency.cs"
if ($LASTEXITCODE -ne 0) { throw 'Native contract test compilation failed' }
& (Join-Path $destination 'VerifyTransparency.exe') $destination
if ($LASTEXITCODE -ne 0) { throw 'Native contract validation failed. A running Windows desktop PowerPoint instance is required.' }
