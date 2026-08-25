# -*- coding: utf-8 -*-
"""手工构建 VSIX（vsix = 特定结构的 zip），绕过 vsce"""
import os, zipfile, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'stock-watch-0.1.0.vsix')

CONTENT_TYPES = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="manifest" ContentType="text/xml"/>
  <Default Extension="xml" ContentType="text/xml"/>
  <Default Extension="map" ContentType="application/octet-stream"/>
</Types>'''

VSIXMANIFEST = '''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2010" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="stock-watch" Version="0.1.0" Publisher="buddy"/>
    <DisplayName>Stock Watch - Stock Ticker &amp; Quotes</DisplayName>
    <Description xml:space="preserve">Realtime stock quotes in VSCode sidebar &amp; status bar. A-shares, indexes, HK &amp; US stocks.</Description>
    <Tags>stock,quotes,watch</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>'''

def main():
    if os.path.exists(OUT):
        os.remove(OUT)
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CONTENT_TYPES)
        z.writestr('extension.vsixmanifest', VSIXMANIFEST)
        # package.json
        z.write(os.path.join(ROOT, 'package.json'), 'extension/package.json')
        # out/
        out_dir = os.path.join(ROOT, 'out')
        for name in os.listdir(out_dir):
            if name.endswith('.js'):
                z.write(os.path.join(out_dir, name), f'extension/out/{name}')
        # media/
        media_dir = os.path.join(ROOT, 'media')
        for name in os.listdir(media_dir):
            z.write(os.path.join(media_dir, name), f'extension/media/{name}')
        # README
        readme = os.path.join(ROOT, 'README.md')
        if os.path.exists(readme):
            z.write(readme, 'extension/README.md')
        # LICENSE
        lic = os.path.join(ROOT, 'LICENSE')
        if os.path.exists(lic):
            z.write(lic, 'extension/LICENSE')
    size = os.path.getsize(OUT)
    print(f'VSIX built: {OUT} ({size} bytes)')
    with zipfile.ZipFile(OUT) as z:
        for n in z.namelist():
            print(' ', n)

if __name__ == '__main__':
    main()
