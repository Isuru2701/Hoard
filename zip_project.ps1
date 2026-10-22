#!/usr/bin/env pwsh
# If RUN.game support asks for your project, run this to share your source.
# It’s meant for upload issues after you’ve tried everything else.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Get-Item -LiteralPath $PSScriptRoot
Set-Location -LiteralPath $root.FullName

$archiveName = "{0}.zip" -f $root.Name
$archivePath = Join-Path -Path $root.FullName -ChildPath $archiveName

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

$excludeDirs = @("node_modules", ".git")
$excludeFiles = @(".DS_Store", $archiveName)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$compressionLevel = [System.IO.Compression.CompressionLevel]::Optimal
$zipStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
$zip = [System.IO.Compression.ZipArchive]::new($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

function Add-ZipEntries {
    param(
        [string]$CurrentPath,
        [string]$RelativePath
    )

    foreach ($child in Get-ChildItem -LiteralPath $CurrentPath -Force) {
        if ($child.FullName -eq $archivePath) {
            continue
        }

        if ($child.PSIsContainer) {
            if ($excludeDirs -contains $child.Name) {
                continue
            }

            $childRelative = if ([string]::IsNullOrEmpty($RelativePath)) {
                $child.Name
            } else {
                "$RelativePath/$($child.Name)"
            }

            Add-ZipEntries -CurrentPath $child.FullName -RelativePath $childRelative
            continue
        }

        if ($excludeFiles -contains $child.Name) {
            continue
        }

        $entryName = if ([string]::IsNullOrEmpty($RelativePath)) {
            $child.Name
        } else {
            "$RelativePath/$($child.Name)"
        }

        $entry = $zip.CreateEntry($entryName, $compressionLevel)
        $fileStream = [System.IO.File]::OpenRead($child.FullName)
        $entryStream = $entry.Open()
        $fileStream.CopyTo($entryStream)
        $entryStream.Dispose()
        $fileStream.Dispose()
    }
}

Add-ZipEntries -CurrentPath $root.FullName -RelativePath ""

$zip.Dispose()
$zipStream.Dispose()

Write-Output "Created $archiveName"

