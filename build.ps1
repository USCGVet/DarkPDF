# Builds dist\DarkPDF.html — a single self-contained file (app + PDF.js + worker + KJV).
# Works offline and from file:// (worker is spawned from an embedded blob).
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$html   = [IO.File]::ReadAllText("$root\index.html")
$css    = [IO.File]::ReadAllText("$root\app.css")
$js     = [IO.File]::ReadAllText("$root\app.js")
$kjvJs  = [IO.File]::ReadAllText("$root\kjv.js")
$pdfB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$root\libs\pdf.min.js"))
$wrkB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$root\libs\pdf.worker.min.js"))
$kjvData = [IO.File]::ReadAllText("$root\libs\kjv.b64.js")

$cssBlock = "<style>`n$css`n</style>"

$pdfBlock = @"
<script>
window.__PDFJS_WORKER_B64__ = "$wrkB64";
(function () {
  function b64ToText(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  (0, eval)(b64ToText("$pdfB64"));
})();
</script>
"@

# libs/kjv.b64.js already assigns window.__KJV_B64__, so it inlines as-is.
# kjv.js inflates it on first use; raw it would add 4.1 MB to this file.
$kjvBlock = @"
<script>
$kjvData
</script>
<script>
$kjvJs
</script>
"@

$jsBlock = "<script>`n$js`n</script>"

$html = $html.Replace('<!--__INLINE_CSS__--><link rel="stylesheet" href="app.css"><!--__/INLINE_CSS__-->', $cssBlock)
$html = $html.Replace('<!--__PDFJS__--><script src="libs/pdf.min.js"></script><!--__/PDFJS__-->', $pdfBlock)
$html = $html.Replace('<!--__KJVJS__--><script src="kjv.js"></script><!--__/KJVJS__-->', $kjvBlock)
$html = $html.Replace('<!--__INLINE_JS__--><script src="app.js"></script><!--__/INLINE_JS__-->', $jsBlock)

# An asset that silently failed to inline would still open, then break on
# first use — so fail the build here instead of shipping it.
foreach ($marker in @('__INLINE_CSS__', '__PDFJS__', '__KJVJS__', '__INLINE_JS__')) {
  if ($html.Contains($marker)) { throw "build.ps1: $marker was not substituted" }
}
foreach ($needle in @('window.__PDFJS_WORKER_B64__ = "', 'window.__KJV_B64__', 'window.KJV = ')) {
  if (-not $html.Contains($needle)) { throw "build.ps1: expected inlined content missing ($needle)" }
}

if (-not (Test-Path "$root\dist")) { New-Item -ItemType Directory "$root\dist" | Out-Null }
[IO.File]::WriteAllText("$root\dist\DarkPDF.html", $html, (New-Object Text.UTF8Encoding($false)))
$size = (Get-Item "$root\dist\DarkPDF.html").Length
Write-Host ("dist\DarkPDF.html written ({0:N0} bytes; KJV adds {1:N0})" -f $size, $kjvData.Length)
