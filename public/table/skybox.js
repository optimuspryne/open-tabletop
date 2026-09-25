import { skyTextureURL } from '../rendering/asset-texture-url.js';
import { releaseCanvasOnDispose } from '../rendering/resources.js';
import { SKY_TEXTURE_SIZES } from '../../shared/image-thumbnails.js';

// Room skybox presentation and viewer-local resolution. The library owns the picker;
// the composition root passes synchronized refs and publishes the built-in catalog.
export const BUILTIN_SKIES = [
  // baked-in: drop files in the configured bundled asset root under sky/ and add entries here
  // equirect: { name: 'Observatory', url: '/sky/observatory.jpg' }
  { name: 'Cloudy - Chaotic', url: '/sky/equirect/cloudy_chaotic.png' },
  { name: 'Cloudy - Clear Afternoon', url: '/sky/equirect/cloudy_clear_afternoon.png' },
  { name: 'Cloudy - Clear Night', url: '/sky/equirect/cloudy_clear_night.png' },
  { name: 'Cloudy - Clear Sunrise', url: '/sky/equirect/cloudy_clear_sunrise.png' },
  { name: 'Cloudy - Clear Sunset', url: '/sky/equirect/cloudy_clear_sunset.png' },
  { name: 'Cloudy - Dark Blue', url: '/sky/equirect/cloudy_dark_blue.png' },
  { name: 'Cloudy - Dawn', url: '/sky/equirect/cloudy_dawn.png' },
  { name: 'Cloudy - Dusk', url: '/sky/equirect/cloudy_dusk.png' },
  { name: 'Cloudy - Early Morning', url: '/sky/equirect/cloudy_early_morning.png' },
  { name: 'Cloudy - Green', url: '/sky/equirect/cloudy_green.png' },
  { name: 'Cloudy - Hazy', url: '/sky/equirect/cloudy_hazy.png' },
  { name: 'Cloudy - Inverted Colors', url: '/sky/equirect/cloudy_inverted_colors.png' },
  { name: 'Cloudy - Light Green', url: '/sky/equirect/cloudy_light_green.png' },
  { name: 'Cloudy - Mist', url: '/sky/equirect/cloudy_mist.png' },
  { name: 'Cloudy - Moody', url: '/sky/equirect/cloudy_moody.png' },
  { name: 'Cloudy - Night', url: '/sky/equirect/cloudy_night.png' },
  { name: 'Cloudy - Noon', url: '/sky/equirect/cloudy_noon.png' },
  { name: 'Cloudy - Obscured Sun', url: '/sky/equirect/cloudy_obscured_sun.png' },
  { name: 'Cloudy - Purple', url: '/sky/equirect/cloudy_purple.png' },
  { name: 'Cloudy - Red At Night', url: '/sky/equirect/cloudy_red_at_night.png' },
  { name: 'Cloudy - Red', url: '/sky/equirect/cloudy_red.png' },
  { name: 'Cloudy - Stormy', url: '/sky/equirect/cloudy_stormy.png' },
  { name: 'Cloudy - Sunrise', url: '/sky/equirect/cloudy_sunrise.png' },
  { name: 'Cloudy - Sunset', url: '/sky/equirect/cloudy_sunset.png' },
  { name: 'Cloudy - Yellow', url: '/sky/equirect/cloudy_yellow.png' },
  // cubemap:  { name: 'Space', faces: ['/sky/px.jpg','/sky/nx.jpg','/sky/py.jpg','/sky/ny.jpg','/sky/pz.jpg','/sky/nz.jpg'] }
];

