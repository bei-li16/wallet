param([int]$x, [int]$y, [string]$keys = "")
# GUI test helper: DPI-aware physical-coordinate mouse click + optional keyboard input
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NativeInput {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
}
'@
[NativeInput]::SetProcessDPIAware() | Out-Null
[NativeInput]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 150
[NativeInput]::mouse_event(2, 0, 0, 0, 0)
[NativeInput]::mouse_event(4, 0, 0, 0, 0)
Start-Sleep -Milliseconds 300
if ($keys -ne "") {
    $shell = New-Object -ComObject WScript.Shell
    $shell.SendKeys($keys)
}
Write-Output "clicked($x,$y) keys='$keys'"
