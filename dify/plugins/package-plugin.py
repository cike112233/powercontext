#!/usr/bin/env python3
"""把 Dify 插件源码目录打包成 .difypkg（zip，插件文件放在压缩包根目录）。

为什么需要它：竞赛环境下 marketplace.dify.ai 在国内不可达（实测容器内 curl 返回 000），
Dify 后台的"从 Marketplace 安装"走不通，只能走"本地上传 .difypkg"。
本脚本把 langgenius/dify-official-plugins 里的插件源码目录直接打包成可上传的包，
配合 .env 里的 FORCE_VERIFYING_SIGNATURE=false 即可离线安装。

用法：
  python package-plugin.py <插件源码目录> <输出.difypkg>
例：
  python package-plugin.py /d/dify-local/plugins-src/models/deepseek ./dist/langgenius-deepseek-0.0.26.difypkg
"""
import os
import sys
import zipfile

EXCLUDE_DIRS = {"tests", "readme", "__pycache__", ".venv", "node_modules", ".git"}
EXCLUDE_NAMES = {".difyignore", ".env.example", ".python-version", "uv.lock"}
EXCLUDE_SUFFIX = (".pyc",)


def collect(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for name in filenames:
            if name in EXCLUDE_NAMES or name.endswith(EXCLUDE_SUFFIX):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            yield full, rel


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    src, dst = sys.argv[1], sys.argv[2]
    manifest = os.path.join(src, "manifest.yaml")
    if not os.path.exists(manifest):
        print(f"[package-plugin] 缺少 manifest.yaml: {src}")
        return 1
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    entries = sorted(collect(src), key=lambda x: x[1])
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zf:
        for full, rel in entries:
            zf.write(full, rel)
    size = os.path.getsize(dst)
    print(f"[package-plugin] {dst}  {len(entries)} 个文件  {size/1024:.1f}KB")
    print("  包含: " + ", ".join(rel for _, rel in entries[:8]) + (" …" if len(entries) > 8 else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
