# Builds dist\DarkPDF.html — a single self-contained file (app + PDF.js + worker).
# Works offline and from file:// (worker is spawned from an embedded blob).
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$html   = [IO.File]::ReadAllText("$root\index.html")
$css    = [IO.File]::ReadAllText("$root\app.css")
$js     = [IO.File]::ReadAllText("$root\app.js")
$pdfB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$root\libs\pdf.min.js"))
$wrkB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$root\libs\pdf.worker.min.js"))

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

$jsBlock = "<script>`n$js`n</script>"

$html = $html.Replace('<!--__INLINE_CSS__--><link rel="stylesheet" href="app.css"><!--__/INLINE_CSS__-->', $cssBlock)
$html = $html.Replace('<!--__PDFJS__--><script src="libs/pdf.min.js"></script><!--__/PDFJS__-->', $pdfBlock)
$html = $html.Replace('<!--__INLINE_JS__--><script src="app.js"></script><!--__/INLINE_JS__-->', $jsBlock)

if (-not (Test-Path "$root\dist")) { New-Item -ItemType Directory "$root\dist" | Out-Null }
[IO.File]::WriteAllText("$root\dist\DarkPDF.html", $html, (New-Object Text.UTF8Encoding($false)))
$size = (Get-Item "$root\dist\DarkPDF.html").Length
Write-Host ("dist\DarkPDF.html written ({0:N0} bytes)" -f $size)
