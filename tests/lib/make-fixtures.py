#!/usr/bin/env python3
"""テスト用の小さな ePub を生成する（tests/.fixtures/ 配下・gitignore 対象）。

  python3 tests/lib/make-fixtures.py

- reflow.epub  : リフロー本（4章・ルビと縦中横・SVG 表紙を含む）
- reflow2.epub : もう1冊のリフロー本（書名・著者違い＝bookKey が別になる）
- fxl.epub     : 固定レイアウト本（4ページ・rtl・pre-paginated）

実書籍に依存せずに E2E を回せるようにするのが目的。個人の蔵書（temp_sample/）は
gitignore されているため、クローン直後でもテストが通る状態を保つ。
"""
import os
import struct
import sys
import zipfile
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.fixtures')
W, H = 600, 900


def png(w, h, rgb):
    """単色 PNG をライブラリ無しで作る。"""
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw))
            + chunk(b'IEND', b''))


# 背景を単色ベタで塗る（サムネイルの隅の画素を見れば、内在サイズ補完が効いて
# レターボックスされていないことを確かめられる）
COVER_SVG = ('<?xml version="1.0" encoding="UTF-8"?>\n'
             '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200">'
             '<rect width="800" height="1200" fill="#1a2b3c"/>'
             '<text x="400" y="620" font-size="120" fill="#f0e6d2" text-anchor="middle"'
             ' font-family="serif">表紙</text></svg>')

CONTAINER = ('<?xml version="1.0"?><container version="1.0" '
             'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
             '<rootfile full-path="OEBPS/content.opf" '
             'media-type="application/oebps-package+xml"/></rootfiles></container>')


def opf(title, creator, items, refs, extra_meta='', ppd='rtl'):
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            '<dc:identifier id="bid">urn:uuid:yomikake-test-%s</dc:identifier>'
            '<dc:title>%s</dc:title><dc:creator>%s</dc:creator><dc:language>ja</dc:language>'
            '%s</metadata><manifest>%s</manifest>'
            '<spine page-progression-direction="%s">%s</spine></package>'
            % (title, title, creator, extra_meta, ''.join(items), ppd, ''.join(refs)))


def build_reflow(path, title='テスト用リフロー', creator='テスト作者'):
    z = zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED)
    z.writestr('mimetype', 'application/epub+zip')
    z.writestr('META-INF/container.xml', CONTAINER)
    # SVG 表紙（novel_downloader が出すのと同じ形）。width/height を持たず viewBox だけ
    # なので、しおり用サムネイル生成側の内在サイズ補完も一緒に検証できる。
    z.writestr('OEBPS/images/cover.svg', COVER_SVG)
    items, refs, navpoints = [], [], []
    items.append('<item id="cov" href="images/cover.svg" '
                 'media-type="image/svg+xml" properties="cover-image"/>')
    for i in range(4):
        # ルビと縦中横を含める（字間・行間・縦中横フィックスの検証に要る）
        body = ''.join('<p><ruby>本文<rt>ほんぶん</rt></ruby>です。縦書きの折り返しを'
                       '起こすために、ある程度の分量を並べておきます。'
                       '<span class="tcy">%02d</span>行目。</p>' % (n,)
                       for n in range(40))
        z.writestr('OEBPS/ch%d.xhtml' % i,
                   '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
                   '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第%d章</title>'
                   '<style>.tcy{text-combine-upright:all;-webkit-text-combine:horizontal;}</style></head>'
                   '<body><h1 id="top">第%d章</h1>%s</body></html>' % (i + 1, i + 1, body))
        items.append('<item id="c%d" href="ch%d.xhtml" media-type="application/xhtml+xml"/>' % (i, i))
        refs.append('<itemref idref="c%d"/>' % i)
        navpoints.append('<li><a href="ch%d.xhtml">第%d章</a></li>' % (i, i + 1))
    z.writestr('OEBPS/nav.xhtml',
               '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
               '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
               '<head><title>目次</title></head><body><nav epub:type="toc"><ol>%s</ol></nav></body></html>'
               % ''.join(navpoints))
    items.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
    z.writestr('OEBPS/content.opf', opf(title, creator, items, refs))
    z.close()


def build_fxl(path):
    z = zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED)
    z.writestr('mimetype', 'application/epub+zip')
    z.writestr('META-INF/container.xml', CONTAINER)
    colors = [(220, 80, 80), (80, 140, 220), (80, 200, 120), (230, 200, 90)]
    items, refs = [], []
    for i, rgb in enumerate(colors):
        z.writestr('OEBPS/img/p%d.png' % i, png(W, H, rgb))
        z.writestr('OEBPS/p%d.xhtml' % i,
                   '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
                   '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>p%d</title>'
                   '<meta name="viewport" content="width=%d, height=%d"/></head>'
                   '<body style="margin:0"><img src="img/p%d.png" width="%d" height="%d"/></body></html>'
                   % (i, W, H, i, W, H))
        items.append('<item id="x%d" href="p%d.xhtml" media-type="application/xhtml+xml"/>'
                     '<item id="i%d" href="img/p%d.png" media-type="image/png"%s/>'
                     % (i, i, i, i, ' properties="cover-image"' if i == 0 else ''))
        refs.append('<itemref idref="x%d"/>' % i)
    meta = ('<meta property="rendition:layout">pre-paginated</meta>'
            '<meta property="rendition:spread">landscape</meta>')
    z.writestr('OEBPS/content.opf', opf('テスト用FXL', 'テスト作者', items, refs, meta))
    z.close()


def main():
    out = os.path.normpath(OUT_DIR)
    os.makedirs(out, exist_ok=True)
    for name, fn in (('reflow.epub', build_reflow),
                     ('reflow2.epub', lambda p: build_reflow(p, 'テスト用リフロー2', 'べつの作者')),
                     ('fxl.epub', build_fxl)):
        p = os.path.join(out, name)
        fn(p)
        print('%s (%d bytes)' % (p, os.path.getsize(p)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
