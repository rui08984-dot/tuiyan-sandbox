param([string]$HtmlPath, [string]$OutPath)
$html = [IO.File]::ReadAllText($HtmlPath)
if ($html -match '<title>(.*?)</title>') { Write-Output ("TITLE: " + $Matches[1]) }
foreach ($k in @('mp-editor','<article','"time"','article-info')) {
  Write-Output ("has $k : " + $html.Contains($k))
}
$text = $html -replace '(?s)<script[^>]*>.*?</script>','' -replace '(?s)<style[^>]*>.*?</style>',''
$text = $text -replace '(?s)<[^>]+>',[char]10
$text = $text -replace '&nbsp;',' ' -replace '&amp;','&' -replace '&gt;','>' -replace '&lt;','<'
$lines = $text -split [char]10 | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
$joined = $lines -join [char]10
Write-Output ("TEXTLEN=" + $joined.Length)
[IO.File]::WriteAllText($OutPath, $joined, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "SAVED"
