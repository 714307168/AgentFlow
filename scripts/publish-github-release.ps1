param(
    [string]$Repo,
    [string]$Tag,
    [string]$Name,
    [string]$TargetCommitish,
    [string]$Notes,
    [string]$NotesFile,
    [string]$DesktopAsset,
    [string]$AndroidAsset,
    [string]$RelayAsset,
    [switch]$SkipDesktopAsset,
    [switch]$SkipAndroidAsset,
    [switch]$SkipRelayAsset,
    [switch]$Draft,
    [switch]$Prerelease,
    [switch]$GenerateNotes,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
}

function Get-RequiredTool {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Required tool not found: $Name"
    }

    return $command.Source
}

function Get-RepoRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Get-GitHubToken {
    if ($env:GITHUB_TOKEN) {
        return $env:GITHUB_TOKEN
    }
    if ($env:GH_TOKEN) {
        return $env:GH_TOKEN
    }
    throw "Set GITHUB_TOKEN or GH_TOKEN before publishing GitHub Releases."
}

function Resolve-GitHubRepo {
    param([string]$ExplicitRepo)

    if ($ExplicitRepo) {
        return $ExplicitRepo
    }

    $remoteUrl = (git remote get-url origin).Trim()
    if (-not $remoteUrl) {
        throw "Unable to resolve git remote origin."
    }

    if ($remoteUrl -match 'github\.com[:/](.+?)/(.+?)(\.git)?$') {
        return "$($Matches[1])/$($Matches[2])"
    }

    throw "Remote origin is not a GitHub repository: $remoteUrl"
}

function Resolve-TargetCommitish {
    param([string]$ExplicitTargetCommitish)

    if ($ExplicitTargetCommitish) {
        return $ExplicitTargetCommitish
    }

    $remoteInfo = git remote show origin 2>$null
    if ($LASTEXITCODE -eq 0) {
        $headBranchLine = $remoteInfo | Where-Object { $_ -match 'HEAD branch:\s*(.+)$' } | Select-Object -First 1
        if ($headBranchLine -and $headBranchLine -match 'HEAD branch:\s*(.+)$') {
            $resolvedHeadBranch = $Matches[1].Trim()
            if ($resolvedHeadBranch) {
                return $resolvedHeadBranch
            }
        }
    }

    $currentBranch = (git branch --show-current 2>$null).Trim()
    if ($LASTEXITCODE -eq 0 -and $currentBranch) {
        return $currentBranch
    }

    return "main"
}

function Get-DesktopVersion {
    param([string]$RepoRoot)

    $packageJson = Join-Path $RepoRoot "local-agent\package.json"
    return (Get-Content -Raw -Path $packageJson | ConvertFrom-Json).version
}

function Get-AndroidVersion {
    param([string]$RepoRoot)

    $gradleFile = Join-Path $RepoRoot "android-app\app\build.gradle.kts"
    $content = Get-Content -Raw -Path $gradleFile
    $match = [regex]::Match($content, 'versionName\s*=\s*"([^"]+)"')
    if (-not $match.Success) {
        throw "Unable to read Android versionName from $gradleFile"
    }
    return $match.Groups[1].Value
}

function Get-AndroidBuildRoot {
    param([string]$RepoRoot)

    if (-not [string]::IsNullOrWhiteSpace($env:AGENTFLOW_ANDROID_BUILD_DIR)) {
        return (Join-Path $env:AGENTFLOW_ANDROID_BUILD_DIR "AgentFlow")
    }

    $androidDir = Join-Path $RepoRoot "android-app"
    $driveRoot = [System.IO.Path]::GetPathRoot((Resolve-Path $androidDir).Path)
    return (Join-Path $driveRoot "agentflow-android-build\AgentFlow")
}

function Get-AndroidAssetCandidates {
    param(
        [string]$RepoRoot,
        [string]$Version
    )

    return @(
        (Join-Path $RepoRoot ("artifacts\AgentFlow-{0}-release.apk" -f $Version)),
        (Join-Path (Get-AndroidBuildRoot -RepoRoot $RepoRoot) "app\outputs\apk\release\app-release.apk"),
        (Join-Path $RepoRoot "android-app\app\build\outputs\apk\release\app-release.apk")
    )
}

