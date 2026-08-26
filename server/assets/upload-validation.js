// Identify supported raster formats from their bytes. The returned extension is
// server-owned; request Content-Type must never control the served filename type.
export function imageExtension(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
      && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp';
  return null;
}

// Validate binary glTF structure and reject network-fetching external references.
export function validateGlb(buffer) {
  if (!buffer || buffer.length < 20) return { ok: false, reason: 'not a .glb (too small)' };
  if (buffer.readUInt32LE(0) !== 0x46546C67) return { ok: false, reason: 'not a .glb (bad magic)' };
  if (buffer.readUInt32LE(4) !== 2) return { ok: false, reason: 'unsupported glTF version' };
  if (buffer.readUInt32LE(8) !== buffer.length) return { ok: false, reason: 'declared length mismatch' };
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4E4F534A) return { ok: false, reason: 'first chunk is not JSON' };
  if (20 + jsonLength > buffer.length) return { ok: false, reason: 'JSON chunk overruns file' };
  let gltf;
  try {
    gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid glTF JSON' };
  }
  const uris = [...(gltf.buffers || []), ...(gltf.images || [])]
    .map((entry) => entry && entry.uri)
    .filter(Boolean);
  if (uris.some((uri) => !/^data:/i.test(String(uri)))) return { ok: false, reason: 'model contains an external reference' };
  return { ok: true };
}
