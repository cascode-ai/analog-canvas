param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'CircuitCanvas.Setup.exe'
if (!(Test-Path -LiteralPath $installer)) { throw 'Extract the complete package before installing.' }
$arguments = @('/quiet')
if ($Uninstall) { $arguments += '/uninstall' }
$process = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Circuit Canvas setup failed with exit code $($process.ExitCode). Run CircuitCanvas.Setup.exe for details." }
if ($Uninstall) { 'Circuit Canvas unregistered for this user.' }
else { 'Circuit Canvas registered. Restart PowerPoint to load it.' }