export function createSkybox({
  THREE,
  scene,
  renderer,
  deviceClass,
  byId,
  doc = document,
  storage = localStorage,
}) {
  const document = doc;
  const skyDefault = scene.background; // the flat color it ships with
  let skyLast = null; // last applied skybox ref (guards against a stale async load)
  let requestVersion = 0; // resolution changes and Off also invalidate pending loads of the same ref
  let skyTex = null; // the current background texture, so we can dispose it when it changes
  // Swap the background texture, disposing the one it replaces (null → the flat default color).
  function setSkyTexture(tex) {
    if (skyTex && skyTex !== tex) skyTex.dispose();
    skyTex = tex || null;
    scene.background = tex || skyDefault;
  }

  // Per-viewer skybox resolution (Settings → UI → Graphics). Each level is a MAX equirect width; a
  // bundled/uploaded source uses a server derivative; legacy URLs are downscaled at load. The
  // built-ins are 2048, so 'high' and 'ultra' match on them; a larger custom upload uses 'ultra'.
  const SKY_RES = { off: 0, ...SKY_TEXTURE_SIZES, ultra: Infinity };
  const SKY_RES_KEY = 'tabletop.skyRes';
  function getSkyRes() {
    try {
      const v = storage.getItem(SKY_RES_KEY);
      if (v && v in SKY_RES) return v;
    } catch {
      /* storage blocked — fall through to the device default */
    }
    const cls = deviceClass(); // phone→low, tablet→medium, desktop→high (matches the quality tiers)
    return cls === 'phone' ? 'low' : cls === 'tablet' ? 'medium' : 'high';
  }
  function setSkyRes(v) {
    if (!(v in SKY_RES)) return;
    try {
      storage.setItem(SKY_RES_KEY, v);
    } catch {
      /* not remembered, but still applied for this session */
    }
    applySkybox(skyLast || ''); // re-apply the current skybox at the new resolution (live, no reload)
  }
  // Draw a loaded texture's image down to `cap` px wide (equirect stays 2:1), returning a smaller
  // CanvasTexture and disposing the original. Returns it unchanged if already within the cap.
  function capTexture(tex, cap) {
    const img = tex.image;
    if (!cap || !img || !img.width || img.width <= cap) return tex;
    const nw = cap,
      nh = Math.max(1, Math.round((img.height * cap) / img.width));
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.width = canvas.height = 0;
      return tex;
    }
    ctx.drawImage(img, 0, 0, nw, nh);
    tex.dispose(); // not yet uploaded — this just drops the full-res image reference
    return releaseCanvasOnDispose(new THREE.CanvasTexture(canvas), canvas);
  }
  // Same idea for a 6-face cube map: downscale each face to `cap` px, rebuild the CubeTexture.
  function capCubeTexture(cube, cap) {
    const imgs = cube.image; // 6 face images, in the loaded order
    if (!cap || !Array.isArray(imgs) || !imgs[0] || !imgs[0].width || imgs[0].width <= cap)
      return cube;
    const faces = imgs.map((img) => {
      const nw = cap,
        nh = Math.max(1, Math.round((img.height * cap) / img.width));
      const canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        canvas.width = canvas.height = 0;
        return img;
      }
      ctx.drawImage(img, 0, 0, nw, nh);
      return canvas;
    });
    if (faces.some((face, i) => face === imgs[i])) {
      // Cube faces must keep matching dimensions, even when a canvas allocation fails.
      for (const face of faces) if (face.getContext) face.width = face.height = 0;
      return cube;
    }
    cube.dispose();
    const ct = new THREE.CubeTexture(faces);
    for (const canvas of faces) if (canvas.getContext) releaseCanvasOnDispose(ct, canvas);
    ct.needsUpdate = true;
    return ct;
  }
  // A skybox "ref" is '' (default), an equirect URL, or a cube descriptor {"t":"cube","f":[6]}.
  function applySkybox(ref) {
    const version = ++requestVersion;
    if (getSkyRes() === 'off') ref = ''; // skybox turned off for this viewer
    if (!ref) {
      setSkyTexture(null);
      return;
    }
    const cap = SKY_RES[getSkyRes()];
    const aniso = renderer.capabilities.getMaxAnisotropy(); // sharpen grazing angles (esp. the horizon)
    const set = (tex) => {
      if (version === requestVersion) setSkyTexture(tex);
      else tex.dispose(); // a newer ref won the race — don't leak the texture we just loaded
    };
    const fail = () => {
      if (version === requestVersion) setSkyTexture(null);
    };
    if (ref[0] === '{') {
      // cubemap — capped per face like the equirect path
      let d;
      try {
        d = JSON.parse(ref);
      } catch {
        return fail();
      }
      if (d && d.t === 'cube' && Array.isArray(d.f) && d.f.length === 6)
        new THREE.CubeTextureLoader().load(
          d.f.map((face) => skyTextureURL(face, getSkyRes())),
          (loaded) => {
            const tex = capCubeTexture(loaded, cap);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = aniso;
            set(tex);
          },
          undefined,
          fail,
        );
      else fail();
    } else {
      // equirectangular
      new THREE.TextureLoader().load(
        skyTextureURL(ref, getSkyRes()),
        (loaded) => {
          const tex = capTexture(loaded, cap);
          tex.mapping = THREE.EquirectangularReflectionMapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = aniso;
          set(tex);
        },
        undefined,
        fail,
      );
    }
  }
  function syncSkybox(ref) {
    ref = ref || '';
    if (ref === skyLast) return;
    skyLast = ref;
    applySkybox(ref);
  }

  function bindControls() {
    const srow = byId('skyResRow');
    if (srow) {
      const chips = [...srow.querySelectorAll('[data-skyres]')];
      const sync = () =>
        chips.forEach((c) => c.classList.toggle('on', c.dataset.skyres === getSkyRes()));
      chips.forEach(
        (c) =>
          (c.onclick = () => {
            setSkyRes(c.dataset.skyres);
            sync();
          }),
      );
      sync();
    }
  }
  return { sync: syncSkybox, bindControls };
}
