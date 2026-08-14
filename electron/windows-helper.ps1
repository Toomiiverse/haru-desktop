# Two things Electron cannot see or touch on its own: whether some other app has
# gone fullscreen, and the system's output volume.
#
# One long-lived process rather than a spawn per query. Starting PowerShell costs
# a few hundred milliseconds, which is fine once and useless as a poll — and
# ducking has to happen the instant she starts talking, not half a second later.
#
# Speaks two ways: events out on stdout, commands in on stdin.
#   out:  fullscreen on|off <window title>
#   out:  volume <0..1>
#   in:   volume <0..1>     set the system output volume
#   in:   quit

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Haru -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
// CharSet matters here and nowhere else in this block. GetWindowTextW fills the
// buffer with UTF-16; marshalled back as ANSI — the default — the first null
// byte of the first wide character ends the string, so every title in the app
// arrived as its own initial. "Onlyfans" came through as "o", and she spent a
// while asking why the screen was blank.
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder text, int count);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
[DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
[DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
public struct RECT { public int Left, Top, Right, Bottom; }
public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
'@

# Core Audio, only as far as the master output level. Per-application ducking
# needs the session enumerator and a great deal more interop; setting the endpoint
# and lifting her own gain to match achieves the same balance for far less.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int NotImpl1(); int NotImpl2();
  int GetChannelCount(out int count);
  int SetMasterVolumeLevel(float level, Guid ctx);
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int GetMasterVolumeLevel(out float level);
  int GetMasterVolumeLevelScalar(out float level);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid id, int ctx, IntPtr act, [MarshalAs(UnmanagedType.IUnknown)] out object dev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumeratorComObject { }
// Every COM call stays inside here. Handed back to PowerShell, the interface
// arrives as a bare __ComObject with none of its methods, so the work has to
// finish on this side of the boundary and return a plain float.
public class Audio {
  static IAudioEndpointVolume cached;
  static IAudioEndpointVolume Endpoint() {
    if (cached == null) {
      var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice device; enumerator.GetDefaultAudioEndpoint(0, 1, out device);
      var iid = typeof(IAudioEndpointVolume).GUID; object result;
      device.Activate(ref iid, 23, IntPtr.Zero, out result);
      cached = (IAudioEndpointVolume)result;
    }
    return cached;
  }
  public static float GetVolume() { float level; Endpoint().GetMasterVolumeLevelScalar(out level); return level; }
  public static void SetVolume(float level) { Endpoint().SetMasterVolumeLevelScalar(level, Guid.Empty); }
}
'@

function Get-Volume {
  try { return [math]::Round([Audio]::GetVolume(), 3) } catch { return -1 }
}
function Set-Volume([double]$level) {
  $clamped = [math]::Max(0.0, [math]::Min(1.0, $level))
  try { [Audio]::SetVolume([float]$clamped) } catch { }
}

# Fullscreen means the foreground window exactly covers its monitor. Checked this
# way rather than through SHQueryUserNotificationState because a browser playing
# video fullscreen is an ordinary borderless window and that API does not report
# it — which is the case this feature exists for.
function Test-Fullscreen {
  $hwnd = [Haru.Win]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero -or $hwnd -eq [Haru.Win]::GetShellWindow()) { return $null }
  $rect = New-Object Haru.Win+RECT
  if (-not [Haru.Win]::GetWindowRect($hwnd, [ref]$rect)) { return $null }
  $monitor = [Haru.Win]::MonitorFromWindow($hwnd, 2)
  if ($monitor -eq [IntPtr]::Zero) { return $null }
  $info = New-Object Haru.Win+MONITORINFO
  $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
  if (-not [Haru.Win]::GetMonitorInfo($monitor, [ref]$info)) { return $null }
  # A pixel of slack: some players sit a hair outside the monitor rect.
  $covers = ($rect.Left -le $info.rcMonitor.Left + 1) -and ($rect.Top -le $info.rcMonitor.Top + 1) -and
            ($rect.Right -ge $info.rcMonitor.Right - 1) -and ($rect.Bottom -ge $info.rcMonitor.Bottom - 1)
  if (-not $covers) { return $null }
  $title = New-Object System.Text.StringBuilder 512
  [void][Haru.Win]::GetWindowTextW($hwnd, $title, $title.Capacity)
  # The monitor comes back with it: on a multi-screen desk, knowing something is
  # fullscreen is not enough to know where to look.
  return [PSCustomObject]@{
    Title = $title.ToString()
    Left = $info.rcMonitor.Left; Top = $info.rcMonitor.Top
    Right = $info.rcMonitor.Right; Bottom = $info.rcMonitor.Bottom
  }
}

# Written straight to stdout rather than through Write-Output. Write-Output feeds
# PowerShell's own pipeline, which buffers on its own schedule and is not flushed
# by flushing the console — events sat unsent for as long as the process lived.
function Send-Event([string]$text) {
  [Console]::Out.WriteLine($text)
  [Console]::Out.Flush()
}

Send-Event "volume $(Get-Volume)"
Send-Event 'ready'

# What is in front of them, as "<process>|<title>". Reported on change so the app
# can react to opening Steam or switching to a spreadsheet. Polled far more slowly
# than the fullscreen check: this is a change of activity, not an event.
$BROWSERS = @('chrome','firefox','msedge','brave','opera','vivaldi','zen','librewolf','arc')

function Get-Foreground {
  $hwnd = [Haru.Win]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero -or $hwnd -eq [Haru.Win]::GetShellWindow()) { return $null }
  $procId = 0
  [void][Haru.Win]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  if ($procId -le 0) { return $null }
  $name = ''
  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { return $null }
  $title = New-Object System.Text.StringBuilder 512
  [void][Haru.Win]::GetWindowTextW($hwnd, $title, $title.Capacity)
  # Only for browsers, and only because the caller already established that the
  # window changed — this is the expensive call in the loop.
  $url = ''
  if ($BROWSERS -contains $name.ToLower()) { $url = Get-BrowserUrl $hwnd }
  # Pipe-separated because titles are full of spaces and dashes and nothing else
  # is a safe delimiter.
  return "$name|$($title.ToString())|$url"
}

