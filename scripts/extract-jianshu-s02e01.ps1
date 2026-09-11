$ErrorActionPreference = 'Stop'
$log = 'E:\music player\scripts\extract-jianshu-s02e01.log'
try {
  $src = 'E:\music player\docs\sandbox\p0-replay\sources\_jianshu-s02e01.html'
  $out = 'E:\music player\docs\sandbox\p0-replay\sources\werewolf-lyingman-s02e01-raw.txt'
  $t = [System.IO.File]::ReadAllText($src)
  $s = $t.IndexOf('<article')
  $e = $t.IndexOf('</article>')
  if ($s -lt 0 -or $e -lt 0) { throw ("article not found s=" + $s + " e=" + $e) }
  $art = $t.Substring($s, $e - $s + 10)
  $nl = [char]10
  $art = $art -replace '<br\s*/?>', $nl
  $art = $art -replace '</p>', $nl
  $art = $art -replace '<h2[^>]*>', ($nl + $nl)
  $art = $art -replace '</h2>', $nl
  $art = $art -replace '<h3[^>]*>', ($nl + $nl)
  $art = $art -replace '</h3>', $nl
  $art = $art -replace '</blockquote>', $nl
  $art = $art -replace '</li>', $nl
  $art = $art -replace '<a[^>]*href="([^"]*)"[^>]*>', '$1 | '
  $art = [regex]::Replace($art, '<[^>]+>', '')
  $art = [System.Net.WebUtility]::HtmlDecode($art)
  $art = [regex]::Replace($art, '(\n){3,}', ($nl + $nl))
  $art = $art.Trim()
  $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  $header = '来源URL: https://www.jianshu.com/p/d0e01c61956a' + $nl +
    '文章标题: 【lyingman狼人杀S02E01】JY封神之路-编剧和影帝第一回' + $nl +
    '作者: 简书「初三说」' + $nl +
    ('抓取时间: ' + $ts + ' (本机时间)') + $nl +
    '抓取方式: Invoke-WebRequest 抓取简书页面HTML, 提取 article 正文纯文本化, 未改动内容' + $nl +
    ('-' * 60) + $nl + $nl
  [System.IO.File]::WriteAllText($out, $header + $art, [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText($log, ('OK chars=' + $art.Length))
} catch {
  [System.IO.File]::WriteAllText($log, ('FAIL: ' + $_.Exception.ToString()))
}