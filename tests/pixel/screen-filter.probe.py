"""撮影した PNG から「読書エリア中央」と「ツールバー」の平均色を出す。

出力: R G B  TR TG TB （前半＝読書エリア、後半＝ツールバー）
"""
import sys
from PIL import Image

im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size


def avg(x0, x1, y0, y1):
    px = [im.getpixel((x, y))
          for x in range(int(w * x0), int(w * x1), 3)
          for y in range(int(h * y0), int(h * y1), 3)]
    n = len(px)
    return (sum(p[0] for p in px) / n, sum(p[1] for p in px) / n, sum(p[2] for p in px) / n)


read = avg(.40, .60, .40, .60)   # 本文の中央付近
tool = avg(.30, .60, .00, .04)   # ツールバー帯（フィルタの対象外であるべき）
print('%.1f %.1f %.1f %.1f %.1f %.1f' % (read + tool))
