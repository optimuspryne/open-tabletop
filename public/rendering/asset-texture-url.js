const LOCAL_ASSET_IMAGE = /^\/assets\/([a-z]+)\/([a-f0-9]{18}\.(?:gif|jpe?g|png|webp))$/i;

// Map a saved source image to the versioned display derivative. External/data/procedural refs and
// non-random filenames pass through unchanged. Preview callers omit `high` to keep DOM thumbnails
// on the smaller standard derivative; Three.js card faces may request the High variant.
export function assetTextureURL(ref, { high = false } = {}) {
  const match = LOCAL_ASSET_IMAGE.exec(ref);
  if (!match) return ref;
  const quality = high ? '?quality=high' : '';
  return `/asset-textures/v1/${match[1]}/${encodeURIComponent(match[2])}.webp${quality}`;
}
