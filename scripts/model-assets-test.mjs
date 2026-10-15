// Real Three.js / GPU / strict-CSP round-trip for every bundled derivative.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveDir, launch, newPage } from './lib/headless.mjs';
const importMap = (await readFile('public/table.html', 'utf8')).match(
  /<script type="importmap">([\s\S]*?)<\/script>/,
)[1];
const csp =
  "default-src 'self'; script-src 'self' 'sha256-nAG3xy0rRET2ecuPDHRx6qjQE+p+98x1xfv8G0NqT2c='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss: data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'";
const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="icon" href="data:,"><script type="importmap">${importMap}</script></head><body></body></html>`;
const preparing = process.argv[2] === '--prepare';
const [sourcePath, candidatePath, baselinePath] = process.argv.slice(3);
if (preparing && (!sourcePath || !candidatePath || !baselinePath))
  throw new Error(
    'Usage: node scripts/model-assets-test.mjs --prepare source.glb candidate.glb baseline.json',
  );
const fixtureRoutes = preparing
  ? {
      '/model-source.glb': { body: await readFile(sourcePath), type: 'model/gltf-binary' },
      '/model-candidate.glb': { body: await readFile(candidatePath), type: 'model/gltf-binary' },
      '/models/manifest.json': {
        body: JSON.stringify([{ url: '/model-candidate.glb' }]),
        type: 'application/json',
      },
    }
  : {};
const server = await serveDir({
  root: resolve('public'),
  mounts: { '/shared/': resolve('shared') },
  routes: { ...fixtureRoutes, '/model-assets-test.html': { body: html } },
});
const browser = await launch({ webgl: true });
try {
  for (const device of [
    { width: 1280, height: 900 },
    { width: 390, height: 844, touch: true },
  ]) {
    const page = await newPage(browser, {
      url: server.origin + '/model-assets-test.html',
      ...device,
    });
    const result = await page.evaluate(`(async () => {
      const THREE = await import('three');
      const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js');
      const {createModelLoader} = await import('/rendering/model-loader.js');
      const {MeshoptDecoder} = await import('/vendor/meshoptimizer/meshopt_decoder_reference.js');
      const manifest=await (await fetch('/models/manifest.json')).json();
      const preparing=${preparing};
      const {disposeHierarchy} = await import('/rendering/resources.js');
      const violations=[];document.addEventListener('securitypolicyviolation', e=>violations.push(e.violatedDirective));
      const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(128,128);
      const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x666666,2));
      const camera=new THREE.PerspectiveCamera(45,1,.01,100);camera.position.set(1.5,1.2,2);camera.lookAt(0,0,0);
      const original=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const compressed=preparing?new GLTFLoader().setMeshoptDecoder(MeshoptDecoder):createModelLoader();
      async function browserHash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
      const scalarKeys=['name','type','opacity','transparent','alphaTest','side','depthWrite','metalness','roughness','clearcoat','clearcoatRoughness','sheen','sheenRoughness','specularIntensity','ior','transmission','thickness','emissiveIntensity','flatShading','vertexColors'];
      const colorKeys=['color','emissive','sheenColor','specularColor','attenuationColor'];
      function snapshot(gltf) {
        gltf.scene.updateMatrixWorld(true);
        const nodes=[];gltf.scene.traverse(node=>{
          const row={name:node.name,type:node.type,matrix:node.matrix.toArray()};
          if(node.isMesh) row.materials=[node.material].flat().map(m=>{
            const out={};for(const k of scalarKeys) if(m[k]!==undefined)out[k]=m[k];
            for(const k of colorKeys)if(m[k])out[k]=m[k].toArray();
            for(const k of ['normalScale','clearcoatNormalScale'])if(m[k])out[k]=m[k].toArray();
            for(const [key,t] of Object.entries(m))if(t?.isTexture)out[key]={width:t.image.width,height:t.image.height,colorSpace:t.colorSpace,channel:t.channel,flipY:t.flipY,wrapS:t.wrapS,wrapT:t.wrapT,minFilter:t.minFilter,magFilter:t.magFilter,offset:t.offset.toArray(),repeat:t.repeat.toArray(),rotation:t.rotation};
            return out;
          });nodes.push(row);
        });
        return {nodes,animations:gltf.animations.map(a=>({name:a.name,duration:a.duration,tracks:a.tracks.map(t=>({name:t.name,times:[...t.times],values:[...t.values]}))}))};
      }
      function comparePixels(a,b,url){
        const meshes=gltf=>{const nodes=[];gltf.scene.traverse(n=>{if(n.isMesh)nodes.push(n);});return nodes;};
        const x=meshes(a),y=meshes(b),seen=new Set(),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
        for(let i=0;i<x.length;i++){
          const am=[x[i].material].flat(),bm=[y[i].material].flat();
          for(let j=0;j<am.length;j++)for(const [key,t] of Object.entries(am[j])){
            if(!t?.isTexture||seen.has(t.image))continue;seen.add(t.image);
            const u=bm[j][key];canvas.width=t.image.width;canvas.height=t.image.height;
            ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(t.image,0,0);const p=ctx.getImageData(0,0,canvas.width,canvas.height).data;
            ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(u.image,0,0);const q=ctx.getImageData(0,0,canvas.width,canvas.height).data;
            if(p.length!==q.length||p.some((n,k)=>n!==q[k]))throw Error(url+': browser texture pixels changed: '+key);
          }
        }
        canvas.width=canvas.height=1;
      }
      function equal(a,b,path='root'){
        if(typeof a==='number'&&typeof b==='number'){if(Math.abs(a-b)>1e-6)throw Error(path+': '+a+' != '+b);return;}
        if(a&&b&&typeof a==='object'&&typeof b==='object'){
          if(JSON.stringify(Object.keys(a))!==JSON.stringify(Object.keys(b)))throw Error(path+': keys '+JSON.stringify(Object.keys(a))+' != '+JSON.stringify(Object.keys(b)));
          for(const k of Object.keys(a))equal(a[k],b[k],path+'.'+k);return;
        }
        if(a!==b)throw Error(path+': '+a+' != '+b);
      }
      const rows=[];
      for(const row of manifest){
        const url=row.url;
        const start=performance.now();
        const a=preparing?await original.loadAsync('/model-source.glb'):null,b=await compressed.loadAsync(url);
        try{
          if(preparing){equal(snapshot(a),snapshot(b),url);comparePixels(a,b,url);}

          const box=new THREE.Box3().setFromObject(b.scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
          b.scene.position.sub(center);const scale=1/Math.max(size.x,size.y,size.z);b.scene.scale.setScalar(scale);b.scene.position.multiplyScalar(scale);scene.add(b.scene);
          renderer.render(scene,camera);if(!renderer.info.render.triangles)throw Error(url+': no rendered triangles');
          if(renderer.getContext().getError()!==0)throw Error(url+': WebGL error');
          scene.remove(b.scene);
          if(!preparing && await browserHash(snapshot(b))!==row.browserSha256)throw Error(url+': browser material/hierarchy/animation baseline changed');
          rows.push({url,browserSha256:await browserHash(snapshot(b)),loadMs:performance.now()-start});
        }finally{if(a)disposeHierarchy(a.scene);disposeHierarchy(b.scene);}
      }
      // Both APIs load canonical bundled files; unrelated refs stay on GLTFLoader.
      if(!preparing){
      const first=manifest[0].url;
      const callback=await new Promise((ok,no)=>compressed.load(first,ok,undefined,no));disposeHierarchy(callback.scene);

      const data='data:model/gltf+json,'+encodeURIComponent(JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[]}],scene:0}));
      const custom=await compressed.loadAsync(data);if(!custom.scene)throw Error('Custom loader pass-through failed');
      const blob=URL.createObjectURL(await (await fetch(first)).blob());
      try {
        let rejected=false;try{await compressed.loadAsync(blob);}catch(error){rejected=error.message.includes('setMeshoptDecoder');}
        if(!rejected)throw Error('Untrusted blob reached the bundled decoder');
      }finally{URL.revokeObjectURL(blob);}
      const requests=performance.getEntriesByType('resource').map(e=>new URL(e.name).pathname);
      if(!manifest.every(row=>requests.includes(row.url)))throw Error('Canonical model not fetched');
      }
      renderer.dispose();return {count:rows.length,violations,rows};
    })()`);
    if (preparing && !device.touch)
      await writeFile(baselinePath, JSON.stringify(result.rows[0]) + '\n');
    assert.equal(result.violations.length, 0, 'CSP violations');
    console.log(
      `Model assets ${device.width}${device.touch ? ' touch' : ''}: ${result.count} canonical GLBs, material/animation baselines and GPU renders passed under strict CSP`,
    );
    await page.close();
  }
  assert.deepEqual(server.missing, []);
} finally {
  await browser.close();
  server.close();
}
