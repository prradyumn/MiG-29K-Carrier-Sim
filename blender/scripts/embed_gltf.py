"""Embed a .gltf's .bin buffer (and images) as base64 data URIs and write a single .json the artifact host will serve.
usage: python embed_gltf.py in.gltf out.json"""
import sys, json, base64, os
src, dst = sys.argv[1], sys.argv[2]
g = json.load(open(src)); base = os.path.dirname(src)
for b in g.get('buffers', []):
    if 'uri' in b and not b['uri'].startswith('data:'):
        b['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(open(os.path.join(base, b['uri']), 'rb').read()).decode()
json.dump(g, open(dst, 'w'), separators=(',', ':'))
print(dst, os.path.getsize(dst) // 1024, 'KB')
