// Called by the read-only Pripyat harness with VTT_PERF_VERIFY=1.
const assert = require('node:assert/strict');
module.exports = async page => {
    const result = await page.evaluate(`(async()=>{
        const T=await import('three');
        const {createLocationRenderBatches}=await import('/static/js/locationRenderBatches.js');
        const {applySurfacePattern}=await import('/static/js/locationTerrainDetail.js');
        const {createDirectionalLightField,createDirectionalLightFieldTexture,applyDirectionalLightFieldMaterial,removeDirectionalLightFieldMaterial}=await import('/static/js/locationDirectionalLightFieldPrototype.js');
        const actualScene=__quarterPerf.scene,actualRenderer=__quarterPerf.renderer;
        const actualTarget=new T.WebGLRenderTarget(720,450),savedTarget=actualRenderer.getRenderTarget();
        const visual=[];
        try{
            for(const level of [0,1]){
                L.setLocationViewLevel(level);
                const pixels=()=>{actualRenderer.setRenderTarget(actualTarget);actualRenderer.render(actualScene,locationControls.object);
                    const p=new Uint8Array(720*450*4);actualRenderer.readRenderTargetPixels(actualTarget,0,0,720,450,p);return p};
                const expected=pixels();__quarterPerf.batches.prepare();let actual;
                try{actual=pixels()}finally{__quarterPerf.batches.restore()}
                let bad=0,total=0,max=0;
                for(let i=0;i<actual.length;i++){const d=Math.abs(expected[i]-actual[i]);total+=d;max=Math.max(max,d);if(d>4)bad++}
                visual.push({level,badChannels:bad,meanDifference:total/actual.length,max});
                if(bad/actual.length>.005)throw Error('Saved Pripyat pixel mismatch: '+JSON.stringify(visual));
            }
        }finally{L.setLocationViewLevel(0);actualRenderer.setRenderTarget(savedTarget);actualTarget.dispose();}
        const scene=new T.Scene(),roots=[],checks=[];
        scene.add(new T.AmbientLight(0xffffff,.8));
        const sun=new T.DirectionalLight(0xffffff,.6);sun.position.set(4,8,5);scene.add(sun);
        const camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.set(4,5,9);camera.lookAt(0,0,0);
        const renderer=__quarterPerf.renderer,target=new T.WebGLRenderTarget(160,160);
        const oldTarget=renderer.getRenderTarget(),oldShadows=renderer.shadowMap.enabled;
        renderer.shadowMap.enabled=false;
        const pixel=()=>{renderer.setRenderTarget(target);renderer.render(scene,camera);const a=new Uint8Array(160*160*4);renderer.readRenderTargetPixels(target,0,0,160,160,a);return a};
        const check=(ok,name)=>{if(!ok)throw Error(name);checks.push(name)};
        const add=(x,color)=>{const root=new T.Group(),m=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color,roughness:.8}));root.position.set(x,0,0);root.rotation.y=.12345;m.scale.set(.8,1.2,.7);root.add(m);roots.push(root);scene.add(root);return m};
        const a=add(1,'#786451'),b=add(3,'#7f9471');camera.lookAt(2,0,0);
        const batcher=createLocationRenderBatches(T,scene,()=>roots);
        const batches=()=>scene.children.filter(m=>m.userData.locationRenderBatch);
        let largestDifference=0;
        const compare=name=>{batcher.restore();const expected=pixel();batcher.prepare();const actual=pixel();let bad=0,max=0;
            for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);max=Math.max(max,d);if(d>2)bad++}
            largestDifference=Math.max(largestDifference,max);check(bad<20,name+' pixels');batcher.restore();};
        try{
            compare('original geometry and individual colors');
            batcher.prepare();check(batches().length===1&&!a.visible&&!b.visible,'one render batch');
            const geometry=batches()[0].geometry;
            batcher.withOriginals(()=>check(a.visible&&b.visible,'original shadow casters restored'));
            check(!a.visible&&!b.visible,'shadow restoration scoped');batcher.restore();
            batcher.prepare();check(batches()[0].geometry===geometry,'idle frame reuses buffers');batcher.restore();
            camera.position.x+=.25;camera.lookAt(0,0,0);batcher.prepare();check(batches()[0].geometry===geometry,'camera movement reuses buffers');batcher.restore();
            b.parent.position.x+=.345;b.parent.rotation.y=.54321;compare('fractional transform');
            b.material.color.setRGB(.123456,.234567,.345678);compare('exact material color change');
            b.geometry.attributes.position.setY(0,1.2345);b.geometry.attributes.position.needsUpdate=true;compare('geometry version change');
            const c=add(2,'#665588');compare('create object');scene.remove(c.parent);roots.pop();compare('delete object');
            roots.push(c.parent);scene.add(c.parent);compare('undo delete');scene.remove(c.parent);roots.pop();compare('redo delete');
            b.parent.visible=false;batcher.prepare();check(batches().length===0&&a.visible,'hidden floor excluded');batcher.restore();b.parent.visible=true;
            b.material.transparent=true;b.material.opacity=.35;compare('transparent object fallback');b.material.transparent=false;b.material.opacity=1;
            const texture=new T.DataTexture(new Uint8Array([100,100,100,255]),1,1,T.RGBAFormat);texture.needsUpdate=true;
            for(const m of [a,b]){applySurfacePattern(m.material,texture,.22,'top');m.material.needsUpdate=true;}
            compare('roof surface shader');
            const field=createDirectionalLightField({width:8,height:8,levels:[{id:0,y:0}],samplesPerMeter:2});
            field.rebuild({lamps:[{id:0,level:0,x:2,y:2,z:2,color:'#ffffff',intensity:2,distance:7}]});
            const fieldTexture=createDirectionalLightFieldTexture(T,field);
            for(const m of [a,b]){m.scale.setScalar(1);applyDirectionalLightFieldMaterial(m.material,fieldTexture,field,0);}
            compare('static field world positions and normals');
            batcher.prepare();check(batches().length===1,'known shader chain batches');batcher.restore();
            for(const m of [a,b])m.scale.set(1,2,1);
            compare('nonuniform directional field normals');batcher.prepare();check(batches().length===1,'nonuniform directional field batches');batcher.restore();
            for(const m of [a,b]){removeDirectionalLightFieldMaterial(m.material);m.scale.setScalar(1);}
            fieldTexture.dispose();compare('field detach restores surface shader');
            b.material.onBeforeCompile=()=>{};b.material.needsUpdate=true;
            batcher.prepare();check(batches().length===0,'unknown shader excluded');batcher.restore();
            check(roots.every(root=>root.children[0].visible),'original visibility restored');
            batcher.dispose();texture.dispose();check(batches().length===0,'batch cleanup');
            return {checks,largestDifference,visual};
        }finally{batcher.dispose();for(const root of roots)root.traverse(m=>{m.geometry?.dispose();m.material?.dispose()});target.dispose();renderer.setRenderTarget(oldTarget);renderer.shadowMap.enabled=oldShadows;}
    })()`);
    assert.ok(result.checks.length >= 15);
    console.log('RENDER BATCH GPU PASS',result);
};
