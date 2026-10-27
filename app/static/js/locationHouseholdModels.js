// Original project models. One shared geometry per ID; one atlas for the family.
// Local scene lighting, selection and previews tint materials individually.
const caches = new WeakMap();
const wood='#77604a', edge='#463e33', cloth='#77715c', iron='#444a44', enamel='#b2b2a0', dark='#272d29';
const ceramicModels = new Set(['washbasin', 'toilet', 'bathtub']);

// Keep reusable CPU geometry and atlas pixels, release the departed renderer's
// GPU allocations and its dispose subscriptions on these cached resources.
export function releaseHouseholdRendererResources(T) {
    const cache = caches.get(T);
    if (!cache) return;
    cache.texture.dispose();
    cache.geometries.forEach(geometry => geometry.dispose());
}

function resources(T) {
    if(caches.has(T))return caches.get(T);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(256,256);
    let seed=2403;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const tile=(x>>7)+2*(y>>7),u=x%128,v=y%128;
        let value=226+random()*20;
        if(tile===0)value-=12*Math.sin(v*.8+Math.sin(u*.035)*2)**8;
        if(tile===1)value-=(u%4===0?13:0)+(v%4===0?13:0);
        if(tile===2)value-=random()<.015?40:0;
        if(tile===3)value-=v%19===0?6:0;
        const i=(y*256+x)*4;pixels.data.set([value,value,value,255],i);
    }
    ctx.putImageData(pixels,0,0);
    const texture=new T.CanvasTexture(canvas);texture.encoding=T.sRGBEncoding;texture.anisotropy=2;
    const material=new T.MeshStandardMaterial({map:texture,vertexColors:true,color:0xffffff,roughness:.9,metalness:.03});
    const cache={texture,material,geometries:new Map()};caches.set(T,cache);return cache;
}