function Resolve-AssetPath {
    param(
        [string]$PathValue,
        [string]$RepoRoot
    )

    if (-not $PathValue) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return (Resolve-Path -Path $PathValue).Path
    }

    return (Resolve-Path -Path (Join-Path $RepoRoot $PathValue)).Path
}

function Get-DefaultNotes {
    param(
        [string]$DesktopVersion,
        [string]$AndroidVersion
    )

    $dateText = Get-Date -Format "yyyy-MM-dd"
    return @"
AgentFlow release

- Date: $dateText
- Desktop version: $DesktopVersion
- Android version: $AndroidVersion
"@
}

function Get-ReleaseNotes {
    param(
        [string]$InlineNotes,
        [string]$FilePath,
        [string]$DesktopVersion,
        [string]$AndroidVersion
    )

    if ($InlineNotes) {
        return $InlineNotes
    }

    if ($FilePath) {
        return Get-Content -Raw -Path $FilePath
    }

    return Get-DefaultNotes -DesktopVersion $DesktopVersion -AndroidVersion $AndroidVersion
}

function New-GitHubHeaders {
    param([string]$Token)

    return @{
        Authorization           = "Bearer $Token"
        Accept                  = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
}

function Invoke-GitHubApi {
    param(
        [string]$Method,
        [string]$Uri,
        [hashtable]$Headers,
        $Body
    )

    $params = @{
        Method  = $Method
        Uri     = $Uri
        Headers = $Headers
    }

    if ($null -ne $Body) {
        $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
        $params["ContentType"] = "application/json; charset=utf-8"
    }

    return Invoke-RestMethod @params
}

function Get-ExistingRelease {
    param(
        [string]$RepoName,
        [string]$TagName,
        [hashtable]$Headers
    )

    $uri = "https://api.github.com/repos/$RepoName/releases/tags/$TagName"
    try {
        return Invoke-GitHubApi -Method "GET" -Uri $uri -Headers $Headers -Body $null
    }
    catch {
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = $_.Exception.Response.StatusCode.value__
        }
        if ($statusCode -eq 404) {
            return $null
        }
        throw
    }
}

function Remove-ExistingAsset {
    param(
        [string]$RepoName,
        [object]$Release,
        [string]$AssetName,
        [hashtable]$Headers
    )

    $existingAsset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
    if (-not $existingAsset) {
        return
    }

    Write-Step "Removing existing asset $AssetName"
    $deleteUri = "https://api.github.com/repos/$RepoName/releases/assets/$($existingAsset.id)"
    Invoke-GitHubApi -Method "DELETE" -Uri $deleteUri -Headers $Headers -Body $null | Out-Null
}