# Reading the address bar out of a browser. The window title gives the page's
# name; only the URL says which page is actually open.
#
# Loaded lazily and guarded: UI Automation is not present on every machine, and
# walking a browser's element tree is slow enough that it must never run on the
# ordinary polling path — only when the foreground window has actually changed to
# a browser.
$uiaReady = $false
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
  $uiaReady = $true
} catch { }

function Get-BrowserUrl([IntPtr]$hwnd) {
  if (-not $script:uiaReady) { return '' }
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if (-not $root) { return '' }
    # Restricted to Edit controls, which is a couple of nodes rather than the
    # seventeen hundred in a browser window — walking all of them takes seconds.
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit)
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $edits -or $edits.Count -eq 0) { return '' }
    # Every one of them, not just the first. Opera exposes two — an empty
    # "Address bar" and the real "Address field" — and takes them in that order,
    # so stopping at the first Edit found nothing at all. Chromium happens to put
    # the url in its first, which is what made this look like it worked.
    foreach ($edit in $edits) {
      $value = ''
      try { $value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { continue }
      # The bar also holds whatever was typed, which is not always a url.
      if ($value -and $value -match '^(https?://|[\w.-]+\.[a-z]{2,}/)') { return $value }
    }
    return ''
  } catch { return '' }
}

$stdin = [System.IO.StreamReader]::new([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$wasFullscreen = $false
$lastForeground = ''
$sinceForeground = 0

while ($true) {
  if ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { break }
    $parts = $line.Trim().Split(' ')
    switch ($parts[0]) {
      # Acknowledged, not just done. The app raises her own gain to compensate
      # for this drop, and if it does so before the drop has actually happened
      # she is briefly loud. The ack is what lets it wait.
      'volume' { if ($parts.Length -gt 1) { Set-Volume ([double]$parts[1]); Send-Event "volume-set $($parts[1])" } }
      'quit'   { break }
    }
    $pending = $stdin.ReadLineAsync()
  }

  $found = Test-Fullscreen
  $now = $null -ne $found
  if ($now -ne $wasFullscreen) {
    $wasFullscreen = $now
    if ($now) { Send-Event "fullscreen on $($found.Left) $($found.Top) $($found.Right) $($found.Bottom) $($found.Title)" }
    else { Send-Event 'fullscreen off' }
  }
  # Every fourth pass, so roughly every two seconds. Switching windows is not
  # something that needs catching within half a second, and Get-Process is far
  # from free.
  $sinceForeground++
  if ($sinceForeground -ge 4) {
    $sinceForeground = 0
    $current = Get-Foreground
    if ($current -and $current -ne $lastForeground) {
      $lastForeground = $current
      Send-Event "foreground $current"
    }
  }

  Start-Sleep -Milliseconds 500
}
