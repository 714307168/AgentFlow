$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$assetsDir = Join-Path $rootDir "assets"

if (-not (Test-Path $assetsDir)) {
  New-Item -ItemType Directory -Path $assetsDir | Out-Null
}

$pngPath = Join-Path $assetsDir "app-icon.png"
$icoPath = Join-Path $assetsDir "app-icon.ico"

$size = 256
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$rect = New-Object System.Drawing.RectangleF(16, 16, 224, 224)
$radius = 58.0
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$diameter = $radius * 2
$path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
$path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
$path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()

$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.PointF(0, 0)),
  (New-Object System.Drawing.PointF($size, $size)),
  [System.Drawing.ColorTranslator]::FromHtml("#0d1824"),
  [System.Drawing.ColorTranslator]::FromHtml("#163249")
)
$graphics.FillPath($bgBrush, $path)

$topBarBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(28, 255, 255, 255))
$graphics.FillRectangle($topBarBrush, 34, 40, 188, 24)

$penMain = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(225, 237, 244, 251), 16)
$penMain.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penMain.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$penSoft = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(168, 237, 244, 251), 16)
$penSoft.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penSoft.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$coreBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.PointF(96, 96)),
  (New-Object System.Drawing.PointF(184, 184)),
  [System.Drawing.ColorTranslator]::FromHtml("#5dd0ff"),
  [System.Drawing.ColorTranslator]::FromHtml("#3fd88f")
)

$nodeTopBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#5dd0ff"))
$nodeLeftBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#7ee6ff"))
$nodeRightBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#3fd88f"))
$darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#08111a"))

$graphics.DrawLine($penMain, 128, 94, 86, 161)
$graphics.DrawLine($penMain, 128, 94, 170, 161)
$graphics.DrawLine($penSoft, 96, 182, 160, 182)

$graphics.FillEllipse($nodeTopBrush, 103, 49, 50, 50)
$graphics.FillEllipse($nodeLeftBrush, 45, 157, 50, 50)
$graphics.FillEllipse($nodeRightBrush, 161, 157, 50, 50)

$graphics.TranslateTransform(128, 140)
$graphics.RotateTransform(45)
$graphics.FillRectangle($coreBrush, -26, -26, 52, 52)
$graphics.ResetTransform()

$graphics.FillRectangle($darkBrush, 122, 109, 12, 61)
$graphics.FillRectangle($darkBrush, 97, 134, 61, 12)

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = New-Object System.IO.BinaryWriter($stream)

$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Flush()
$writer.Dispose()
$stream.Dispose()

$coreBrush.Dispose()
$nodeTopBrush.Dispose()
$nodeLeftBrush.Dispose()
$nodeRightBrush.Dispose()
$darkBrush.Dispose()
$penMain.Dispose()
$penSoft.Dispose()
$topBarBrush.Dispose()
$bgBrush.Dispose()
$path.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
