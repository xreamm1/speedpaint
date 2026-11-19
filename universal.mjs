import {stroke} from './paint.mjs?v=universal';
import {whiteRibbons,ribbonGround} from './geometry.mjs?v=ribbon';

function build(bitmap, {brush,detail,quality,focus,geometry}, report) {
  const {width:w,height:h}=bitmap;
  const g=new OffscreenCanvas(w,h).getContext('2d',{willReadFrequently:true,alpha:false});
  g.fillStyle='white';g.fillRect(0,0,w,h);g.drawImage(bitmap,0,0,w,h);
  bitmap.close();
  const src=g.getImageData(0,0,w,h).data;
  const idx=(x,y)=>4*(Math.max(0,Math.min(h-1,Math.floor(y)))*w+Math.max(0,Math.min(w-1,Math.floor(x))));
  const delta=(a,i,b,j)=>Math.abs(a[i]-b[j])+Math.abs(a[i+1]-b[j+1])+Math.abs(a[i+2]-b[j+2]);
  const mean=[0,0,0];for(let i=0;i<src.length;i+=4)for(let c=0;c<3;c++)mean[c]+=src[i+c];
  const color='rgb('+mean.map(v=>Math.round(v/(w*h))).join(',')+')';
  const stages=[[{fill:color,points:[[0,0],[w,0]],width:0,opacity:1}],[],[],[]];
  stroke(g,stages[0][0]);
  const grad=new Float32Array(w*h*2),weight=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let xx=0,yy=0,xy=0;
    const l=idx(x-1,y),r=idx(x+1,y),t=idx(x,y-1),b=idx(x,y+1);
    for(let c=0;c<3;c++){const dx=src[r+c]-src[l+c],dy=src[b+c]-src[t+c];xx+=dx*dx;yy+=dy*dy;xy+=dx*dy}
    const p=y*w+x;grad[2*p]=xx-yy;grad[2*p+1]=2*xy;
    weight[p]=1+Math.min(5,Math.floor(Math.sqrt(xx+yy)/35))
  }
  function direction(x,y,s){
    let u=0,v=0;
    for(const [dx,dy] of [[0,0],[-s,0],[s,0],[0,-s],[0,s]]){
      const k=idx(x+dx,y+dy)/2;u+=grad[k];v+=grad[k+1]
    }
    return Math.abs(u)+Math.abs(v)<1?0:0.5*Math.atan2(v,u)+Math.PI/2
  }
  const radii=[28,15,8,4,2];
  for(const [pass,baseRadius] of radii.entries()){
    const radius=Math.max(1,Math.round(baseRadius*brush/100*Math.max(.5,Math.max(w,h)/960)));
    const ops=stages[[0,1,1,2,3][pass]];
    const before=g.getImageData(0,0,w,h).data, cells=[];
    const step=Math.max(3,Math.round(radius*1.65));
    for(let y=0,row=0;y<h;y+=step,row++){
      const band=[];
      for(let x=0;x<w;x+=step){
        let top=0,best;
        for(let py=y;py<Math.min(y+step,h);py+=Math.max(1,radius>>2))
          for(let px=x;px<Math.min(x+step,w);px+=Math.max(1,radius>>2)){
            const i=idx(px,py),err=delta(src,i,before,i)*Math.sqrt(weight[i/4]);
            if(err>top){top=err;best=[px+.5,py+.5]}
          }
        if(top>12+radius){
          const attention=focus ? Math.max(0,1-Math.hypot(best[0]/w-focus[0],best[1]/h-focus[1])*4)*.45 : 0;
          band.push({best,top:top*(1+attention)});
        }
      }
      cells.push(...(row%2?band.reverse():band))
    }
    // Отдать ограниченный бюджет сильным ошибкам, сохранив локальный порядок.
    const limit=Math.round((pass>=3?4200:2400)*(.65+detail/185)*(quality?1.25:1));
    const cut=cells.length>limit?cells.map(c=>c.top).sort((a,b)=>b-a)[limit-1]:0;
    let tried=0;
    for(const cell of cells){
      if(cell.top<cut||tried>=limit)continue;
      if(++tried%96===1) report(`Кисть ${2*radius} px · проверено ${tried} из ${Math.min(limit,cells.length)}`, 8+pass*17+tried/Math.min(limit,cells.length)*16);
      const [cx,cy]=cell.best,anchor=idx(cx,cy),angle=direction(cx,cy,Math.max(1,radius/3));
      let rad=radius;
      for(let d=1;d<=radius;d++)if([-1,1].some(sign=>delta(src,anchor,src,idx(cx-sign*d*Math.sin(angle),cy+sign*d*Math.cos(angle)))>72)){
        rad=Math.max(.6,d-.5);break
      }
      function arm(sign){
        const points=[];let x=cx,y=cy,dx=sign*Math.cos(angle),dy=sign*Math.sin(angle);
        const stride=Math.max(.8,rad*.7);
        for(let j=0;j<8;j++){
          const a=direction(x,y,Math.max(1,rad/3));let ux=Math.cos(a),uy=Math.sin(a);
          if(dx*ux+dy*uy<0){ux=-ux;uy=-uy}
          if(dx*ux+dy*uy<.55)break;
          const nx=x+stride*ux,ny=y+stride*uy;
          if(nx<0||ny<0||nx>=w||ny>=h||delta(src,anchor,src,idx(nx,ny))>58||
             delta(src,anchor,src,idx((nx+x)/2,(ny+y)/2))>58)break;
          points.push([nx,ny]);x=nx;y=ny;dx=ux;dy=uy
        }return points
      }
      const points=[...arm(-1).reverse(),[cx,cy],...arm(1)];
      if(points.length===1)points.push([cx+.15,cy]);
      const op={points,width:2*rad,color:'rgb('+src.subarray(anchor,anchor+3).join(',')+')',opacity:1};
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      const x=Math.max(0,Math.floor(Math.min(...xs)-rad-1)),y=Math.max(0,Math.floor(Math.min(...ys)-rad-1));
      const bw=Math.min(w,Math.ceil(Math.max(...xs)+rad+1))-x,bh=Math.min(h,Math.ceil(Math.max(...ys)+rad+1))-y;
      const old=g.getImageData(x,y,bw,bh);stroke(g,op);const fresh=g.getImageData(x,y,bw,bh).data;
      let gain=0;for(let j=0;j<bh;j++)for(let k=0;k<bw;k++){
        const i=4*(j*bw+k),p=4*((y+j)*w+x+k);
        gain+=weight[p/4]*(delta(src,p,old.data,i)-delta(src,p,fresh,i))
      }
      if(gain>18)ops.push(op);else g.putImageData(old,x,y)
    }
  }
  if (geometry) {
    report('Уточняю белые ленты по форме',98);
    const source={width:w,height:h,data:src};
    const ribbons=whiteRibbons(source);
    for (const ribbon of ribbons.filter(mark=>mark.points.length>49).slice(0,8)) {
      const ground=ribbonGround(source,ribbon);
      if (ground) stages[3].push(ground);
    }
    stages[3].push(...ribbons);
  }
  return stages;
}
self.onmessage = ({data:{bitmap,...settings}}) => {
  const report = (label,value) => self.postMessage({label,value});
  try {
    self.postMessage({stages:build(bitmap,settings,report)});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
