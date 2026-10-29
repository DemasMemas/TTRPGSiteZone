const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=n=>fs.readFileSync(require('node:path').join(__dirname,'../app/static/js',n),'utf8');
const load=n=>import('data:text/javascript;base64,'+Buffer.from(read(n)).toString('base64'));
test('world sculpt keeps its existing height limits at different frame rates',async()=>{
    const {sculptHeightChanges}=await load('locationSculpt.js');
    const run=fps=>{const t=Array.from({length:9},()=>Array.from({length:9},()=>({terrain:'grass',height:1})));for(let i=0;i<fps*2;i++)for(const c of sculptHeightChanges(t,{x:4.5,z:4.5},{x:4.5,z:4.5},1/fps,{mode:'lower',radius:3,strength:1,softness:.7,minHeight:.5,maxHeight:3}))t[c.z][c.x].height=c.height;return t;};
    const a=run(15),b=run(144);assert.ok(Math.abs(a[4][4].height-.5)<1e-9);
    for(let z=0;z<9;z++)for(let x=0;x<9;x++)assert.ok(Math.abs(a[z][x].height-b[z][x].height)<1e-8);
});
test('sculpted surfaces share height and normals at two- and four-chunk seams',async()=>{
    const T=await load('locationTerrain.js'),source=read('lobby3d.js'),start=source.indexOf('function clipWorldTerrainData(');
    const clip=new Function(source.slice(start,source.indexOf('\n}',start)+2)+';return clipWorldTerrainData')();
    const tiles=Array.from({length:64},(_,z)=>Array.from({length:64},(_,x)=>({terrain:'grass',height:1+Math.max(0,1-Math.hypot(x-31,z-31)/5)})));
    const edges=[];
    for(const [cx,cz] of [[0,0],[1,0],[0,1],[1,1]]){
        const padded=Array.from({length:34},(_,z)=>Array.from({length:34},(_,x)=>tiles[cz*32+z-1]?.[cx*32+x-1]||null));
        const data=clip(T.buildSmoothTerrainData(padded), (x,z)=>x>0&&x<=32&&z>0&&z<=32),points=new Map();
        data.topByVertex.forEach((flag,i)=>{const x=data.positions[i*3]+cx*32-1,z=data.positions[i*3+2]+cz*32-1;
            if(flag&&(x===32||z===32))points.set(`${x},${z}`,[data.positions[i*3+1],...data.normals.slice(i*3,i*3+3)]);
        });edges.push(points);
    }
    assert.ok(edges.every(p=>p.has('32,32')));
    for(let a=0;a<edges.length;a++)for(let b=a+1;b<edges.length;b++)for(const [key,values]of edges[a])if(edges[b].has(key)){
        values.forEach((v,i)=>assert.ok(Math.abs(v-edges[b].get(key)[i])<1e-6,`${key}/${i}`));
    }
});
