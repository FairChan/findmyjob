# 发票字体

`FindMYJobInvoiceSC-Regular.ttf` 是由固定 Noto Sans SC 2.004 可变字体生成的静态 400 字重 TrueType，内部字体族已重命名为 FindMYJobInvoiceSC。来源为 notofonts/noto-cjk commit `523d033d6cb47f4a80c58a35753646f5c3608a78` 的 `Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf`；原始及派生文件摘要、生成参数和版本见 manifest.json，完整 OFL 1.1 许可见 LICENSE。

派生文件为 10,596,344 字节，SHA-256 为 `e04d1f780ce3e7651b3a85ffd5f8b28e847dee53501181099395cb984fde32bc`。复现时使用 FontTools 4.60.1，并运行 `python generate-invoice-font.py --source <已核验的上游字体路径>`；脚本不下载文件，校验源字体、许可和输出摘要。

发票使用完整字体嵌入，关闭 locl/liga/clig 替换，避免固定 pdf-lib/fontkit 组合的子集缺字和无编码替换字形的文本提取错误。真实 renderer 测试同时检查独立字形像素和精确中英文字、数字、金额。字体覆盖 30,890 个码点；未支持的字符显式失败，不替换法定名称。

首次实现的字体版本为 `findmyjob-invoice-sc-2.004-static400-v1`。未发布的 OTF 实验版本和未知版本不受支持，不重写快照或隐式改用其他字体。已有 READY 文件仍按原对象下载。生产构建须包含此字体、manifest、许可及 fontkit。
