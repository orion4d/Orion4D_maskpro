// Orion4D MaskPro — Editor (full, with: 2048px brush, custom PNG transparency+rotation,
// brush grid picker, hand tool, magic wand, wheel zoom at cursor, undo/redo,
// global tools in top bar (blur/dilate/contract + rembg AI), export opaque PNG).
(() => {
  if (!/\/extensions\/Orion4D_maskpro\/editor\.html$/i.test(location.pathname)) return;

  // ---------- helpers
  const $ = (id)=>document.getElementById(id);
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const toBlobURL=async(url)=>{ const r=await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error(`HTTP ${r.status}`); const b=await r.blob(); return URL.createObjectURL(b); };

  // ---------- DOM
  const canImg=$("img"), canOv=$("overlay");
  const ctxI=canImg.getContext("2d",{willReadFrequently:true});
  const ctxO=canOv.getContext("2d",{willReadFrequently:true});
  const appMain=$("app"), center=$("center"), stageOuter=$("stageOuter");
  const resizer=$("resizer"), statusEl=$("status");
  const toolPalette=$("toolPalette"), rightbar=$("toolSettings");

  // top global bar
  const zoomEl=$("zoom"), zoomVal=$("zoomVal"), maskOnlyEl=$("maskOnly");
  const clearBtn=$("clear"), clearSelectionBtn=$("clearSelection"), fillSelectionBtn=$("fillSelection"), invertBtn=$("invert"), exportBtn=$("export"), saveBtn=$("saveClose");
  const applyBlurBtn=$("applyBlur"), applySmoothBtn=$("applySmooth"), applyImgThresholdBtn=$("applyImgThreshold");
  const applyMaskThresholdBtn=$("applyMaskThreshold"), applyDilateBtn=$("applyDilate"), applyErodeBtn=$("applyErode"), aiCutBtn=$("aiCutout");
  
  // palette buttons
  const toolboxBtn=$("toolboxBtn"), eraseToggleBtn=$("eraseToggle");

  // brush & selection tools
  const brushSize=$("brush"), brushHard=$("hard"), brushOpacity=$("opacity"), brushSmooth=$("smooth");
  const brushSpacing=$("brushSpacing");
  const brushShapeRound=$("brushShapeRound"), shapeSquare=$("brushShapeSquare"), shapeCustom=$("brushShapeCustom"); brushSpacing.value = 1;
  const customRow=$("customBrushRow"), customRow2=$("customBrushRow2"), customRow3=$("customBrushRow3"), customRowPicker=$("customBrushRowPicker");
  const customList=$("customBrushList"), reloadBrush=$("reloadBrushes"), customName=$("customBrushName"), loadBrush=$("loadBrush");
  const customRot=$("customRot"), customRotVal=$("customRotVal"), openBrushGrid=$("openBrushGrid");
  const gridModal=$("brushGridModal"), gridClose=$("brushGridClose"), gridRefresh=$("brushGridRefresh"), gridWrap=$("brushGrid");
  const lassoAutofill=$("lassoAutofill"), polyAutofill=$("polyAutofill"), ellAutofill=$("ellAutofill"), ellCenter=$("ellCenter");
  const rectAutofill=$("rectAutofill"), rectCenter=$("rectCenter"), gradRadial=$("gradRadial");
  const wandAdd=$("wandAdd"), wandSub=$("wandSub");

  const nodeId=new URLSearchParams(location.search).get("node_id");

  // ---------- constants & state
  const BRUSH_BASE='/extensions/Orion4D_maskpro/brushes/', BRUSH_MAX=2048, STROKE_MAX_OPACITY=255;
  let W=0, H=0, zoom=1, tool="brush", alphaBuf=null, currentSelection=null, selectionEdges=null, hasActiveSelection=false;
  let drawing=false, panning=false, hHeld=false, ctrlHeld=false, altHeld=false, shiftHeld=false, qHeld=false, panStart={x:0,y:0,sl:0,st:0}, trackingMove=false;
  let movingSelection=false, moveSelStart={x:0,y:0};
  let cursorX=0, cursorY=0, lastX=null, lastY=null, startX=0, startY=0;
  const lassoPts=[], polyPts=[]; let polyActive=false; let curX=0, curY=0;
  let ERASE=false; const setEraseUI=()=>eraseToggleBtn.classList.toggle("on",ERASE);
  
  let toolBeforePan = null;
  let originalBackgroundImage = null;
  let strokeBuffer = null;
  // history
  const undoStack=[], redoStack=[], MAX_HIST=50;
  const pushHistory=()=>{ if(!alphaBuf) return; undoStack.push(new Uint8ClampedArray(alphaBuf)); if(undoStack.length>MAX_HIST) undoStack.shift(); redoStack.length=0; };
  const undo=()=>{ if(!undoStack.length) return; redoStack.push(new Uint8ClampedArray(alphaBuf)); alphaBuf.set(undoStack.pop()); refreshOverlay(); };
  const redo=()=>{ if(!redoStack.length) return; undoStack.push(new Uint8ClampedArray(alphaBuf)); alphaBuf.set(redoStack.pop()); refreshOverlay(); };

  // ---------- layout & drawing
  function setSize(w,h){W=w;H=h;canImg.width=W;canImg.height=H;canOv.width=W;canOv.height=H;}
  function drawBackground(img){ctxI.clearRect(0,0,W,H); if(img) ctxI.drawImage(img,0,0,W,H);}
  function applyZoom(z, centerPoint = null){
    if (!centerPoint) {
      const rect = center.getBoundingClientRect();
      centerPoint = { x: rect.width / 2, y: rect.height / 2, scrollX: center.scrollLeft, scrollY: center.scrollTop };
    }
    const oldZoom = zoom;
    zoom = clamp(z, 0.1, 10);
    stageOuter.style.transform = `scale(${zoom})`;
    zoomEl.value = Math.round(zoom * 100);
    qs("#zoomVal").textContent = `${Math.round(zoom * 100)}%`;
    
    center.scrollLeft = centerPoint.scrollX + centerPoint.x * (zoom / oldZoom - 1);
    center.scrollTop = centerPoint.scrollY + centerPoint.y * (zoom / oldZoom - 1);
  }
  function fitToViewport(){ const vb=center.getBoundingClientRect(), pad=48; const z=Math.max(0.1,Math.min((vb.width-pad)/W,(vb.height-pad)/H)); applyZoom(z); }
  function screenToImage(cx,cy){ const r=canOv.getBoundingClientRect(); return [(cx-r.left)/zoom, (cy-r.top)/zoom]; }

  (function(){
    let dragging=false,startX=0,startW=360; const parseCols=()=>(getComputedStyle(appMain).gridTemplateColumns||"64px 1fr 8px 360px").split(" ");
    resizer.addEventListener("mousedown",(e)=>{dragging=true;startX=e.clientX;startW=parseInt(parseCols()[3])||360;document.body.style.cursor="col-resize";e.preventDefault();});
    window.addEventListener("mousemove",(e)=>{if(!dragging)return;const dx=e.clientX-startX;const w=clamp(startW-dx,220,680);appMain.style.gridTemplateColumns=`64px 1fr 8px ${w}px`;});
    window.addEventListener("mouseup",()=>{dragging=false;document.body.style.cursor="";});
  })();

  center.addEventListener("wheel",(e)=>{
    e.preventDefault();
    const rect = center.getBoundingClientRect();
    const centerPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top, scrollX: center.scrollLeft, scrollY: center.scrollTop };
    const newZoom = zoom * (e.deltaY > 0 ? 0.95 : 1.05);
    applyZoom(newZoom, centerPoint);
  },{passive:false});

  let marchOffset=0, animFrame;
  function updateMarchingAnts(){
    marchOffset = (marchOffset+1) % 20;
    refreshOverlay();
    if(hasActiveSelection) animFrame=requestAnimationFrame(updateMarchingAnts);
  }
  function startAnimation(){ if(!animFrame){animFrame=requestAnimationFrame(updateMarchingAnts);} }
  function stopAnimation(){ if(animFrame){cancelAnimationFrame(animFrame); animFrame=null;} }

  function updateSelectionEdges(){
    if(!currentSelection) return;
    selectionEdges.fill(0); hasActiveSelection=false;
    for(let y=1; y<H-1; y++){ for(let x=1; x<W-1; x++){
        const i=y*W+x;
        if(currentSelection[i]>128){
          hasActiveSelection=true;
          if(currentSelection[i-1]<128||currentSelection[i+1]<128||currentSelection[i-W]<128||currentSelection[i+W]<128) selectionEdges[i]=255;
        }
    }}
    if(hasActiveSelection) startAnimation(); else stopAnimation();
  }
  
  function getCurrentBrushSize() {
      let size = parseInt(brushSize?.value, 10);
      if (shapeCustom.checked && customBrushImg) {
          return size || Math.max(customBrushImg.width, customBrushImg.height);
      }
      return size || 20;
  }

  function drawBrushGhost(){
    if(tool!=="brush"||drawing) return;
    const op=0.35; ctxO.save(); ctxO.globalAlpha=op;
    const size = getCurrentBrushSize();
    
    if(shapeCustom.checked && customBrushImg){
      const finalSize=Math.min(BRUSH_MAX, size);
      const scale=finalSize/Math.max(customBrushImg.width,customBrushImg.height);
      const bw=Math.max(1,Math.round(customBrushImg.width*scale)), bh=Math.max(1,Math.round(customBrushImg.height*scale));
      const rot=(parseFloat(customRot?.value)||0)*Math.PI/180;
      ctxO.translate(cursorX,cursorY); ctxO.rotate(rot); ctxO.drawImage(customBrushImg,-bw/2,-bh/2,bw,bh);
    }else if(shapeSquare?.checked){
      const s=Math.min(BRUSH_MAX,size);
      ctxO.fillStyle="#00d0ff55"; ctxO.fillRect(cursorX-s/2,cursorY-s/2,s,s);
    }else{
      const r=Math.min(BRUSH_MAX,size/2);
      ctxO.beginPath(); ctxO.arc(cursorX,cursorY,r,0,Math.PI*2); ctxO.fillStyle="#00d0ff55"; ctxO.fill();
    }
    ctxO.restore();
  }
  function drawLassoPreview(){ if(!drawing||tool!=="lasso"||lassoPts.length<2) return; ctxO.save(); ctxO.strokeStyle="#ffcc00"; ctxO.setLineDash([4,3]); ctxO.beginPath(); ctxO.moveTo(lassoPts[0].x,lassoPts[0].y); for(let i=1;i<lassoPts.length;i++) ctxO.lineTo(lassoPts[i].x,lassoPts[i].y); ctxO.stroke(); ctxO.restore(); }
  function drawPolyPreview(){ if(!polyActive||polyPts.length===0) return; ctxO.save(); ctxO.strokeStyle="#ffd966"; ctxO.setLineDash([3,6]); ctxO.beginPath(); ctxO.moveTo(polyPts[0].x,polyPts[0].y); for(let i=1;i<polyPts.length;i++) ctxO.lineTo(polyPts[i].x,polyPts[i].y); ctxO.lineTo(curX,curY); ctxO.stroke(); ctxO.restore(); }
  function drawShapePreview(){
    if(!drawing) return; if(tool!=="ellipse"&&tool!=="rect"&&tool!=="grad") return;
    ctxO.save(); ctxO.setLineDash([6,4]); ctxO.strokeStyle="#7ad7ff"; ctxO.lineWidth=1.5;
    if(tool==="ellipse"){ let C=altHeld||ellCenter.checked; let x,y,w,h; if(C){w=Math.abs(curX-startX)*2;h=Math.abs(curY-startY)*2;x=startX-w/2;y=startY-h/2;} else{x=Math.min(startX,curX);y=Math.min(startY,curY);w=Math.abs(curX-startX);h=Math.abs(curY-startY);} if(ctrlHeld){const m=Math.max(w,h);w=h=m;if(C){x=startX-m/2;y=startY-m/2;}else{if(curX<startX)x=startX-m;if(curY<startY)y=startY-m;}} ctxO.beginPath(); if(w>0&&h>0) ctxO.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2); ctxO.stroke(); }
    else if(tool==="rect"){ let C=altHeld||rectCenter.checked; let x,y,w,h; if(C){w=Math.abs(curX-startX)*2;h=Math.abs(curY-startY)*2;x=startX-w/2;y=startY-h/2;} else{x=Math.min(startX,curX);y=Math.min(startY,curY);w=Math.abs(curX-startX);h=Math.abs(curY-startY);} if(ctrlHeld){const m=Math.max(w,h); if(C){w=h=m;x=startX-m/2;y=startY-m/2;} else {if(curX<startX)x=startX-m; else x=startX; if(curY<startY)y=startY-m; else y=startY; w=h=m;}} ctxO.strokeRect(x,y,w,h); }
    else if(tool==="grad"){ ctxO.beginPath(); ctxO.moveTo(startX,startY); ctxO.lineTo(curX,curY); ctxO.stroke(); }
    ctxO.restore();
  }

  function refreshOverlay(){
    ctxO.clearRect(0,0,W,H); 
    if(!alphaBuf) return;

    const isMaskOnly = maskOnlyEl.checked;
    if (isMaskOnly) {
        drawBackground(null);
    } else {
        drawBackground(originalBackgroundImage);
    }
    
    const id=ctxO.createImageData(W,H), d=id.data;
    const maskOpacity = isMaskOnly ? 1.0 : 0.5;

    for(let i=0;i<alphaBuf.length;i++){ 
      const A=alphaBuf[i];
      if (A > 0) {
        const p=i*4; 
        if(isMaskOnly) {
          d[p]=d[p+1]=d[p+2]=A; d[p+3]=255; 
        } else {
          d[p]=255;d[p+1]=0;d[p+2]=0;d[p+3]=Math.round(A * maskOpacity); 
        }
      }
    }
    
    if (strokeBuffer) {
      for (let i=0; i<strokeBuffer.length; i++) {
        const A = strokeBuffer[i];
        if (A > 0) {
          const p=i*4;
          const strokeAlpha = A / 255;
          if(isMaskOnly) {
            const currentVal = d[p];
            const finalVal = clamp(currentVal + strokeAlpha * (255 - currentVal), 0, 255);
            d[p] = d[p+1] = d[p+2] = finalVal;
            d[p+3] = 255;
          } else {
            d[p] = 255; d[p+1]=0; d[p+2]=0;
            d[p+3] = clamp(d[p+3] + strokeAlpha * (255 - d[p+3]) * maskOpacity, 0, 255);
          }
        }
      }
    }

    if(hasActiveSelection){
      for(let i=0; i<selectionEdges.length; i++){
        if(selectionEdges[i]===255){
          const p=i*4, x=i%W, y=Math.floor(i/W), on=(x+y+marchOffset)%10<5;
          d[p]=on?255:0; d[p+1]=on?255:0; d[p+2]=on?255:0; d[p+3]=255;
        }
      }
    }
    ctxO.putImageData(id,0,0);
    drawLassoPreview(); drawPolyPreview(); drawShapePreview(); drawBrushGhost();
  }

  function gaussianKernel1D(s){const r=Math.max(1,Math.ceil(s*3)),w=new Float32Array(r*2+1),s2=2*s*s;let sum=0;for(let i=-r,j=0;i<=r;i++,j++){const v=Math.exp(-(i*i)/s2);w[j]=v;sum+=v;}for(let j=0;j<w.length;j++)w[j]/=sum;return{w,r};}
  function blurBufferInPlace(buf,w,h,s){if(!(s>0))return;const {w:ker,r}=gaussianKernel1D(s);const tmp=new Float32Array(w*h);
    for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let acc=0;for(let k=-r;k<=r;k++){const xx=clamp(x+k,0,w-1);acc+=buf[row+xx]*ker[k+r];}tmp[row+x]=acc;}}
    for(let x=0;x<w;x++){for(let y=0;y<h;y++){let acc=0;for(let k=-r;k<=r;k++){const yy=clamp(y+k,0,h-1);acc+=tmp[yy*w+x]*ker[k+r];}buf[y*w+x]=acc|0;}}}
  function applySelection(sel,op01,erase){
    const opa=clamp(op01,0,1)*255;
    for(let i=0;i<sel.length;i++){ if(sel[i]>0){ const val=(sel[i]/255)*opa; alphaBuf[i]=erase?clamp(alphaBuf[i]-val,0,255):clamp(alphaBuf[i]+val,0,255); } }
  }
  function rasterPolygon(pts){ const t=document.createElement("canvas");t.width=W;t.height=H; const tc=t.getContext("2d",{willReadFrequently:true}); tc.fillStyle="#fff";tc.beginPath();tc.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)tc.lineTo(pts[i].x,pts[i].y);tc.closePath();tc.fill(); const d=tc.getImageData(0,0,W,H).data, sel=new Uint8ClampedArray(W*H); for(let i=0,j=0;i<d.length;i+=4,j++) sel[j]=d[i]; return sel; }
  function rasterEllipseRect(kind,x,y,w,h){ const t=document.createElement("canvas");t.width=W;t.height=H;const tc=t.getContext("2d",{willReadFrequently:true});tc.fillStyle="#fff"; if(kind==="ellipse"){tc.beginPath(); if(w>0&&h>0)tc.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);tc.closePath();tc.fill();} else {tc.fillRect(x,y,w,h);} const d=tc.getImageData(0,0,W,H).data, sel=new Uint8ClampedArray(W*H); for(let i=0,j=0;i<d.length;i+=4,j++) sel[j]=d[i]; return sel; }
  function rasterRectAdvanced(x0,y0,x1,y1,useCenter,constrainSquare,cornerR){ let x,y,w,h; if(useCenter){w=Math.abs(x1-x0)*2;h=Math.abs(y1-y0)*2;x=x0-w/2;y=y0-h/2;} else{x=Math.min(x0,x1);y=Math.min(y0,y1);w=Math.abs(x1-x0);h=Math.abs(y1-y0);} if(constrainSquare){ const m=Math.max(w,h); if(useCenter){w=h=m;x=x0-m/2;y=y0-m/2;} else{ if(x1<x0) x=x0-m; if(y1<y0) y=y0-m; w=h=m; } } const t=document.createElement("canvas");t.width=W;t.height=H;const tc=t.getContext("2d",{willReadFrequently:true});tc.fillStyle="#fff"; if(cornerR>0&&w>cornerR*2&&h>cornerR*2&&tc.roundRect){tc.beginPath();tc.roundRect(x,y,w,h,cornerR);tc.fill();} else tc.fillRect(x,y,w,h); const d=tc.getImageData(0,0,W,H).data, sel=new Uint8ClampedArray(W*H); for(let i=0,j=0;i<d.length;i+=4,j++) sel[j]=d[i]; return sel; }
  function rasterGradientLinear(x0,y0,x1,y1){ const t=document.createElement("canvas");t.width=W;t.height=H;const tc=t.getContext("2d",{willReadFrequently:true}); const g=tc.createLinearGradient(x0,y0,x1,y1); g.addColorStop(0,"#fff"); g.addColorStop(1,"#000"); tc.fillStyle=g; tc.fillRect(0,0,W,H); const d=tc.getImageData(0,0,W,H).data, out=new Uint8ClampedArray(W*H); for(let i=0,j=0;i<d.length;i+=4,j++) out[j]=d[i]; return out; }
  function rasterGradientRadial(x0,y0,x1,y1){ const r=Math.max(1,Math.hypot(x1-x0,y1-y0)); const t=document.createElement("canvas");t.width=W;t.height=H;const tc=t.getContext("2d",{willReadFrequently:true}); const g=tc.createRadialGradient(x0,y0,0,x0,y0,r); g.addColorStop(0,"#fff"); g.addColorStop(1,"#000"); tc.fillStyle=g; tc.fillRect(0,0,W,H); const d=tc.getImageData(0,0,W,H).data, out=new Uint8ClampedArray(W*H); for(let i=0,j=0;i<d.length;i+=4,j++) out[j]=d[i]; return out; }
  
  function stampCircle(ix,iy){ if(!strokeBuffer) return; const size=getCurrentBrushSize(), r=size/2, hard=parseInt(brushHard?.value,10), op=parseInt(brushOpacity?.value,10); const hard01=clamp(hard/100,0,1), maxA=clamp(op/100,0,1)*STROKE_MAX_OPACITY, r2=r*r, soft=r*(1-hard01); const minx=Math.max(0,Math.floor(ix-r)),maxx=Math.min(W-1,Math.ceil(ix+r)), miny=Math.max(0,Math.floor(iy-r)),maxy=Math.min(H-1,Math.ceil(iy+r)); for(let y=miny;y<=maxy;y++){const dy=y-iy; for(let x=minx;x<=maxx;x++){const dx=x-ix; const d2=dx*dx+dy*dy; if(d2>r2) continue; const d=Math.sqrt(d2); let fall=1.0; if(soft>0.1 && d>r-soft){ const v=(d-(r-soft))/soft; fall=1-v;} fall=fall*fall; const add=maxA*fall, k=y*W+x; strokeBuffer[k]=Math.max(strokeBuffer[k],add);}}}
  function stampSquare(ix,iy){ if(!strokeBuffer) return; const s=getCurrentBrushSize(), half=s/2, hard=parseInt(brushHard?.value,10), op=parseInt(brushOpacity?.value,10); const hard01=clamp(hard/100,0,1), maxA=clamp(op/100,0,1)*STROKE_MAX_OPACITY, soft=half*(1-hard01); const minx=Math.max(0,Math.floor(ix-half)),maxx=Math.min(W-1,Math.ceil(ix+half)),miny=Math.max(0,Math.floor(iy-half)),maxy=Math.min(H-1,Math.ceil(iy+half)); for(let y=miny;y<=maxy;y++){const dy=y-iy; for(let x=minx;x<=maxx;x++){const dx=x-ix; const dist=Math.max(Math.abs(dx),Math.abs(dy)); if(dist>half) continue; let fall=1.0; if(soft>0.1 && dist>half-soft){ const v=(dist-(half-soft))/soft; fall=1-v; } fall=fall*fall; const add=maxA*fall, k=y*W+x; strokeBuffer[k]=Math.max(strokeBuffer[k],add); }}}
  let customBrushImg=null;
  function stampCustom(ix,iy){ if(!strokeBuffer){ return; } if(!customBrushImg){ stampCircle(ix,iy); return; } const size=getCurrentBrushSize(), scale=size/Math.max(customBrushImg.width,customBrushImg.height); const bw=Math.max(1,Math.round(customBrushImg.width*scale)), bh=Math.max(1,Math.round(customBrushImg.height*scale)), rot=(parseFloat(customRot?.value)||0)*Math.PI/180; const pw=Math.ceil(Math.hypot(bw,bh)), ph=pw; const p=document.createElement("canvas"); p.width=pw; p.height=ph; const pc=p.getContext("2d",{willReadFrequently:true}); pc.translate(pw/2,ph/2); pc.rotate(rot); pc.drawImage(customBrushImg,-bw/2,-bh/2,bw,bh); const t=document.createElement("canvas"); t.width=bw; t.height=bh; const tc=t.getContext("2d",{willReadFrequently:true}); const sx=(pw-bw)/2, sy=(ph-bh)/2; tc.drawImage(p,-sx,-sy); const d=tc.getImageData(0,0,bw,bh).data, maxA=clamp((parseInt(brushOpacity?.value,10)||100)/100,0,1)*STROKE_MAX_OPACITY; for(let y=0;y<bh;y++){ const yy=Math.round(iy-bh/2+y); if(yy<0||yy>=H) continue; for(let x=0;x<bw;x++){ const xx=Math.round(ix-bw/2+x); if(xx<0||xx>=W) continue; const dp=(y*bw+x)*4; const r=d[dp], g=d[dp+1], b=d[dp+2], a=d[dp+3]/255, lum=(r+g+b)/(3*255), weight=(1-lum)*a; if(weight<=0) continue; const add=maxA*weight, k=yy*W+xx; strokeBuffer[k]=Math.max(strokeBuffer[k],add); } } }
  function brushMove(ix,iy){ const smoothing=(parseInt(brushSmooth?.value,10)||0)/100; if(lastX==null){lastX=ix;lastY=iy;} const smx=lerp(lastX,ix,1-smoothing), smy=lerp(lastY,iy,1-smoothing); const spacing=(parseInt(brushSpacing?.value,10)||1)/100; const step=Math.max(1, getCurrentBrushSize() * spacing); const d=Math.hypot(smx-lastX,smy-lastY), nx=(smx-lastX)/d||0, ny=(smy-lastY)/d||0; const useRound=brushShapeRound.checked, useSquare=shapeSquare.checked, useCustom=shapeCustom.checked; for(let t=0;t<=d;t+=step){ const sx=lastX+nx*t, sy=lastY+ny*t; if(useCustom) stampCustom(sx,sy); else if(useSquare) stampSquare(sx,sy); else stampCircle(sx,sy); } lastX=smx; lastY=smy; }

  function forceTool(name) {
    tool = name;
    qsa(".tool", toolPalette).forEach(el => {
      if(el.id!=="eraseToggle" && el.id!=="toolboxBtn") {
        el.classList.toggle("active", el.dataset.tool === tool);
      }
    });
    qsa(".toolcfg", rightbar).forEach(el => el.style.display = el.dataset.toolcfg === tool ? "block" : "none");
    if(tool === "hand") canOv.style.cursor = "grab";
    else if(tool === "zoom") canOv.style.cursor = altHeld ? "zoom-out" : "zoom-in";
    else if(tool) canOv.style.cursor = "crosshair";
    else canOv.style.cursor = "default";
    polyActive = false; polyPts.length = 0;
    refreshOverlay();
  }
  function setTool(name){ if (tool === name) forceTool(null); else forceTool(name); }
  qsa(".tool",toolPalette).forEach(el=>{ if(el.id!=="eraseToggle"&&el.id!=="toolboxBtn") el.addEventListener("click",()=> setTool(el.dataset.tool)); });
  function toggleErase(){ERASE=!ERASE; setEraseUI();}
  eraseToggleBtn.addEventListener("click",toggleErase);

  [brushShapeRound,shapeSquare,shapeCustom].forEach(r=>{r.addEventListener("change",()=>{ const on=shapeCustom.checked; customRow.style.display=customRow2.style.display=customRow3.style.display=customRowPicker.style.display=on?"flex":"none"; refreshOverlay();});});
  async function listBrushes(){ let items=[]; try{ const r=await fetch(`/orion4d_maskpro/list_brushes?ts=${Date.now()}`,{cache:"no-store"}); if(r.ok){ const j=await r.json(); if(j && Array.isArray(j.files)) items=j.files; } }catch{} customList.innerHTML=""; if(!items.length){ const o=document.createElement("option"); o.value=""; o.textContent="(no listing)"; customList.appendChild(o); } else { for(const f of items){ const o=document.createElement("option"); o.value=f; o.textContent=f; customList.appendChild(o); } } }
  reloadBrush.addEventListener("click", listBrushes); customList.addEventListener("change",()=> customName.value=customList.value);
  async function loadCustomBrushByName(name){ const url=`${BRUSH_BASE}${encodeURIComponent(name)}`, blobURL=await toBlobURL(url); const img=new Image(); img.crossOrigin="anonymous"; await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=blobURL; }); customBrushImg=img; statusEl.textContent=`Custom brush loaded (${img.naturalWidth||img.width}×${img.naturalHeight||img.height})`; refreshOverlay(); }
  loadBrush.addEventListener("click", async ()=>{ if(!customName.value) return; try{ await loadCustomBrushByName(customName.value); }catch{ statusEl.textContent="Failed to load custom brush."; } });
  function openBrushPicker(){ gridWrap.innerHTML = ""; gridModal.style.display = "flex"; fillBrushGrid(); }
  async function fillBrushGrid(){ try{ const r=await fetch(`/orion4d_maskpro/list_brushes?ts=${Date.now()}`,{cache:"no-store"}); const j=r.ok?await r.json():{files:[]}; const files=j.files||[]; gridWrap.innerHTML=""; files.forEach(f=>{ const card=document.createElement("button"); card.className="btn"; card.style.cssText="padding:6px;display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;background:#1a1f26;border-color:#232a34"; const img=new Image(); img.src=`${BRUSH_BASE}${encodeURIComponent(f)}?ts=${Date.now()}`; img.width=96; img.height=96; img.style.objectFit="contain"; img.style.background="#ffffff"; img.loading="lazy"; const cap=document.createElement("div"); cap.textContent=f; cap.style.maxWidth="110px"; cap.style.whiteSpace="nowrap"; cap.style.overflow="hidden"; cap.style.textOverflow="ellipsis"; cap.className="muted"; card.appendChild(img); card.appendChild(cap); card.addEventListener("click", async()=>{ customName.value=f; gridModal.style.display="none"; try{ await loadCustomBrushByName(f); shapeCustom.checked=true; customRow.style.display=customRow2.style.display=customRow3.style.display=customRowPicker.style.display="flex"; forceTool("brush"); } catch{ statusEl.textContent="Failed to load brush."; } }); gridWrap.appendChild(card); }); }catch{} }
  openBrushGrid?.addEventListener("click", openBrushPicker); gridRefresh?.addEventListener("click", fillBrushGrid); gridClose?.addEventListener("click", ()=> gridModal.style.display="none"); gridModal?.addEventListener("click",(e)=>{ if(e.target===gridModal) gridModal.style.display="none"; });
  (function(){ const panel=$('globalTools'); function setToolboxUI(on){ toolboxBtn.classList.toggle('on',!!on); if(panel){ panel.open=!!on; } } setToolboxUI(panel?.open!==false); toolboxBtn.addEventListener("click", ()=> setToolboxUI(!(panel?.open))); window.addEventListener("keydown",(e)=>{ if(e.key.toLowerCase()==='t' && e.target.tagName!=="INPUT"){ setToolboxUI(!(panel?.open)); }}); })();

  function onMove(e){
    const [ix,iy]=screenToImage(e.clientX,e.clientY);
    let insideSel = hasActiveSelection && currentSelection[Math.floor(iy)*W+Math.floor(ix)] > 128;
    
    if (panning) {
      center.scrollLeft=panStart.sl-(e.clientX-panStart.x);
      center.scrollTop=panStart.st-(e.clientY-panStart.y);
      return;
    }

    if ((qHeld && insideSel) || (e.buttons === 2 && insideSel && !tool)) canOv.style.cursor="move";
    else if(hHeld || tool === "hand") canOv.style.cursor="grab";
    else if(tool==="zoom") canOv.style.cursor=altHeld?"zoom-out":"zoom-in";
    else if(tool) canOv.style.cursor="crosshair";
    else canOv.style.cursor="default";

    cursorX=ix; cursorY=iy;
    if(movingSelection){
      const dx=Math.round(ix-moveSelStart.x), dy=Math.round(iy-moveSelStart.y);
      if(dx===0 && dy===0) return;
      const temp=new Uint8ClampedArray(W*H);
      for(let y=0; y<H; y++){ for(let x=0; x<W; x++){
        const nx=x-dx, ny=y-dy;
        if(nx>=0&&nx<W&&ny>=0&&ny<H) temp[y*W+x]=currentSelection[ny*W+nx];
      }}
      currentSelection.set(temp);
      moveSelStart={x:ix,y:iy};
      updateSelectionEdges();
    }
    else if(tool==="brush"&&drawing){brushMove(clamp(ix,0,W-1),clamp(iy,0,H-1));}
    else if(tool==="lasso"&&drawing){ const last=lassoPts.at(-1); const lx=clamp(ix,0,W-1), ly=clamp(iy,0,H-1); if(!last||Math.hypot(lx-last.x,ly-last.y)>1.2) lassoPts.push({x:lx,y:ly});}
    else if(tool==="poly"&&polyActive){curX=ix;curY=iy;}
    else if((tool==="ellipse"||tool==="rect"||tool==="grad")&&drawing){curX=ix;curY=iy;}
    
    requestAnimationFrame(refreshOverlay);
  }
  function startPointer(e){
    if (panning || movingSelection || drawing) return;
    if(e.button===1)return;

    const [ix,iy]=screenToImage(e.clientX,e.clientY);
    let insideSel = hasActiveSelection && currentSelection[Math.floor(iy)*W+Math.floor(ix)] > 128;
    
    if (hHeld || tool === "hand") {
      panning=true; canOv.style.cursor="grabbing"; panStart={x:e.clientX,y:e.clientY,sl:center.scrollLeft,st:center.scrollTop};
    } else if(e.button===2){
      e.preventDefault();
      if(tool==="poly"&&polyActive&&polyPts.length>=2){
        let sel=rasterPolygon(polyPts);
        const sig=parseFloat(qs("#polyFeather").value)||0; if(sig>0) blurBufferInPlace(sel,W,H,sig);
        if(polyAutofill.checked){ pushHistory(); applySelection(sel,1.0,ERASE); } else { combineSelection(sel); }
        polyPts.length=0; polyActive=false;
      } else if (insideSel) {
        movingSelection = true;
        moveSelStart = {x:ix, y:iy};
      }
    } else if(e.button === 0){
      if(qHeld && insideSel){
        movingSelection = true;
        moveSelStart = {x:ix, y:iy};
      } else if(hasActiveSelection && !shiftHeld && !insideSel) {
        clearSelectionBtn.click();
      } else if(tool==="zoom"){
        const rect = center.getBoundingClientRect();
        const centerPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top, scrollX: center.scrollLeft, scrollY: center.scrollTop };
        const newZoom = zoom * (altHeld ? 0.8 : 1.25);
        applyZoom(newZoom, centerPoint);
      } else if(tool){
        cursorX=ix;cursorY=iy;
        if(tool==="brush"){pushHistory();drawing=true;strokeBuffer=new Uint8ClampedArray(W*H);lastX=null;lastY=null;brushMove(clamp(ix,0,W-1),clamp(iy,0,H-1));}
        else if(tool==="lasso"){drawing=true;lassoPts.length=0;lassoPts.push({x:clamp(ix,0,W-1),y:clamp(iy,0,H-1)});refreshOverlay();}
        else if(tool==="poly"){ if(!polyActive){polyActive=true;polyPts.length=0;} polyPts.push({x:ix,y:iy}); curX=ix;curY=iy;refreshOverlay();}
        else if(tool==="ellipse"||tool==="rect"||tool==="grad"){drawing=true;startX=curX=ix;startY=curY=iy;refreshOverlay();}
        else if(tool==="wand"){ pushHistory(); handleWandClick(ix,iy); }
      }
    }
    trackingMove=true; window.addEventListener("pointermove",onMove,{passive:false});
  }
  function combineSelection(newSel){
    if(!shiftHeld){
      currentSelection.fill(0);
    }
    if((shiftHeld && ERASE) || (shiftHeld && ctrlHeld)) { // Subtract
      for(let i=0; i<currentSelection.length; i++) currentSelection[i] = clamp(currentSelection[i] - newSel[i], 0, 255);
    } else { // Add or new
      for(let i=0; i<currentSelection.length; i++) currentSelection[i] = clamp(currentSelection[i] + newSel[i], 0, 255);
    }
    updateSelectionEdges();
  }
  window.addEventListener("pointerup",(e)=>{
    if(tool==="brush" && drawing && strokeBuffer){
      for(let i=0; i < alphaBuf.length; i++){
        if (strokeBuffer[i] > 0) {
            const strokeAlpha = strokeBuffer[i] / STROKE_MAX_OPACITY;
            if (ERASE) {
                alphaBuf[i] = clamp(alphaBuf[i] * (1 - strokeAlpha), 0, 255);
            } else {
                alphaBuf[i] = clamp(alphaBuf[i] + strokeAlpha * (255 - alphaBuf[i]), 0, 255);
            }
        }
      } strokeBuffer = null;
    }
    if(panning){panning=false;onMove(e);}
    if(movingSelection){movingSelection=false;}
    if(!drawing) {
      if(trackingMove){trackingMove=false; window.removeEventListener("pointermove",onMove,{passive:false});}
      return;
    }
    drawing=false;
    let sel;
    if(tool==="lasso"&&lassoPts.length>=3){
      sel=rasterPolygon(lassoPts);
      const sig=parseFloat(qs("#lassoFeather").value)||0; if(sig>0) blurBufferInPlace(sel,W,H,sig);
      if(lassoAutofill.checked){ pushHistory(); applySelection(sel,1.0,ERASE); } else { combineSelection(sel); }
      lassoPts.length=0;
    } else if(tool==="ellipse"||tool==="rect"){
      let x,y,w,h; const isRect=tool==="rect";
      const useCenter=altHeld||(isRect?rectCenter.checked:ellCenter.checked);
      if(useCenter){w=Math.abs(curX-startX)*2;h=Math.abs(curY-startY)*2;x=startX-w/2;y=startY-h/2;}
      else{x=Math.min(startX,curX);y=Math.min(startY,curY);w=Math.abs(curX-startX);h=Math.abs(curY-startY);}
      if(ctrlHeld){const m=Math.max(w,h);w=h=m;if(useCenter){x=startX-m/2;y=startY-m/2;}else{if(curX<startX)x=startX-m;if(curY<startY)y=startY-m;}}
      sel=isRect?rasterRectAdvanced(startX,startY,curX,curY,useCenter,ctrlHeld,parseInt(qs("#rectRadius").value,10)||0):rasterEllipseRect("ellipse",x,y,w,h);
      const featherEl=isRect?qs("#rectFeather"):qs("#ellFeather"); const autofillEl=isRect?rectAutofill:ellAutofill;
      const sig=parseFloat(featherEl.value)||0; if(sig>0) blurBufferInPlace(sel,W,H,sig);
      if(autofillEl.checked){ pushHistory(); applySelection(sel,1.0,ERASE); } else { combineSelection(sel); }
    } else if(tool==="grad"){
      pushHistory();
      sel=gradRadial.checked?rasterGradientRadial(startX,startY,curX,curY):rasterGradientLinear(startX,startY,curX,curY);
      const opa=(parseInt(qs("#gradOpacity").value,10)||100)/100; applySelection(sel,opa,ERASE);
    }
    polyActive=false; refreshOverlay();
    if(trackingMove){trackingMove=false; window.removeEventListener("pointermove",onMove,{passive:false});}
  });
  center.addEventListener("pointerdown",startPointer);
  center.addEventListener("pointermove", onMove, {passive:false});
  [center,canOv].forEach(el=>el.addEventListener("contextmenu",e=>e.preventDefault()));

  function getImageRGBA(){ return ctxI.getImageData(0,0,W,H); }
  function floodFrom(x0,y0,tol,avgK){
    const src=getImageRGBA(), d=src.data;
    function sampleAvg(x,y,k){ let r=0,g=0,b=0,c=0, r0=x-(k>>1), c0=y-(k>>1); for(let j=0;j<k;j++){ const yy=clamp(c0+j,0,H-1); for(let i=0;i<k;i++){ const xx=clamp(r0+i,0,W-1); const p=(yy*W+xx)*4; r+=d[p]; g+=d[p+1]; b+=d[p+2]; c++; } } return [r/c,g/c,b/c]; }
    const [sr,sg,sb]=sampleAvg(x0|0,y0|0,avgK);
    const seen=new Uint8Array(W*H), out=new Uint8ClampedArray(W*H), q=[x0|0,y0|0];
    while(q.length){ const y=q.pop(), x=q.pop(); if(x<0||y<0||x>=W||y>=H) continue; const idx=y*W+x; if(seen[idx]) continue; seen[idx]=1; const p=idx*4; const r=d[p], g=d[p+1], b=d[p+2]; const dist=Math.abs(r-sr)+Math.abs(g-sg)+Math.abs(b-sb); if(dist<=tol){ out[idx]=255; q.push(x+1,y,x-1,y,x,y+1,x,y-1); } }
    const s=parseFloat(qs("#wandSmooth").value)||0; if(s>0) blurBufferInPlace(out,W,H,s);
    return out;
  }
  function handleWandClick(ix,iy){ const tol=parseInt(qs("#wandTol").value,10)||0, k=parseInt(qs("#wandAvg").value,10)||3; const sel=floodFrom(ix,iy,tol,k); applySelection(sel,1.0,wandSub.checked); refreshOverlay(); }

  window.addEventListener("keydown",(e)=>{
    if (e.repeat) return;
    ctrlHeld=e.ctrlKey; altHeld=e.altKey; shiftHeld=e.shiftKey;
    const k=e.key.toLowerCase();
    if(k==="q") qHeld=true;
    if(k==="h"){ 
      if (!hHeld) {
        hHeld = true;
        toolBeforePan = tool;
        forceTool('hand');
      }
      e.preventDefault(); 
    }
    if(tool==="zoom" && altHeld) canOv.style.cursor="zoom-out";
    if(e.target.tagName==="INPUT"||e.target.tagName==="SELECT")return;
    if(ctrlHeld&&(k==="z")){e.preventDefault();undo();return;}
    if(ctrlHeld&&(k==="y"||(shiftHeld&&k==="z"))){e.preventDefault();redo();return;}
    if(e.key==="Escape"){ clearSelectionBtn.click(); if(tool==="poly"&&polyActive){ polyPts.length=0; polyActive=false; refreshOverlay(); } return; }
    if(k==="a"){fillSelectionBtn.click();}
    if("blkesgwhz".includes(k) && !hHeld){ e.preventDefault(); setTool({b:'brush',l:'lasso',k:'poly',e:'ellipse',s:'rect',g:'grad',w:'wand',h:'hand',z:'zoom'}[k]); }
    if(k==="m"){maskOnlyEl.checked=!maskOnlyEl.checked; refreshOverlay();}
    if(k==="x"){toggleErase();}
    if(k==="c"){pushHistory(); alphaBuf.fill(0); refreshOverlay();}
    if(k==="i"){pushHistory(); for(let i=0;i<alphaBuf.length;i++) alphaBuf[i]=255-alphaBuf[i]; refreshOverlay();}
  });
  window.addEventListener("keyup",(e)=>{
    ctrlHeld=e.ctrlKey; altHeld=e.altKey; shiftHeld=e.shiftKey;
    if(e.key.toLowerCase()==="q") qHeld=false;
    if(e.key.toLowerCase()==="h"){
      hHeld = false;
      if (toolBeforePan !== null) {
        forceTool(toolBeforePan);
        toolBeforePan = null;
      }
      onMove(e);
    }
    if(tool==="zoom" && !altHeld) canOv.style.cursor="zoom-in";
  });

  zoomEl.addEventListener("input",()=>applyZoom(parseInt(zoomEl.value,10)/100));
  maskOnlyEl.addEventListener("change",refreshOverlay);
  clearBtn.addEventListener("click",()=>{pushHistory(); alphaBuf.fill(0); refreshOverlay();});
  clearSelectionBtn.addEventListener("click",()=>{ if(currentSelection) currentSelection.fill(0); updateSelectionEdges(); refreshOverlay(); });
  fillSelectionBtn.addEventListener("click", () => { if(!hasActiveSelection) return; pushHistory(); applySelection(currentSelection, 1.0, ERASE); refreshOverlay(); });
  invertBtn.addEventListener("click",()=>{pushHistory(); for(let i=0;i<alphaBuf.length;i++) alphaBuf[i]=255-alphaBuf[i]; refreshOverlay();});
  
  function morphology(buf,w,h,rad,isDilate){
    const r=Math.max(1,rad|0); const out=new Uint8ClampedArray(buf.length);
    for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ let best=isDilate?0:255;
      for(let dy=-r;dy<=r;dy++){ const yy=y+dy; if(yy<0||yy>=h) continue; const span=Math.floor(Math.sqrt(r*r-dy*dy));
        for(let dx=-span;dx<=span;dx++){ const xx=x+dx; if(xx<0||xx>=w) continue; const v=buf[yy*w+xx]; if(isDilate){ if(v>best) best=v; } else { if(v<best) best=v; } } }
      out[y*w+x]=best; } }
    buf.set(out);
  }
  applyBlurBtn.addEventListener("click",()=>{const s=parseFloat(qs("#blurSigma").value)||0; if(s>0){pushHistory(); blurBufferInPlace(alphaBuf,W,H,s); refreshOverlay();}});
  applySmoothBtn.addEventListener("click",()=>{ const r=parseInt(qs("#smoothSigma").value,10)||1; pushHistory(); morphology(alphaBuf,W,H,r,false); morphology(alphaBuf,W,H,r,true); morphology(alphaBuf,W,H,r,true); morphology(alphaBuf,W,H,r,false); refreshOverlay(); });
  applyDilateBtn.addEventListener("click",()=>{const r=parseInt(qs("#dilateRadius").value,10)||1; pushHistory(); morphology(alphaBuf,W,H,r,true); refreshOverlay();});
  applyErodeBtn.addEventListener("click",()=>{const r=parseInt(qs("#erodeRadius").value,10)||1; pushHistory(); morphology(alphaBuf,W,H,r,false);refreshOverlay();});
  applyImgThresholdBtn.addEventListener("click",()=>{ pushHistory(); const d=ctxI.getImageData(0,0,W,H).data; const t=parseInt(qs("#imgThreshold").value,10); for(let i=0, j=0; i<d.length; i+=4, j++) alphaBuf[j]=(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)>t?255:0; refreshOverlay(); });
  applyMaskThresholdBtn.addEventListener("click",()=>{ pushHistory(); const t=parseInt(qs("#maskThreshold").value, 10); for(let i=0; i<alphaBuf.length; i++) alphaBuf[i]=alphaBuf[i]>t?255:0; refreshOverlay(); });

  aiCutBtn?.addEventListener("click", async ()=>{ try{ statusEl.textContent = "AI cutout…"; const r = await fetch(`/orion4d_maskpro/rembg?node_id=${encodeURIComponent(nodeId)}`, { method:"POST" }); if(!r.ok) throw new Error(`HTTP ${r.status}`); const { ok } = await r.json(); if(!ok) throw new Error("rembg failed"); const mURL = await toBlobURL(`/orion4d_maskpro/static/maskpro_${nodeId}/mask.png?ts=${Date.now()}`); const m=new Image(); m.crossOrigin="anonymous"; await new Promise((res)=>{ m.onload=res; m.onerror=res; m.src=mURL; }); const t=document.createElement("canvas"); t.width=W; t.height=H; const tc=t.getContext("2d",{willReadFrequently:true}); tc.drawImage(m,0,0,W,H); const d=tc.getImageData(0,0,W,H).data; pushHistory(); for(let i=0,j=0;i<d.length;i+=4,j++) alphaBuf[j]=d[i]; refreshOverlay(); statusEl.textContent="AI cutout done."; }catch(err){ statusEl.textContent = String(err?.message||err); } });
  exportBtn.addEventListener("click",()=>{ const out=document.createElement("canvas"); out.width=W; out.height=H; const o=out.getContext("2d"); const id=o.createImageData(W,H), d=id.data; for(let i=0,p=0;i<W*H;i++,p+=4){const g=alphaBuf[i]||0; d[p]=g; d[p+1]=g; d[p+2]=g; d[p+3]=255;} o.putImageData(id,0,0); out.toBlob(b=>{const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="mask.png"; a.click(); URL.revokeObjectURL(a.href);},"image/png"); });
  saveBtn.addEventListener("click", async ()=>{ try{ const out=document.createElement("canvas"); out.width=W; out.height=H; const o=out.getContext("2d"); const id=o.createImageData(W,H), d=id.data; for(let i=0,p=0;i<W*H;i++,p+=4){d[p]=0; d[p+1]=0; d[p+2]=0; d[p+3]=alphaBuf[i]||0;} o.putImageData(id,0,0); const maskBlob=await new Promise((res,rej)=> out.toBlob(b=>b?res(b):rej(new Error("toBlob failed")),"image/png")); const fd=new FormData(); fd.append("node_id",String(nodeId)); fd.append("mask",maskBlob,"mask.png"); const r=await fetch("/orion4d_maskpro/save",{method:"POST",body:fd}); if(!r.ok) throw new Error(`Save failed: HTTP ${r.status}`); window.opener?.postMessage({type:"maskpro:saved",nodeId},location.origin); window.close(); }catch(err){ statusEl.textContent=String(err?.message||err); } });

  (async function init(){
    try{
      await listBrushes();
      const metaRes=await fetch(`/orion4d_maskpro/open?node_id=${encodeURIComponent(nodeId)}`,{cache:"no-store"});
      if(!metaRes.ok){ statusEl.textContent="API open failed."; return; }
      const meta=await metaRes.json();
      if(!meta.image_exists){ statusEl.textContent="image.png missing. Use “Edit Mask” from the node."; return; }

      const imgURL=await toBlobURL(`/orion4d_maskpro/static/maskpro_${nodeId}/image.png?ts=${Date.now()}`);
      const img=new Image(); img.crossOrigin="anonymous";
      await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=imgURL; });
      originalBackgroundImage = img;
      const w=meta.w||img.naturalWidth||img.width, h=meta.h||img.naturalHeight||img.height;
      setSize(w,h); drawBackground(originalBackgroundImage);
      alphaBuf=new Uint8ClampedArray(W*H); currentSelection=new Uint8ClampedArray(W*H); selectionEdges=new Uint8ClampedArray(W*H);

      if(meta.mask_exists){
        const mURL=await toBlobURL(`/orion4d_maskpro/static/maskpro_${nodeId}/mask.png?ts=${Date.now()}`);
        const m=new Image(); m.crossOrigin="anonymous";
        await new Promise((res)=>{ m.onload=res; m.onerror=res; m.src=mURL; });
        const t=document.createElement("canvas"); t.width=W; t.height=H; const tc=t.getContext("2d",{willReadFrequently:true});
        const mw=m.naturalWidth||m.width, mh=m.naturalHeight||m.height; const dx=Math.floor((W-mw)/2), dy=Math.floor((H-mh)/2); tc.drawImage(m,dx,dy);
        const d=tc.getImageData(0,0,W,H).data; let alphaSignal=false; for(let i=3;i<d.length;i+=4) if(d[i]!==255){alphaSignal=true;break;}
        if(alphaSignal) for(let i=0,j=0;i<d.length;i+=4,j++) alphaBuf[j]=d[i+3];
        else { let whites=0,blacks=0; for(let i=0;i<d.length;i+=4){const g=(d[i]+d[i+1]+d[i+2])/3; if(g>200) whites++; else if(g<55) blacks++;} const inv=whites>blacks*2; for(let i=0,j=0;i<d.length;i+=4,j++){const g=(d[i]+d[i+1]+d[i+2])/3; alphaBuf[j]=inv?(255-g):g;} }
      }

      setTool("brush"); setEraseUI();
      qsa(".setting-group").forEach(group => {
        const range = group.querySelector("input[type=range]");
        const number = group.querySelector("input[type=number]");
        if (range && number) {
          range.addEventListener("input", () => number.value = range.value);
          number.addEventListener("change", () => range.value = number.value);
        }
      });
      const spacingRange = qs("#brushSpacing");
      const spacingVal = qs("#brushSpacingVal");
      if(spacingRange && spacingVal) {
        spacingRange.addEventListener("input", () => spacingVal.value = spacingRange.value);
        spacingVal.addEventListener("change", () => spacingRange.value = spacingVal.value);
      }
      customRot.addEventListener("input", () => qs("#customRotVal").textContent = `${customRot.value}°`);
      qs("#customRotVal").textContent = `${customRot.value}°`;
      
      fitToViewport(); refreshOverlay();
    }catch(e){ statusEl.textContent=String(e?.message||e); }
  })();

})();