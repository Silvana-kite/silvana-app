param([Parameter(Mandatory=$true)][int]$NativeProcessId, [switch]$Resume)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../artifacts/release-history'))
$destination = [IO.Path]::Combine($artifactRoot, 'node-v12.22.12-headers.tar.gz')
if (Test-Path -LiteralPath $destination) { throw 'The test download already exists; refusing an unattended overwrite.' }
$probeArguments = if ($Resume) { 'native-download.mjs --verify-only' } else { 'native-download.mjs' }
$probe = Start-Process -FilePath (Get-Command node).Source -ArgumentList $probeArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifactRoot 'native-download.stdout.log') -RedirectStandardError (Join-Path $artifactRoot 'native-download.stderr.log')
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $NativeProcessId)
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $deadline) {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  foreach ($window in $windows) {
    $editCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $fields = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    $pattern = $null
    foreach ($field in $fields) {
      $candidate = $null
      if ($field.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$candidate) -and -not $candidate.Current.IsReadOnly -and $candidate.Current.Value -like '*node-v12.22.12-headers*') { $pattern = $candidate; break }
    }
    if (-not $pattern) { continue }
    $pattern.SetValue($destination)
    $saveId = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1')
    $saveType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $saveCondition = New-Object System.Windows.Automation.AndCondition($saveId, $saveType)
    $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $saveCondition)
    if (-not $button) { throw 'Save button missing' }
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Write-Output 'Saved the official archive into the workspace verification directory.'
    $finishDeadline = [DateTime]::UtcNow.AddSeconds(90)
    while (-not $probe.HasExited -and [DateTime]::UtcNow -lt $finishDeadline) { Start-Sleep -Milliseconds 250; $probe.Refresh() }
    Get-Content (Join-Path $artifactRoot 'native-download.stdout.log')
    $reportPath = Join-Path $artifactRoot 'native-download-verification.json'
    $report = if (Test-Path -LiteralPath $reportPath) { Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json } else { $null }
    $actualHash = if (Test-Path -LiteralPath $destination) { (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash } else { '' }
    if (-not $probe.HasExited -or ($null -ne $probe.ExitCode -and $probe.ExitCode -ne 0) -or -not $report.officialChecksumMatched -or $actualHash -ne $report.sha256) { Get-Content (Join-Path $artifactRoot 'native-download.stderr.log'); throw 'Native download verification failed' }
    Write-Output 'Native save dialog and official checksum verification completed.'
    exit 0
  }
  Start-Sleep -Milliseconds 250
}
throw 'Native save dialog was not found for the specified test process.'
