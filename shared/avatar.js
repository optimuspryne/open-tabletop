// One upload contract for lobby HTTP and in-room avatars, which are synchronized as data URLs.
export const AVATAR_IMAGE = Object.freeze({
  size: 512,
  quality: 0.85,
  maxDataUrlLength: 512 * 1024,
});

export const isBoundedImageDataURL = (data) =>
  typeof data === 'string' &&
  data.startsWith('data:image') &&
  data.length < AVATAR_IMAGE.maxDataUrlLength;