function Upload-ReleaseAsset {
    param(
        [string]$RepoName,
        [object]$Release,
        [string]$AssetPath,
        [hashtable]$Headers
    )

    if (-not $AssetPath) {
        return
    }

    $file = Get-Item -Path $AssetPath
    Remove-ExistingAsset -RepoName $RepoName -Release $Release -AssetName $file.Name -Headers $Headers

    $uploadBase = $Release.upload_url -replace '\{.*$', ''
    $uploadUri = "{0}?name={1}" -f $uploadBase, [System.Uri]::EscapeDataString($file.Name)
    Write-Step "Uploading asset $($file.Name)"
    $curlPath = Get-RequiredTool "curl.exe"
    $tempAssetPath = Join-Path $env:TEMP $file.Name

    try {
        Copy-Item -Path $file.FullName -Destination $tempAssetPath -Force
        & $curlPath `
            --fail `
            --silent `
            --show-error `
            --http1.1 `
            -X POST `
            $uploadUri `
            -H "Authorization: $($Headers.Authorization)" `
            -H "Accept: $($Headers.Accept)" `
            -H "X-GitHub-Api-Version: $($Headers['X-GitHub-Api-Version'])" `
            -H "Content-Type: application/octet-stream" `
            --data-binary "@$tempAssetPath" | Out-Null

        if ($LASTEXITCODE -ne 0) {
            throw "curl.exe upload failed for $($file.Name) with exit code $LASTEXITCODE"
        }
    }
    finally {
        Remove-Item -Path $tempAssetPath -Force -ErrorAction SilentlyContinue
    }
}

$repoRoot = Get-RepoRoot
$resolvedRepo = Resolve-GitHubRepo -ExplicitRepo $Repo
$resolvedTargetCommitish = Resolve-TargetCommitish -ExplicitTargetCommitish $TargetCommitish
$desktopVersion = Get-DesktopVersion -RepoRoot $repoRoot
$androidVersion = Get-AndroidVersion -RepoRoot $repoRoot
$resolvedTag = if ($Tag) { $Tag } else { "v$desktopVersion" }
$resolvedName = if ($Name) { $Name } else { "AgentFlow $resolvedTag" }
$releaseNotes = Get-ReleaseNotes -InlineNotes $Notes -FilePath $NotesFile -DesktopVersion $desktopVersion -AndroidVersion $androidVersion

$resolvedDesktopAsset = if ($SkipDesktopAsset) {
    $null
} elseif ($DesktopAsset) {
    Resolve-AssetPath -PathValue $DesktopAsset -RepoRoot $repoRoot
} else {
    $defaultDesktopAsset = Join-Path $repoRoot "local-agent\release\AgentFlow-$desktopVersion-x64-setup.exe"
    if (Test-Path $defaultDesktopAsset) { (Resolve-Path $defaultDesktopAsset).Path } else { $null }
}

$resolvedAndroidAsset = if ($SkipAndroidAsset) {
    $null
} elseif ($AndroidAsset) {
    Resolve-AssetPath -PathValue $AndroidAsset -RepoRoot $repoRoot
} else {
    $candidatePaths = Get-AndroidAssetCandidates -RepoRoot $repoRoot -Version $androidVersion
    $match = $candidatePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($match) { (Resolve-Path $match).Path } else { $null }
}

$resolvedRelayAsset = if ($SkipRelayAsset) {
    $null
} else {
    Resolve-AssetPath -PathValue $RelayAsset -RepoRoot $repoRoot
}
$assetPaths = @(@($resolvedDesktopAsset, $resolvedAndroidAsset, $resolvedRelayAsset) | Where-Object { $_ })

Write-Step "Repository: $resolvedRepo"
Write-Step "Tag: $resolvedTag"
Write-Step "Release name: $resolvedName"
Write-Step "Target commitish: $resolvedTargetCommitish"
if ($assetPaths.Count -gt 0) {
    Write-Step "Assets:"
    $assetPaths | ForEach-Object { Write-Host "   $_" }
} else {
    Write-Step "No assets found automatically. Pass -DesktopAsset / -AndroidAsset / -RelayAsset if needed."
}

if ($DryRun) {
    Write-Step "Dry run complete. No GitHub API calls were made."
    exit 0
}

$token = Get-GitHubToken
$headers = New-GitHubHeaders -Token $token
$existingRelease = Get-ExistingRelease -RepoName $resolvedRepo -TagName $resolvedTag -Headers $headers

if ($existingRelease) {
    Write-Step "Updating existing release $resolvedTag"
    $release = Invoke-GitHubApi -Method "PATCH" `
        -Uri "https://api.github.com/repos/$resolvedRepo/releases/$($existingRelease.id)" `
        -Headers $headers `
        -Body @{
            tag_name               = $resolvedTag
            target_commitish       = $resolvedTargetCommitish
            name                   = $resolvedName
            body                   = $releaseNotes
            draft                  = [bool]$Draft
            prerelease             = [bool]$Prerelease
            generate_release_notes = [bool]$GenerateNotes
        }
} else {
    Write-Step "Creating release $resolvedTag"
    $release = Invoke-GitHubApi -Method "POST" `
        -Uri "https://api.github.com/repos/$resolvedRepo/releases" `
        -Headers $headers `
        -Body @{
            tag_name               = $resolvedTag
            target_commitish       = $resolvedTargetCommitish
            name                   = $resolvedName
            body                   = $releaseNotes
            draft                  = [bool]$Draft
            prerelease             = [bool]$Prerelease
            generate_release_notes = [bool]$GenerateNotes
        }
}

foreach ($assetPath in $assetPaths) {
    Upload-ReleaseAsset -RepoName $resolvedRepo -Release $release -AssetPath $assetPath -Headers $headers
}

$finalRelease = Invoke-GitHubApi -Method "GET" `
    -Uri "https://api.github.com/repos/$resolvedRepo/releases/$($release.id)" `
    -Headers $headers `
    -Body $null

Write-Step "Release published: $($finalRelease.html_url)"
