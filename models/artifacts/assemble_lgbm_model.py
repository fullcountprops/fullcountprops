#!/usr/bin/env python3
"""Reassemble and decompress the LightGBM model from chunks.
Run: python models/artifacts/assemble_lgbm_model.py
"""
import base64, gzip, glob, os

chunks_dir = os.path.join(os.path.dirname(__file__), 'chunks')
chunk_files = sorted(glob.glob(os.path.join(chunks_dir, 'model_chunk_*.txt')))

b64_data = ''
for cf in chunk_files:
    with open(cf) as f:
        b64_data += f.read()

compressed = base64.b64decode(b64_data)
model_bytes = gzip.decompress(compressed)

out_path = os.path.join(os.path.dirname(__file__), 'lgbm_matchup_model.txt')
with open(out_path, 'wb') as f:
    f.write(model_bytes)
print(f'Assembled model: {len(model_bytes):,} bytes -> {out_path}')
