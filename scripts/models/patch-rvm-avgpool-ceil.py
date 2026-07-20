"""RVM ONNX 手術：AveragePool ceil_mode → pad 等價形式（WebGPU JSEP 相容）。

onnxruntime-web 1.27 的 WebGPU EP 不支援 AveragePool ceil_mode=1
（"using ceil() in shape computation is not yet supported"）。
RVM mobilenetv3 有 3 個 2x2/stride2/pads0 的 ceil AveragePool；對此形狀
ceil_mode=1 ≡ ceil_mode=0 + pads=[0,0,1,1] + count_include_pad=0
（ceil(n/2) = floor((n+1)/2)，部分視窗僅對有效格平均——兩種語意一致）。

驗證（2026-07-20，CPU EP，random 輸入，downsample_ratio=0.25）：
1920x1080 / 1280x720 / 1918x1078 / 960x540 皆 max|pha diff| = 0.0（逐位元）。

用法：python patch-rvm-avgpool-ceil.py <原始.onnx> <輸出.onnx>
"""
import sys
import onnx
from onnx import helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
patched = 0
for n in m.graph.node:
    if n.op_type == 'AveragePool':
        keep = [a for a in n.attribute if a.name not in ('ceil_mode', 'pads', 'count_include_pad')]
        del n.attribute[:]
        n.attribute.extend(keep)
        n.attribute.append(helper.make_attribute('ceil_mode', 0))
        n.attribute.append(helper.make_attribute('pads', [0, 0, 1, 1]))
        n.attribute.append(helper.make_attribute('count_include_pad', 0))
        patched += 1
onnx.save(m, dst)
print(f'patched {patched} AveragePool nodes -> {dst}')
