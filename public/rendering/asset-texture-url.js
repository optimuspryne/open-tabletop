import { BUNDLED_THUMBNAIL_IMAGE, SKY_TEXTURE_SIZES } from '../../shared/image-thumbnails.js';
const LOCAL_ASSET_IMAGE = /^\/assets\/([a-z]+)\/([a-f0-9]{18}\.(?:gif|jpe?g|png|webp))$/i;

// Map a saved source image to the versioned display derivative. External/data/procedural refs and
// non-random filenames pass through unchanged for rendering callers. Thumbnail sinks use the
// stricter assetThumbnailURL below; Three.js card faces may request the High variant here.
export function assetTextureURL(ref, { high = false, thumbnail = false } = {}) {
  const match = LOCAL_ASSET_IMAGE.exec(ref);
  if (!match) return ref;
  const quality = thumbnail ? '?quality=thumbnail' : high ? '?quality=high' : '';
  return `/asset-textures/v1/${match[1]}/${encodeURIComponent(match[2])}.webp${quality}`;
}

// Thumbnail sinks never fall back to a full-size source. Data URLs here are already-rendered
// WebP previews (or PNG when the browser cannot encode WebP); saved and bundled images use
// server derivatives. Unsupported refs stay empty.
export function assetThumbnailURL(ref) {
  if (typeof ref !== 'string') return null;
  if (/^data:image\/(?:webp|png);base64,[a-z0-9+/=]+$/i.test(ref)) return ref;
  if (LOCAL_ASSET_IMAGE.test(ref)) return assetTextureURL(ref, { thumbnail: true });
  if (BUNDLED_THUMBNAIL_IMAGE.test(ref))
    return `/asset-textures/v1/bundled/${encodeURIComponent(ref.slice(1))}.webp?quality=thumbnail`;
  const derivative =
    /^\/asset-textures\/v1\/([a-z]+)\/([^?#]+)\.webp(?:\?quality=(?:high|thumbnail))?$/.exec(ref);
  if (derivative) {
    if (derivative[1] !== 'bundled')
      return assetThumbnailURL(`/assets/${derivative[1]}/${derivative[2]}`);
    try {
      const source = '/' + decodeURIComponent(derivative[2]);
      if (BUNDLED_THUMBNAIL_IMAGE.test(source)) return assetThumbnailURL(source);
    } catch {
      /* malformed encoded path has no thumbnail */
    }
  }
  return null;
}

// Fetch the selected sky resolution before decoding it on memory-constrained browsers.
// Ultra and legacy/external URLs keep their existing source and client-side cap behavior.
export function skyTextureURL(ref, resolution) {
  if (!Object.hasOwn(SKY_TEXTURE_SIZES, resolution) || typeof ref !== 'string') return ref;
  const match = LOCAL_ASSET_IMAGE.exec(ref);
  if (match?.[1] === 'sky')
    return `/asset-textures/v1/sky/${encodeURIComponent(match[2])}.webp?quality=sky-${resolution}`;
  if (ref.startsWith('/sky/') && BUNDLED_THUMBNAIL_IMAGE.test(ref))
    return `/asset-textures/v1/bundled/${encodeURIComponent(ref.slice(1))}.webp?quality=sky-${resolution}`;
  return ref;
}
