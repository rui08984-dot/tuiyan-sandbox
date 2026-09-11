$ErrorActionPreference = 'Stop'
$src = 'E:\music player\docs\sandbox\p0-replay\sources\_jianshu-s02e01.html'
$out = 'E:\music player\docs\sandbox\p0-replay\sources\_artdump.txt'
$t = [System.IO.File]::ReadAllText($src)
$s = $t.IndexOf('<article')
$e = $t.IndexOf('</article>')
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine(('ARTLEN=' + ($e - $s)))
$step = 900
for ($i = $s; $i -lt $e; $i += $step) {
  $len = [Math]::Min($step, $e - $i)
  [void]$sb.AppendLine($t.Substring($i, $len))
}
[System.IO.File]::WriteAllText($out, $sb.ToString(), [System.Text.Encoding]::UTF8)