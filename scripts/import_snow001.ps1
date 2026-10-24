# Deterministic channel packing only; no artistic processing of source pixels.
$ErrorActionPreference = 'Stop'
$snowRoot = Split-Path -Parent $PSScriptRoot
$snowSource = Join-Path ([IO.Path]::GetTempPath()) 'vtt-snow-candidates/Snow001'
if (!(Test-Path -LiteralPath (Join-Path $snowSource 'material.json'))) {
    & (Join-Path $snowRoot '.venv/Scripts/python.exe') (Join-Path $PSScriptRoot 'prepare_snow_candidates.py') Snow001
    if ($LASTEXITCODE -ne 0) { throw 'Snow001 download failed' }
}
$snowManifest = Get-Content -Raw (Join-Path $snowSource 'material.json') | ConvertFrom-Json
foreach ($snowChannel in @('color','normal','roughness')) {
    $snowHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $snowSource "$snowChannel.jpg")).Hash.ToLowerInvariant()
    if ($snowHash -ne $snowManifest.maps.$snowChannel.sha256) { throw "Source checksum mismatch: $snowChannel" }
}
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System.Drawing;
using System.Drawing.Imaging;
public static class SnowChannelPacking {
    public static void Pack(string colorPath, string roughnessPath, string outputPath) {
        using (var color = new Bitmap(colorPath))
        using (var roughness = new Bitmap(roughnessPath))
        using (var result = new Bitmap(color.Width, color.Height, PixelFormat.Format32bppArgb)) {
            if (color.Width != roughness.Width || color.Height != roughness.Height)
                throw new System.Exception("Snow map dimensions differ");
            for (int y=0; y<color.Height; ++y) for (int x=0; x<color.Width; ++x) {
                var c=color.GetPixel(x,y);
                result.SetPixel(x,y,Color.FromArgb(roughness.GetPixel(x,y).R,c.R,c.G,c.B));
            }
            result.Save(outputPath, ImageFormat.Png);
        }
    }
}
'@
$snowTarget = Join-Path $snowRoot 'app/static/materials/terrain/snow001'
New-Item -ItemType Directory -Force -Path $snowTarget | Out-Null
[SnowChannelPacking]::Pack((Join-Path $snowSource 'color.jpg'), (Join-Path $snowSource 'roughness.jpg'), (Join-Path $snowTarget 'color_roughness.png'))
Copy-Item -LiteralPath (Join-Path $snowSource 'normal.jpg') -Destination (Join-Path $snowTarget 'normal.jpg')
$snowMaps = @{}
foreach ($snowEntry in @{color='color_roughness.png';normal='normal.jpg'}.GetEnumerator()) {
    $snowMaps[$snowEntry.Key] = @{file=$snowEntry.Value;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $snowTarget $snowEntry.Value)).Hash.ToLowerInvariant()}
}
$snowOutputManifest = @{id='Snow001';sourceUrl=$snowManifest.sourceUrl;license='CC0';licenseUrl=$snowManifest.licenseUrl;
    resolution='1k';normalFormat='OpenGL';packing='Color RGB + Roughness A; AO=1, metallic=0';
    archiveUrl=$snowManifest.archiveUrl;archiveSha256=$snowManifest.archiveSha256;sourceMaps=$snowManifest.maps;maps=$snowMaps} |
    ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $snowTarget 'material.json'), $snowOutputManifest + "`n", [Text.UTF8Encoding]::new($false))
Write-Output 'Snow001: lossless Color/Roughness packing, unchanged NormalGL, two shared maps.'
