param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$destination = [IO.Path]::GetFullPath($Output)
$archive = $destination + '.zip'
if ((Test-Path -LiteralPath $destination) -or (Test-Path -LiteralPath $archive)) {
    throw 'Choose a new output path; existing installations and archives are never replaced.'
}
function Assert-CleanSource {
    $dirty = & git -C $repository status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit the source before building a distribution.' }
}
Assert-CleanSource
$commit = (& git -C $repository rev-parse HEAD).Trim()
# Rebuild every shipped bundle here, rather than trusting a caller-supplied runtime.
# No registration occurs; native acceptance uses only its own temporary presentation.
Push-Location $repository
try {
    & pnpm --filter '@icm/editor^...' --if-present build
    if ($LASTEXITCODE -ne 0) { throw 'Shared dependency build failed' }
    & pnpm --filter '@icm/editor' exec vite build --config vite.desktop.config.ts
    if ($LASTEXITCODE -ne 0) { throw 'Offline renderer build failed' }
    & pnpm --filter '@icm/desktop' build:preview
    if ($LASTEXITCODE -ne 0) { throw 'Desktop shell build failed' }
    & pnpm --filter '@icm/desktop' package:preview
    if ($LASTEXITCODE -ne 0) { throw 'Desktop assembly failed' }
    $manifest = Get-Content -LiteralPath 'plan/preview-package.json' -Raw | ConvertFrom-Json
    if ($manifest.commit -ne $commit) { throw 'Source changed during the build' }
    & pnpm --filter '@icm/desktop' test:preview
    if ($LASTEXITCODE -ne 0) { throw 'Packaged desktop acceptance failed' }
    $desktopAcceptance = Get-Content -LiteralPath (Join-Path $manifest.output 'ACCEPTANCE.json') -Raw | ConvertFrom-Json
    if ($desktopAcceptance.status -ne 'passed' -or $desktopAcceptance.source -ne $commit -or !$desktopAcceptance.packaged) {
        throw 'Missing matching packaged desktop acceptance'
    }
    $nativeTest = Join-Path $repository ('output/powerpoint-acceptance-' + [Guid]::NewGuid().ToString('N'))
    & (Join-Path $PSScriptRoot 'test.ps1') -Output $nativeTest
    # Import the Project extracted from a saved/reopened PPT into the real editor.
    & node apps/desktop/scripts/accept-powerpoint-close.mjs $manifest.executable (Join-Path $nativeTest 'reopened.icproj.json') (Join-Path $nativeTest 'VerifyCancellation.exe')
    if ($LASTEXITCODE -ne 0) { throw 'PowerPoint editor acceptance failed' }
    Assert-CleanSource
    if ((& git rev-parse HEAD).Trim() -ne $commit) { throw 'Source changed during acceptance' }
    New-Item -ItemType Directory -Path $destination | Out-Null
    foreach ($file in @('CircuitCanvas.dll','CircuitCanvas.Setup.exe','empty.icproj.json','README.html','install.ps1','install.cmd','uninstall.cmd')) {
        Copy-Item -LiteralPath (Join-Path $nativeTest $file) -Destination $destination
    }
    $runtimeTarget = Join-Path $destination 'runtime'
    New-Item -ItemType Directory -Path $runtimeTarget | Out-Null
    Copy-Item -LiteralPath $manifest.output -Destination (Join-Path $runtimeTarget 'Analog-Canvas-Windows-x64') -Recurse
    & git archive --format=zip "--output=$destination\source.zip" $commit
    if ($LASTEXITCODE -ne 0) { throw 'Source archive creation failed' }
    Copy-Item -LiteralPath 'LICENSE.md' -Destination $destination
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $destination 'BUILD.md')
    [IO.File]::WriteAllText((Join-Path $destination 'BUILD.txt'),"Optional PowerPoint integration`nSource commit: $commit`n",[Text.UTF8Encoding]::new($false))
    $acceptance = @{status='passed'; source=$commit; packaged=$true; checks=@('packaged-desktop','native-powerpoint-roundtrip','reopened-project-editor-import','powerpoint-save-close-eight-cases','cross-process-cancellation'); limitations='Native callback registration requires manual validation; editor acceptance isolates Office at the receipt/apply boundary and exercises the production C# receiver for cancellation races.'} | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText((Join-Path $destination 'ACCEPTANCE.json'),$acceptance,[Text.UTF8Encoding]::new($false))
    # Inspect the final distribution, including native binaries and nested source.
    & node scripts/desktop-package-security.mjs $destination
    if ($LASTEXITCODE -ne 0) { throw 'Complete package security checks failed; no ZIP was created' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($destination,$archive,[IO.Compression.CompressionLevel]::Optimal,$true)
    Write-Output "PowerPoint package: $archive"
} finally {
    Pop-Location
}
