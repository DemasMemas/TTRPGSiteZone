const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const code=fs.readFileSync('app/static/js/waterProfiles.js','utf8');
const load=()=>import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const grid=(kind='sand',n=15)=>Array.from({length:n},()=>Array.from({length:n},()=>({terrain:kind,height:1})));
test('legacy auto follows materials, not objects; manual wins',async()=>{
 const {waterComponentsAt:f}=await load(),a=grid(),get=(x,z)=>a[z]?.[x];a[7][7]={terrain:'water',height:1};
 const sandy=f(get,7,7);assert.ok(sandy[0]>.6);
 for(const row of a)for(const tile of row)tile.objects=[{type:'factory'}];assert.deepEqual(f(get,7,7),sandy);
 a[7][7].water_profile='clean';assert.deepEqual(f(get,7,7),[0,0,0,0]);
 a[7][7].water_profile='auto';a[7][6].terrain='metal';assert.ok(f(get,7,7)[3]>0);
});
test('large lake interiors stay neutral while shores adapt, without a basin traversal',async()=>{
 const {waterComponentsAt:f}=await load(),a=grid();for(let z=2;z<13;z++)for(let x=2;x<13;x++)a[z][x].terrain='water';
 let calls=0;const get=(x,z)=>{calls++;return a[z]?.[x]};assert.ok(f(get,2,7)[0]>.1);calls=0;
 assert.deepEqual(f(get,7,7),[.1,.1,.08,0]);assert.ok(calls<=49);
});
test('all profiles differ; land is ignored by basin selection and diagonal cells stay separate',async()=>{
 const m=await load(),a=grid(),get=(x,z)=>a[z]?.[x];a[2][2].terrain=a[2][3].terrain=a[3][4].terrain='water';
 assert.deepEqual(m.connectedWaterCells(get,2,2),[[2,2],[3,2]]);assert.deepEqual(m.connectedWaterCells(get,0,0),[]);
 const values=m.WATER_PROFILES.filter(([id])=>id!=='auto').map(([id])=>{a[2][2].water_profile=id;return JSON.stringify(m.waterComponentsAt(get,2,2))});assert.equal(new Set(values).size,6);
 assert.equal(m.normalizeWaterProfile({}),'auto');
});
test('incremental context updates are bounded and produce one texture revision per batch',async()=>{
 const {createWaterProfileLayer}=await load(),a=grid('sand',64);a[32][32].terrain='water';let probes=0;
 class Texture{constructor(data,width,height){this.image={data,width,height}}dispose(){}}
 class V{set(x,y){this.x=x;this.y=y}}
 const layer=createWaterProfileLayer({Vector2:V,DataTexture:Texture},(x,z)=>{probes++;return a[z]?.[x]});
 layer.resize(64,64);layer.updateRegion(32,32);layer.updateRegion(32,32);await Promise.resolve();
 assert.ok(probes<2500);assert.equal(layer.diagnostics().revision,1);assert.equal(layer.diagnostics().bytes,64*64*4);
 const d=layer.uniforms.waterProfiles.value.image.data,i=(32*64+32)*4;assert.ok(d[i]>150);
 a[32][32].water_profile='clean';layer.updateRegion(32,32);await Promise.resolve();assert.deepEqual(Array.from(d.slice(i,i+4)),[0,0,0,0]);
 layer.dispose();layer.updateRegion(0,0);await Promise.resolve();
});