function geometryFor(T,id,cache) {
    if(cache.geometries.has(id))return cache.geometries.get(id);
    const ceramic=ceramicModels.has(id);
    const positions=[],normals=[],colors=[],uvs=[],sinkParts=[[],[]];
    let crateBottomStart = -1;
    const add=(geo,x,y,z,sx,sy,sz,color,tile=0,rx=0,rz=0,ry=0)=>{
        const flat=geo.index?geo.toNonIndexed():geo;
        const m=new T.Matrix4().compose(new T.Vector3(x,y,z),new T.Quaternion().setFromEuler(new T.Euler(rx,ry,rz)),new T.Vector3(sx,sy,sz));
        const glazed=ceramic||(id==='sink'&&tile===2);
        const surfaceColor=glazed
            ? (color===enamel?'#d2d0c4':color==='#aeb1a1'?'#cecec0':color==='#bcbba5'?'#d0c9b2':color)
            : color;
        flat.applyMatrix4(m);const p=flat.attributes.position,n=flat.attributes.normal,uv=flat.attributes.uv,c=new T.Color(surfaceColor);
        for(let i=0;i<p.count;i++){
            if(id==='sink')sinkParts[glazed?1:0].push(positions.length/3);
            positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n.getX(i),n.getY(i),n.getZ(i));
            // Glaze and flat rug prints need faint ageing, not triangle patches.
            const wear=glazed||id==='floor_rug'
                ? .985+.012*Math.sin(p.getX(i)*3.1+p.getY(i)*2.3)*Math.cos(p.getZ(i)*2.7)
                : .96+.04*Math.sin(Math.floor(i/3)*2.7+positions.length*.13);
            colors.push(c.r*wear,c.g*wear,c.b*wear);
            uvs.push((tile%2+.02+uv.getX(i)*.96)/2,(Math.floor(tile/2)+.02+uv.getY(i)*.96)/2);
        }
        flat.dispose();if(flat!==geo)geo.dispose();
    };
    const B=(x,y,z,w,h,d,c=wood,t=0,rx=0,rz=0)=>add(new T.BoxGeometry(1,1,1),x,y,z,w,h,d,c,t,rx,rz);
    const C=(x,y,z,r,h,c=iron,t=2,rx=0,rz=0,top=1)=>add(new T.CylinderGeometry(top,1,1,10),x,y,z,r,h,r,c,t,rx,rz);
    const legs=(top=.9,span=.4)=>{for(const x of [-span,span])for(const z of [-span,span])B(x,top/2,z,.065,top,.07,edge)};
    const knob=(x,y,z)=>B(x,y,z,.04,.025,.045,'#a29a79',2);
    // A hollow enamel shell: rounded outer wall, rim and recessed inner bowl.
    // All parts still join the family's single mesh/material.
    const bowl=(rings,z=0,color=enamel)=>{
        const vertices=[],indices=[],texcoords=[],steps=5,ringSize=4*steps;
        for(const [y,w,d,r]of rings)for(let corner=0;corner<4;corner++)for(let i=0;i<steps;i++){
            const angle=(corner+i/(steps-1))*Math.PI/2;
            const x=(corner===0||corner===3?1:-1)*(w/2-r)+Math.cos(angle)*r;
            const depth=(corner<2?1:-1)*(d/2-r)+Math.sin(angle)*r;
            vertices.push(x,y,depth);texcoords.push(x+.5,depth+.5);
        }
        for(let ring=0;ring<rings.length-1;ring++)for(let i=0;i<ringSize;i++){
            const a=ring*ringSize+i,b=ring*ringSize+(i+1)%ringSize,c=a+ringSize,d=b+ringSize;
            indices.push(a,c,b,b,c,d);
        }
        const shell=new T.BufferGeometry();shell.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
        shell.setAttribute('uv',new T.Float32BufferAttribute(texcoords,2));shell.setIndex(indices);shell.computeVertexNormals();
        add(shell,0,0,z,1,1,1,color,2);
    };
    const cabinet=(drawers=0)=>{
        B(0,.52,0,.96,.9,.92);B(0,.98,0,1,.04,1,id==='kitchen_cabinet'?'#a7a68e':edge,id==='kitchen_cabinet'?2:0);B(0,.08,0,.88,.1,.84,edge);
        if(drawers){for(let i=0;i<drawers;i++){const y=.22+i*.72/drawers;B(0,y,.475,.88,.65/drawers,.035,'#8b7050');knob(0,y,.51)}}
        else for(const x of [-.235,.235]){B(x,.54,.475,.45,.79,.035,'#89704e');knob(x<0?-.04:.04,.55,.51)}
    };
    if(id==='bed_single'||id==='bed_double'){
        for(const x of [-.43,.43])for(const z of [-.43,.43])B(x,.18,z,.07,.36,.06,iron,2);
        B(0,.38,0,.96,.16,.94,edge);B(0,.55,0,.92,.18,.87,'#a29b82',1);
        B(0,.58,.15,.93,.16,.57,'#65695b',1);B(0,.69,-.31,.65,.12,.17,'#b0aa94',1);
        // Panels fit between the posts, avoiding overlapping front/top faces.
        for(const z of [-.48,.48]){B(0,z<0?.82:.55,z,.86,z<0?.36:.2,.04,wood);for(const x of [-.46,.46])B(x,z<0?.57:.35,z,.05,z<0?.86:.56,.05,edge)}
        for(const x of [-.32,0,.32])B(x,.667,.15,.012,.008,.55,'#777a66',1);
    }else if(['nightstand','wardrobe','dresser','kitchen_cabinet'].includes(id)){
        cabinet(id==='dresser'?4:id==='nightstand'?2:0);
        // cabinet() already provides the top; a second cap shared its sides.
        if(id==='wardrobe'){for(const x of [-.38,.38])B(x,.51,.498,.018,.66,.012,edge)}
    }else if(['dining_table','stool','wood_chair'].includes(id)){
        const seat=id==='wood_chair'?.5:.94;legs(seat,.39);B(0,seat,0,1,.08,1,'#8b7253');
        for(const z of [-.38,.38])B(0,seat-.13,z,.8,.12,.05,edge);
        if(id==='wood_chair'){for(const x of [-.4,.4])B(x,.75,-.41,.07,.5,.07,edge);B(0,.88,-.41,.87,.17,.08);B(0,.66,-.41,.8,.09,.065)}
        if(id==='stool')for(const z of [-.39,.39])B(0,.3,z,.8,.06,.06,edge);
    }else if(id==='armchair'){
        legs(.18,.37);B(0,.35,.06,.82,.3,.8,cloth,1);B(0,.7,-.35,.91,.6,.24,'#686553',1,-.12);
        for(const x of [-.43,.43]){B(x,.49,.02,.14,.44,.9,'#5d604f',1);B(x,.72,.03,.15,.04,.88,wood)}
        B(0,.53,.08,.72,.07,.69,'#85816c',1);B(0,.73,-.21,.018,.34,.01,edge,1);
    }else if(id==='wall_shelf'){
        B(0,.92,0,1,.16,1);for(const x of [-.36,.36]){B(x,.44,-.43,.07,.88,.08,iron,2);B(x,.6,-.05,.07,.06,.9,iron,2,.5)}
        B(0,.85,-.46,1,.3,.07,edge);
    }else if(id==='storage_rack'){
        for(const x of [-.46,.46])for(const z of [-.43,.43])B(x,.5,z,.045,1,.055,iron,2);
        for(const y of [.06,.36,.66,.96]){B(0,y,0,.94,.035,.96,'#8b795a');B(0,y-.03,.46,.94,.06,.035,iron,2)}
        B(0,.5,-.45,.04,1,.03,edge,0,0,.45);
    }else if(id==='floor_rug'||id==='wall_rug'){
        const wall=id==='wall_rug';let layer=0;
        const panel=(x,z,w,d,c)=>{const offset=layer++*.24;wall?B(x,z+.5,-.3+offset,w,d,.2,c,1):B(x,.12+offset,z,w,.2,d,c,1)};
        panel(0,0,1,1,'#654944');panel(0,0,.9,.9,'#8b7556');panel(0,0,.83,.83,'#574e45');
        for(const z of [-.31,0,.31])for(const x of [-.26,0,.26]){
            if(wall)B(x,z+.5,.43,.15,.15,.15,'#9d8765',1,0,Math.PI/4);
            else add(new T.BoxGeometry(1,1,1),x,.88,z,.15,.12,.15,'#9d8765',1,0,0,Math.PI/4);
        }
    }else if(id==='refrigerator'){
        B(0,.5,0,.96,1,.9,enamel,2);for(const [y,h]of [[.26,.47],[.76,.47]]){B(0,y,.475,.93,h,.05,'#c1bfab',2);B(-.34,y+.02,.52,.035,.19,.035,iron,2)}
        B(0,.51,.509,.94,.015,.007,edge,2);B(.3,.04,.51,.1,.05,.01,'#7c6c4f',2);
    }else if(id==='cooker'){
        B(0,.48,0,.95,.92,.96,enamel,2);B(0,.98,0,1,.04,1,iron,2);B(0,.42,.49,.79,.51,.035,iron,2);
        B(0,.42,.515,.62,.33,.02,'#383f3a',2);B(0,.71,.53,.69,.035,.055,'#8d9187',2);
        for(const x of [-.26,.26])for(const z of [-.26,.26]){C(x,1,z,.17,.012,dark);B(x,1.009,z,.42,.012,.026,iron,2);B(x,1.009,z,.026,.012,.42,iron,2)}
        for(const x of [-.3,-.1,.1,.3])C(x,.85,.51,.035,.04,dark,2,Math.PI/2);
    }else if(id==='sink'){
        // Open cabinet carcass and a countertop with a real bowl opening.
        // A solid cabinet block/top would fill the recessed basin again.
        for(const x of [-.46,.46])B(x,.52,0,.06,.9,.92);
        B(0,.52,-.445,.86,.9,.03);B(0,.08,0,.88,.1,.84,edge);
        for(const x of [-.235,.235]){B(x,.54,.475,.45,.79,.035,'#89704e');knob(x<0?-.04:.04,.55,.51)}
        for(const z of [-.4125,.4125])B(0,.98,z,1,.04,.175,enamel,2);
        for(const x of [-.405,.405])B(x,.98,0,.19,.04,.65,enamel,2);
        bowl([[.81,.42,.45,.12],[.99,.64,.67,.13],[1.01,.64,.67,.13],[1.01,.55,.58,.1],[.84,.36,.39,.1],[.83,.01,.01,.004]],0,'#b2b8ae');
        C(0,.845,0,.035,.008,dark);
        B(0,1.11,-.36,.035,.25,.035,iron,2);B(0,1.23,-.22,.035,.035,.3,iron,2);B(.1,1.02,-.36,.14,.035,.04,iron,2);
    }else if(id==='washbasin'){
        B(0,.025,-.12,.35,.05,.35,'#939485',2);C(0,.33,-.12,.12,.62,enamel);
        bowl([[.63,.62,.54,.16],[.82,1,.86,.2],[.84,1,.86,.2],[.84,.83,.69,.16],[.69,.42,.32,.12],[.68,.01,.01,.004]],.04);
        B(0,.8,-.4,.94,.1,.12,enamel,2);C(0,.9,-.39,.025,.17,iron);
        B(0,.98,-.25,.05,.04,.3,'#8e968f',2);C(0,.945,-.11,.024,.05,iron);
        for(const x of [-.22,.22]){C(x,.88,-.39,.034,.08,'#929a92');B(x,.925,-.39,.12,.025,.035,iron,2)}
        C(0,.691,.04,.04,.006,dark);
    }else if(id==='toilet'){
        B(0,.025,.08,.55,.05,.58,'#9d9e8d',2);C(0,.23,.08,.22,.4,enamel,2,0,0,.8);
        bowl([[.3,.46,.48,.22],[.53,.94,.76,.32],[.57,.94,.76,.32],[.57,.75,.6,.27],[.37,.34,.3,.14],[.36,.01,.01,.004]],.12);
        bowl([[.57,.96,.78,.33],[.61,.96,.78,.33],[.61,.76,.6,.27],[.57,.76,.6,.27]],.12,'#bcbba5');
        // Keep the cistern above the seat: its former front face at z=-.18
        // coincided with the seat's inner rear wall (y=.57..61).
        B(0,.79,-.32,.83,.33,.28,enamel,2);B(0,.975,-.32,.88,.045,.32,'#c1c0ad',2);
        for(const x of [-.24,.24])B(x,.61,-.23,.075,.05,.07,iron,2);
        B(.27,.83,-.162,.12,.035,.035,iron,2);C(0,.367,.12,.08,.008,'#65756b');
        for(const x of [-.23,.23])C(x,.055,.12,.025,.02,iron);
    }else if(id==='bathtub'){
        for(const x of [-.33,.33])for(const z of [-.32,.32])B(x,.065,z,.09,.13,.08,iron,2);
        bowl([[.12,.64,.76,.15],[.9,.96,.98,.18],[.95,1,1,.18],[.95,.87,.9,.15],[.3,.57,.68,.14],[.29,.01,.01,.004]],0,'#aeb1a1');
        C(0,.305,-.25,.04,.009,'#747f75');
        // Mount both feet inside the rear rim's z=-.50..-.45 band.
        // The mixer, riser and spout overlap rather than floating apart.
        for(const x of [-.18,.18])C(x,.94,-.475,.025,.06,iron);
        B(0,.97,-.475,.46,.035,.04,iron,2);B(0,1.01,-.475,.035,.1,.035,iron,2);
        B(0,1.05,-.39,.04,.03,.2,'#929a92',2);
    }else if(id==='wood_stove'){
        B(0,.23,0,1,.44,1,'#8d8270',2);B(0,.48,0,1,.06,1,iron,2);B(0,.25,.515,.57,.23,.035,iron,2);knob(.2,.25,.55);
        B(0,.08,.52,.4,.05,.02,dark,2);C(0,.515,0,.28,.014,dark);C(-.28,.75,-.25,.1,.5,iron);
        for(const y of [.55,.9])C(-.28,y,-.25,.116,.025,'#696a5d');B(.29,.25,.52,.015,.16,.01,'#6b6252',2);
    }else if(id==='generator'){
        for(const x of [-.45,.45])for(const z of [-.42,.42]){B(x,.45,z,.045,.84,.045,iron,2);B(0,.08,z,.94,.06,.045,iron,2);B(0,.9,z,.94,.055,.045,iron,2)}
        B(0,.76,0,.78,.2,.77,'#686f4e',2);C(0,.88,-.12,.1,.04,dark);C(-.16,.4,0,.25,.58,'#706e60',2,0,Math.PI/2);
        B(.26,.42,0,.33,.4,.58,dark,2);for(const y of [.27,.35,.43,.51])B(.435,y,0,.012,.025,.48,'#8a8b7a',2);
        B(0,.42,.44,.48,.26,.035,'#7c7d68',2);for(const x of [-.13,.13])C(x,.42,.47,.06,.02,dark,2,Math.PI/2);
    }else if(id==='old_computer'){
        B(-.15,.62,-.12,.58,.61,.67,'#a3a18d',2);B(-.15,.32,-.1,.44,.1,.45,'#817e6e',2);
        B(-.15,.65,.23,.49,.45,.04,edge,2);B(-.15,.65,.255,.42,.37,.015,'#3f524b',2);
        B(.32,.49,-.04,.31,.96,.78,'#969782',2);B(.32,.75,.36,.24,.065,.025,edge,2);
        for(const y of [.38,.44,.5,.56])B(.32,y,.36,.22,.012,.02,'#5d6659',2);knob(.4,.62,.37);
        B(-.15,.05,.35,.62,.09,.28,'#aba58e',2);
        for(let row=0;row<4;row++)for(let col=0;col<9;col++)B(-.41+col*.064,.103,.25+row*.06,.048,.025,.045,'#767969',2);
    }else if(id==='desk_lamp'){
        C(0,.07,0,.4,.14,'#59644b');B(0,.45,-.12,.055,.72,.055,iron,2,0,-.16);C(.04,.83,0,.32,.3,'#59644b',2,.25,0,.5);
        C(.04,.7,.03,.27,.01,'#b1aa89',2,.25);
    }else if(id==='wood_crate'){
        for(let i=0;i<4;i++){const y=.14+i*.23;for(const z of [-.46,.46])B(0,y,z,1,.19,.065,i%2?wood:'#897557');for(const x of [-.46,.46])B(x,y,0,.065,.19,.87,wood)}
        for(const x of [-.4,.4])for(const z of [-.43,.43])B(x,.5,z,.075,.94,.075,edge);
        crateBottomStart=positions.length/3;
        for(let i=0;i<5;i++)B(-.4+i*.2,.04,0,.18,.08,.91,wood);
    }else if(id==='cardboard_box'){
        B(0,.49,0,.98,.98,.98,'#96805a',3);B(0,.987,0,.04,.012,.97,edge,3);B(0,.997,0,.17,.006,1,'#b3a17b',3);
        B(0,.47,.496,.49,.26,.012,'#b5a789',3);for(const x of [-.12,-.06,0,.06,.12])B(x,.47,.504,.015,.16,.004,edge,3);
    }else if(id==='jerrycan'){
        B(0,.43,0,.94,.83,.94,'#626e4f',2);B(0,.87,0,.91,.07,.87,'#5b664a',2);
        B(-.12,.98,0,.56,.04,.18,iron,2);for(const x of [-.37,.13])B(x,.92,0,.06,.12,.18,iron,2);C(.34,.94,0,.11,.1,iron);
        for(const z of [-.48,.48])for(const sign of [-1,1])B(0,.44,z,.045,.65,.025,'#7d8568',2,0,sign*.65);
    }else throw Error('Unknown household model: '+id);
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geo.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
    if(id==='sink'){
        // Two batches share the same geometry: wood retains its atlas; the
        // basin/countertop use smooth enamel without the furniture texture.
        geo.setIndex(sinkParts[0].concat(sinkParts[1]));
        geo.addGroup(0,sinkParts[0].length,0);geo.addGroup(sinkParts[0].length,sinkParts[1].length,1);
    }
    // Keep exact physical catalogue bounds, including details such as taps/feet.
    geo.computeBoundingBox();const box=geo.boundingBox,size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
    geo.translate(-center.x,-box.min.y,-center.z);geo.scale(1/size.x,1/size.y,1/size.z);
    if(crateBottomStart>=0){
        // Apply after normalisation, otherwise re-centring would cancel the gap.
        // One centimetre at the catalogue's original 0.42 m height; pivot stays put.
        const p=geo.attributes.position;
        for(let i=crateBottomStart;i<p.count;i++)p.setY(i,p.getY(i)+.01/.42);
        geo.computeBoundingBox();
    }
    geo.userData.householdShared=true;cache.geometries.set(id,geo);return geo;
}

export function createHouseholdModel(T,asset,dimensions,color) {
    const cache=resources(T),id=asset.visual?.modelId||asset.id.replace('household_','');
    const material=cache.material.clone();
    if(ceramicModels.has(id)){
        // The furniture atlas carries directional wood/cloth patterns. Glaze
        // uses vertex colours only, with no fibre texture, normal or bump map.
        material.map=null;material.roughness=.28;material.metalness=0;
    }
    if(color&&color.toLowerCase()!==asset.color.toLowerCase())material.color.set(color);
    let materials=material;
    if(id==='sink'){
        const glaze=material.clone();glaze.map=null;glaze.roughness=.28;glaze.metalness=0;
        materials=[material,glaze];
    }
    const mesh=new T.Mesh(geometryFor(T,id,cache),materials);
    mesh.scale.set(dimensions.width,dimensions.height,dimensions.depth);
    mesh.userData.householdAssetId=asset.id;return mesh;
}
