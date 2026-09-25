// Shared bounds and the closed set of bundled raster paths eligible for thumbnail conversion.
export const THUMBNAIL_MAX_DIMENSION = 320;
export const BUNDLED_THUMBNAIL_IMAGE =
  /^\/(?:sky|mahjong|textures)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:gif|jpe?g|png|webp)$/i;

// Display derivatives for skyboxes; separate from 320px library thumbnails and card art.
export const SKY_TEXTURE_SIZES = { low: 512, medium: 1024, high: 2048 };
