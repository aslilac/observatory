# Build the app (src/desktop) as a Windows package: an MSIX, for people to
# download and install themselves. It lands in target/windows/, for the
# processor this machine's Rust builds for.
#
#   windows/build.ps1            not signed: Windows won't install it, so it's
#                                only good for looking at what's in it
#   $env:WINDOWS_CERTIFICATE = …; $env:WINDOWS_CERTIFICATE_PASSWORD = …
#   windows/build.ps1            signed with that certificate (a .pfx, in
#                                base64), which a PC has to trust already
#                                for the package to install
#
# They're the variables the release workflow has. The tools (MakePri,
# MakeAppx, SignTool) are the Windows SDK's.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Runs a program, and stops if it says it failed.
function Invoke-Tool([string]$tool, [string[]]$arguments) {
	& $tool @arguments
	if ($LASTEXITCODE -ne 0) {
		throw "$(Split-Path -Leaf $tool) failed ($LASTEXITCODE)"
	}
}

# The newest Windows SDK's copy of a tool, for this machine if it has one.
function Find-SdkTool([string]$name) {
	$kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
	$mine = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
	foreach ($for in @($mine, "x64", "x86")) {
		$found = Get-ChildItem -Path $kits -Filter $name -Recurse -ErrorAction SilentlyContinue |
			Where-Object {
				$_.Directory.Name -eq $for -and
				$_.Directory.Parent.Name -match '^\d+(\.\d+){3}$'
			} |
			Sort-Object { [version]$_.Directory.Parent.Name } |
			Select-Object -Last 1
		if ($found) {
			return $found.FullName
		}
	}
	throw "$name isn't here: install the Windows SDK"
}

# The processor the build is for: the one Rust builds for here.
$hostTriple = (rustc -vV | Select-String '^host: (.*)$').Matches[0].Groups[1].Value
$arch = if ($hostTriple -like "aarch64-*") { "arm64" } else { "x64" }

# The app's version is the desktop crate's.
$version = (Select-String -Path src/desktop/Cargo.toml -Pattern '^version = "(.*)"$' |
	Select-Object -First 1).Matches[0].Groups[1].Value

# A package's version is four numbers and nothing else, and Windows only
# ever replaces a package with one whose version is higher. So the fourth
# says where a version is on its way out: 1.2.0-beta.3 is 1.2.0.103, below
# 1.2.0-rc.1 (1.2.0.201), below 1.2.0 itself (1.2.0.1000).
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$') {
	throw "$version isn't a version a package's can be worked out from"
}
$numbers = "$($Matches[1]).$($Matches[2]).$($Matches[3])"
$stage = "$($Matches[4])"
$step = if ($Matches[5]) { [int]$Matches[5] } else { 0 }
if ($step -gt 99) {
	throw "$version has more prereleases than a package's version has room for"
}
$revision = 1000
if ($stage -eq "alpha") {
	$revision = $step
} elseif ($stage -eq "beta") {
	$revision = 100 + $step
} elseif ($stage -eq "rc") {
	$revision = 200 + $step
}
$packageVersion = "$numbers.$revision"

cargo build --release -p observatory
if ($LASTEXITCODE -ne 0) {
	throw "the build failed"
}

$out = "target\windows"
$package = Join-Path $out "package"
$msix = Join-Path $out "Observatory-win32-$arch-$version.msix"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $package "Assets") | Out-Null
Copy-Item target\release\observatory.exe (Join-Path $package "Observatory.exe")
Copy-Item build-resources\msix\*.png (Join-Path $package "Assets")

# Whose package it is: the certificate's subject, or with no certificate,
# nobody's in particular.
$pfx = $null
$publisher = "CN=Observatory (not signed)"
if ($env:WINDOWS_CERTIFICATE) {
	$pfx = Join-Path (Resolve-Path $out) "signing.pfx"
	[IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
	$certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
		$pfx, $env:WINDOWS_CERTIFICATE_PASSWORD)
	$publisher = $certificate.Subject
}

$manifest = Get-Content -Raw windows\AppxManifest.xml
$manifest = $manifest.Replace("{PUBLISHER}", [System.Security.SecurityElement]::Escape($publisher))
$manifest = $manifest.Replace("{VERSION}", $packageVersion)
$manifest = $manifest.Replace("{ARCH}", $arch)
[IO.File]::WriteAllText(
	(Join-Path (Resolve-Path $package) "AppxManifest.xml"),
	$manifest,
	(New-Object System.Text.UTF8Encoding($false)))

try {
	# The index of what's in the package, which is how Windows finds the
	# logo of the size it's after (Square44x44Logo.targetsize-32.png) by
	# the name the manifest has (Square44x44Logo.png). Its configuration
	# comes with a part for splitting the index across several packages,
	# which this isn't.
	$makepri = Find-SdkTool "makepri.exe"
	$config = Join-Path $out "priconfig.xml"
	Invoke-Tool $makepri @("createconfig", "/cf", $config, "/dq", "en-US", "/o")
	$whole = (Get-Content -Raw $config) -replace '(?s)<packaging>.*?</packaging>', ''
	Set-Content -Path $config -Value $whole -Encoding UTF8
	Invoke-Tool $makepri @(
		"new", "/pr", $package, "/cf", $config,
		"/mn", (Join-Path $package "AppxManifest.xml"),
		"/of", (Join-Path $package "resources.pri"), "/o")

	Invoke-Tool (Find-SdkTool "makeappx.exe") @("pack", "/d", $package, "/p", $msix, "/o")

	if ($pfx) {
		Invoke-Tool (Find-SdkTool "signtool.exe") @(
			"sign", "/fd", "SHA256", "/f", $pfx, "/p", $env:WINDOWS_CERTIFICATE_PASSWORD,
			"/tr", "http://timestamp.digicert.com", "/td", "SHA256", $msix)
		Write-Output "signed as $publisher"
	} else {
		Write-Output "not signed: Windows won't install this one"
	}
} finally {
	if ($pfx) {
		Remove-Item -Force $pfx -ErrorAction SilentlyContinue
	}
}
Write-Output "built $msix (package version $packageVersion)"
