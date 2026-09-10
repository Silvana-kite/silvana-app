param([Parameter(Mandatory=$true)][int]$NativeProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class HistoryNativeInput {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../artifacts/release-history'))
$destination = Join-Path $artifactRoot 'node-v12.22.12-headers.tar.gz'
if (Test-Path -LiteralPath $destination) { throw 'Refusing to overwrite an existing verification archive.' }
$processCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $NativeProcessId)
function Find-Control($type, $name, $seconds = 40) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  $typeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)
  while ([DateTime]::UtcNow -lt $deadline) {
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)
    foreach ($window in $windows) {
      $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $typeCondition)
      foreach ($control in $controls) { if ($control.Current.Name -like $name) { $script:ownerWindow = [IntPtr]$window.Current.NativeWindowHandle; return $control } }
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Control not found: $name"
}
function Invoke-Control($control) {
  Write-Output ("Activating: " + $control.Current.Name)
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); return }
  if ($control.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) { $pattern.Expand(); return }
  if ($control.Current.IsOffscreen) { throw 'Refusing to click an offscreen control.' }
  [HistoryNativeInput]::SetForegroundWindow($script:ownerWindow) | Out-Null
  if ([HistoryNativeInput]::GetForegroundWindow() -ne $script:ownerWindow) { throw 'The test window is not in the foreground.' }
  $point = $control.GetClickablePoint()
  [HistoryNativeInput]::SetCursorPos([int]$point.X, [int]$point.Y) | Out-Null
  [HistoryNativeInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [HistoryNativeInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
foreach ($label in @('关闭内置浏览器', '关闭版本面板')) {
  $closeControl = $null
  try { $closeControl = Find-Control ([System.Windows.Automation.ControlType]::Button) $label 1 } catch { }
  if ($closeControl) { Invoke-Control $closeControl }
}
Invoke-Control (Find-Control ([System.Windows.Automation.ControlType]::Button) 'Node.js 版本')
$search = Find-Control ([System.Windows.Automation.ControlType]::Edit) '搜索 Node.js 历史版本'
$searchPattern = $null
if ($search.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$searchPattern) -and -not $searchPattern.Current.IsReadOnly) { $searchPattern.SetValue('12.22.12') }
else {
  $search.SetFocus()
  if (-not $search.Current.HasKeyboardFocus -or [HistoryNativeInput]::GetForegroundWindow() -ne $script:ownerWindow) { throw 'The history search field is not focused.' }
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('12.22.12')
}
Invoke-Control (Find-Control ([System.Windows.Automation.ControlType]::Hyperlink) '12.22.12*')
Invoke-Control (Find-Control ([System.Windows.Automation.ControlType]::Hyperlink) 'node-v12.22.12-headers.tar.gz')
Write-Output 'Activated the official archive through the native accessibility interface.'
& (Join-Path $PSScriptRoot 'save-native-download.ps1') -NativeProcessId $NativeProcessId -Resume
