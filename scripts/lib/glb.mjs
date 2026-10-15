import assert from 'node:assert/strict';

export function parseGLB(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  return { json, binary };
}

export function bufferViews({ json, binary }, decoder) {
  return json.bufferViews.map((view) => {
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (!compressed)
      return binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const result = new Uint8Array(compressed.count * compressed.byteStride);
    decoder.decodeGltfBuffer(
      result,
      compressed.count,
      compressed.byteStride,
      // The reference decoder uses Uint8Array.slice() as a copy. Node Buffer.slice()
      // aliases its input, so pass an actual Uint8Array rather than a Buffer view.
      new Uint8Array(
        binary.subarray(
          compressed.byteOffset || 0,
          (compressed.byteOffset || 0) + compressed.byteLength,
        ),
      ),
      compressed.mode,
      compressed.filter,
    );
    return Buffer.from(result.buffer);
  });
}

export function accessorBytes(json, views, index) {
  const accessor = json.accessors[index];
  const componentSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[
    accessor.componentType
  ];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  assert.ok(componentSize && components && !accessor.sparse);
  const size = componentSize * components;
  const view = json.bufferViews[accessor.bufferView];
  const bytes = views[accessor.bufferView];
  const packed = Buffer.alloc(accessor.count * size);
  for (let i = 0; i < accessor.count; i++) {
    const offset = (accessor.byteOffset || 0) + i * (view.byteStride || size);
    bytes.copy(packed, i * size, offset, offset + size);
  }
  return packed;
}
