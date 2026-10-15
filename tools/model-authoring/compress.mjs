// Offline authoring API. No app runtime/build dependency.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(
  resolve(process.env.GLTF_TOOLS || import.meta.dirname, 'package.json'),
);
const { NodeIO } = require('@gltf-transform/core');
const {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
  EXTTextureWebP,
} = require('@gltf-transform/extensions');
const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer');
const sharp = require('sharp');
const validator = require('gltf-validator');

export async function compressAsset(source) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const input = await readFile(source);
  const json = JSON.parse(input.subarray(20, 20 + input.readUInt32LE(12)));
  const supported = new Set(ALL_EXTENSIONS.map((e) => e.EXTENSION_NAME));
  for (const extension of json.extensionsUsed || [])
    assert.ok(supported.has(extension), 'Unsupported extension: ' + extension);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const before = await io.readBinary(new Uint8Array(input));
  const doc = await io.readBinary(new Uint8Array(input));
  for (const scene of doc.getRoot().listScenes())
    if (scene !== doc.getRoot().getDefaultScene() && !scene.listChildren().length) scene.dispose();
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const webp = await sharp(image).webp({ lossless: true, effort: 6 }).toBuffer();
    const a = await sharp(image).ensureAlpha().raw().toBuffer(),
      b = await sharp(webp).ensureAlpha().raw().toBuffer();
    if (webp.length < image.length && a.equals(b)) {
      texture.setImage(webp).setMimeType('image/webp');
      doc.createExtension(EXTTextureWebP).setRequired(true);
    }
  }
  // This encoder mode does not quantize accessors. No quantize/reorder/simplify transform is run.
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
    method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
  });
  const candidate = Buffer.from(await io.writeBinary(doc));
  const output = candidate.length < input.length ? candidate : input;
  const decoded = await io.readBinary(new Uint8Array(output));
  const a = before.getRoot(),
    b = decoded.getRoot();
  assert.deepEqual(
    b.listNodes().map((n) => n.getName()),
    a.listNodes().map((n) => n.getName()),
  );
  assert.deepEqual(
    b.listMaterials().map((n) => n.getName()),
    a.listMaterials().map((n) => n.getName()),
  );
  assert.deepEqual(
    (await io.writeJSON(decoded)).json.materials,
    (await io.writeJSON(before)).json.materials,
  );
  assert.equal(b.listMeshes().length, a.listMeshes().length);
  for (let mi = 0; mi < a.listMeshes().length; mi++) {
    const x = a.listMeshes()[mi].listPrimitives(),
      y = b.listMeshes()[mi].listPrimitives();
    assert.equal(y.length, x.length);
    for (let pi = 0; pi < x.length; pi++) {
      assert.deepEqual(y[pi].listSemantics(), x[pi].listSemantics());
      for (const semantic of x[pi].listSemantics())
        assert.deepEqual(
          y[pi].getAttribute(semantic).getArray(),
          x[pi].getAttribute(semantic).getArray(),
          semantic,
        );
      assert.equal(x[pi].getMode(), 4, 'Only TRIANGLES are supported by this lossless verifier');
      const ai = x[pi].getIndices()?.getArray(),
        bi = y[pi].getIndices()?.getArray();
      assert.equal(bi?.length, ai?.length);
      if (ai)
        for (let i = 0; i < ai.length; i += 3)
          assert.ok(
            [0, 1, 2].some((k) => [0, 1, 2].every((j) => ai[i + j] === bi[i + ((j + k) % 3)])),
            'Triangle winding',
          );
      assert.equal(y[pi].listTargets().length, x[pi].listTargets().length);
      for (let ti = 0; ti < x[pi].listTargets().length; ti++) {
        const xt = x[pi].listTargets()[ti],
          yt = y[pi].listTargets()[ti];
        assert.deepEqual(yt.listSemantics(), xt.listSemantics());
        for (const semantic of xt.listSemantics())
          assert.deepEqual(
            yt.getAttribute(semantic).getArray(),
            xt.getAttribute(semantic).getArray(),
          );
      }
    }
  }
  assert.equal(b.listTextures().length, a.listTextures().length);
  for (let i = 0; i < a.listTextures().length; i++) {
    const x = await sharp(a.listTextures()[i].getImage())
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const y = await sharp(b.listTextures()[i].getImage())
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.deepEqual(y, x, 'Texture ' + i);
  }
  assert.equal(b.listAnimations().length, a.listAnimations().length);
  for (let i = 0; i < a.listAnimations().length; i++) {
    const x = a.listAnimations()[i].listChannels(),
      y = b.listAnimations()[i].listChannels();
    assert.equal(y.length, x.length);
    for (let j = 0; j < x.length; j++) {
      assert.equal(y[j].getTargetPath(), x[j].getTargetPath());
      assert.equal(y[j].getTargetNode()?.getName(), x[j].getTargetNode()?.getName());
      assert.equal(y[j].getSampler().getInterpolation(), x[j].getSampler().getInterpolation());
      assert.deepEqual(
        y[j].getSampler().getInput().getArray(),
        x[j].getSampler().getInput().getArray(),
      );
      assert.deepEqual(
        y[j].getSampler().getOutput().getArray(),
        x[j].getSampler().getOutput().getArray(),
      );
    }
  }
  assert.equal(b.listSkins().length, a.listSkins().length);
  for (let i = 0; i < a.listSkins().length; i++)
    assert.deepEqual(
      b.listSkins()[i].getInverseBindMatrices()?.getArray(),
      a.listSkins()[i].getInverseBindMatrices()?.getArray(),
    );
  const validation = await validator.validateBytes(new Uint8Array(output), {
    maxIssues: 100,
  });
  assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues));
  assert.deepEqual(await readFile(source), input, 'Source changed');
  return {
    input,
    output,
    validation: {
      errors: validation.issues.numErrors,
      warnings: validation.issues.numWarnings,
      messages: validation.issues.messages,
    },
  };
}
