import {prepareHand,paperSurface} from './hand.mjs';
import {smoothMask,stroke} from './paint.mjs?v=form-strokes';
import {fineInk} from './ink-outline.mjs';

function compose(bitmap,report) {
  const {width:w,height:h}=bitmap;
  const surface=new OffscreenCanvas(w,h);
  const ctx=surface.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bitmap,0,0);
  bitmap.close();
  const photo=ctx.getImageData(0,0,w,h).data;
  const pixel=(x,y)=>Math.min(h-1,Math.max(0,Math.floor(y)))*w+Math.min(w-1,Math.max(0,Math.floor(x)));
  const unit=Math.max(.35,Math.sqrt(w*h)/570);
  const stages=[[],[],[]];
  const rgb=(data,i)=>[data[4*i],data[4*i+1],data[4*i+2]];
  const css=color=>'rgb('+color.map(Math.round).join(',')+')';
  const tone=(data,i)=>(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114);
  let flatPairs=0,totalPairs=0;
  const probe=Math.max(1,Math.round(Math.min(w,h)/320));
  for(let y=probe;y<h;y+=probe)for(let x=probe;x<w;x+=probe){
    const i=4*pixel(x,y),left=4*pixel(x-probe,y),above=4*pixel(x,y-probe);
    let variation=0;
    for(let c=0;c<3;c++)variation+=Math.abs(photo[i+c]-photo[left+c])+Math.abs(photo[i+c]-photo[above+c]);
    if(variation<6)flatPairs++;
    totalPairs++;
  }
  const photographic=totalPairs>0 && flatPairs/totalPairs<.41;
  const pitch=Math.max(3,6*unit);
  const cols=Math.max(2,Math.ceil(w/pitch)),rows=Math.max(2,Math.ceil(h/pitch));
  const thumb=new OffscreenCanvas(cols,rows).getContext('2d',{willReadFrequently:true});
  thumb.imageSmoothingQuality='high';
  thumb.drawImage(surface,0,0,cols,rows);
  const small=thumb.getImageData(0,0,cols,rows).data;
  const rawValues=Array.from({length:cols*rows},(_,i)=>tone(small,i));
  // Trace broad changes of plane; individual pixels are too noisy for a pencil guide.
  const values=rawValues.map((_,i)=>{
    const x=i%cols,y=Math.floor(i/cols);
    let sum=0;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const xx=Math.max(0,Math.min(cols-1,x+dx)),yy=Math.max(0,Math.min(rows-1,y+dy));
      sum+=rawValues[yy*cols+xx]*[1,4,6,4,1][dx+2]*[1,4,6,4,1][dy+2];
    }
    return sum/256;
  });
  let anchor=[w*.5,h*.45],best=0;
  for(let y=1;y<rows-1;y++) for(let x=1;x<cols-1;x++){
    const i=y*cols+x;
    const contrast=Math.abs(values[i-1]-values[i+1])+Math.abs(values[i-cols]-values[i+cols]);
    const score=contrast/(1+4*Math.hypot(x/cols-.5,y/rows-.42));
    if(score>best){best=score;anchor=[(x+.5)*w/cols,(y+.5)*h/rows];}
  }
  report('Нахожу линии крупных форм',8);
  const lines=[];
  // Trace only ridges in edge strength. Equal brightness inside a cheek
  // is not evidence of a pencil contour.
  function traceEdges(values,cols,rows,fine){
  const gx=new Float32Array(values.length),gy=new Float32Array(values.length),mag=new Float32Array(values.length);
  for(let y=1;y<rows-1;y++)for(let x=1;x<cols-1;x++){
    const i=y*cols+x;
    gx[i]=values[i+1]-values[i-1];gy[i]=values[i+cols]-values[i-cols];
    mag[i]=Math.hypot(gx[i],gy[i]);
  }
  const ridge=new Uint8Array(values.length),seeds=[];
  for(let y=1;y<rows-1;y++)for(let x=1;x<cols-1;x++){
    const i=y*cols+x,m=mag[i];
    if(m<(fine?(photographic?38:22):(photographic?13:8)))continue;
    const across=Math.round(gx[i]/m)+cols*Math.round(gy[i]/m);
    if(m>=mag[i-across] && m>=mag[i+across]){ridge[i]=1;seeds.push(i);}
  }
  function follow(start,sign){
    let i=start,dx=-sign*gy[i]/mag[i],dy=sign*gx[i]/mag[i];const path=[];
    while(path.length<38){
      let next=-1,best=0;
      const x=i%cols,y=Math.floor(i/cols);
      for(let v=-2;v<=2;v++)for(let u=-2;u<=2;u++){
        if(x+u<1||x+u>=cols-1||y+v<1||y+v>=rows-1)continue;
        const j=i+u+v*cols,d=Math.hypot(u,v);
        if(!ridge[j]||d>2.3||!d)continue;
        const alignment=(dx*u+dy*v)/d;
        const normal=(gx[j]*gx[i]+gy[j]*gy[i])/(mag[j]*mag[i]);
        if(alignment<.55 || normal<.65)continue;
        const score=alignment*normal/d;
        if(score>best){best=score;next=j;}
      }
      if(next<0)break;
      const tx=-gy[next]/mag[next],ty=gx[next]/mag[next],dir=tx*dx+ty*dy>=0?1:-1;
      dx=tx*dir;dy=ty*dir;i=next;ridge[i]=0;path.push(i);
    }
    return path;
  }
  for(const seed of seeds.sort((a,b)=>mag[b]-mag[a])){
    if(!ridge[seed])continue;
    ridge[seed]=0;
    const cells=[...follow(seed,-1).reverse(),seed,...follow(seed,1)];
    if(cells.length<(fine?6:5))continue;
    const points=cells.filter((_,i)=>i%3===0||i===cells.length-1).map(i=>[(i%cols+.5)*w/cols,(Math.floor(i/cols)+.5)*h/rows]);
    const [x,y]=points[points.length>>1];
    lines.push({points,fine,width:Math.max(.8,unit*(fine?.9:1.35)),color:'#514441',opacity:.5,
      priority:Math.sqrt(cells.length)*mag[seed]/(12+8*Math.hypot(x/w-.5,y/h-.4))});
  }
  }
  traceEdges(values,cols,rows,false);
  const fineCols=Math.max(2,Math.ceil(w/(pitch*.38))),fineRows=Math.max(2,Math.ceil(h/(pitch*.38)));
  const fineCtx=new OffscreenCanvas(fineCols,fineRows).getContext('2d');
  fineCtx.drawImage(surface,0,0,fineCols,fineRows);
  const finePixels=fineCtx.getImageData(0,0,fineCols,fineRows).data;
  traceEdges(Array.from({length:fineCols*fineRows},(_,i)=>tone(finePixels,i)),fineCols,fineRows,true);
  let serial=1;
  function deposit(stage,mark){
    if(stage===2){
      const [x,y]=mark.points[0], [lastX,lastY]=mark.points.at(-1);
      const span=Math.hypot(lastX-x,lastY-y);
      let length=0;
      for(let i=1;i<mark.points.length;i++){
        const a=mark.points[i-1],b=mark.points[i];
        length+=Math.hypot(b[0]-a[0],b[1]-a[1]);
      }
      // Reject compact footprints and paths that fold back on themselves.
      if(span<Math.max(4*unit,mark.width*2.4,length*.58))return;
      mark.width=Math.min(mark.width,span*.24);
      mark.fineBrush=true;
    }
    if(!mark.erase)prepareHand(mark,serial++);
    stages[stage].push(mark);
    if(stage>0)stroke(ctx,mark);
  }
  // Merge adjacent thumbnail cells across weak colour boundaries. This gives
  // actual closed flats (including holes), independent of the subject type.
  const count=values.length;
  const parent=Int32Array.from({length:count},(_,i)=>i),size=new Int32Array(count).fill(1);
  const variation=new Float32Array(count), edges=[];
  function root(i){
    while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}
    return i;
  }
  function join(a,b,cost){
    if(size[a]<size[b])[a,b]=[b,a];
    parent[b]=a;size[a]+=size[b];variation[a]=Math.max(cost,variation[a],variation[b]);
  }
  for(let i=0;i<count;i++){
    for(const j of [i%cols?i-1:-1,i-cols]){
      if(j<0)continue;
      edges.push({i,j,cost:Math.hypot(...[0,1,2].map(k=>small[4*i+k]-small[4*j+k]))});
    }
  }
  edges.sort((a,b)=>a.cost-b.cost);
  for(const {i,j,cost} of edges){
    const a=root(i),b=root(j);
    if(a!==b && cost<=Math.min(variation[a]+170/size[a],variation[b]+170/size[b]))join(a,b,cost);
  }
  const minSize=Math.max(2,Math.round(count/950));
  for(const {i,j,cost} of edges){
    const a=root(i),b=root(j);
    if(a!==b && (Math.min(size[a],size[b])<2 || Math.min(size[a],size[b])<minSize&&cost<66))join(a,b,cost);
  }
  // Snap boundaries back to photographic edges before constructing any paint
  // masks. Coarse thumbnail cells are for analysis, never for visible outlines.
  const edgeCols=Math.max(1,Math.ceil(w/1.6)),edgeRows=Math.max(1,Math.ceil(h/1.6));
  const edgeCtx=new OffscreenCanvas(edgeCols,edgeRows).getContext('2d');
  // surface now holds paper/sketch; use the original pixels for edge guidance.
  edgeCtx.drawImage(surface,0,0,edgeCols,edgeRows);
  const fineRGB=edgeCtx.getImageData(0,0,edgeCols,edgeRows).data;
  const edgeColors=fineRGB.slice();
  for(let y=1;y<edgeRows-1;y++)for(let x=1;x<edgeCols-1;x++){
    const i=4*(y*edgeCols+x);
    for(let c=0;c<3;c++){
      edgeColors[i+c]=.52*fineRGB[i+c]+.12*(fineRGB[i+c-4]+fineRGB[i+c+4]+
        fineRGB[i+c-4*edgeCols]+fineRGB[i+c+4*edgeCols]);
    }
  }
  const owner=new Int32Array(edgeCols*edgeRows);
  for(let y=0;y<edgeRows;y++)for(let x=0;x<edgeCols;x++){
    const a=(x+.5)*cols/edgeCols-.5,b=(y+.5)*rows/edgeRows-.5;
    const ix=Math.round(a),iy=Math.round(b),idx=y*edgeCols+x;
    let pick=iy*cols+ix,best=Infinity;
    for(let cy=Math.max(0,iy-2);cy<=Math.min(rows-1,iy+2);cy++)
      for(let cx=Math.max(0,ix-2);cx<=Math.min(cols-1,ix+2);cx++){
        const j=cy*cols+cx;
        const score=100*((cx-a)**2+(cy-b)**2)+[0,1,2].reduce((sum,k)=>sum+(edgeColors[4*idx+k]-small[4*j+k])**2,0);
        if(score<best){best=score;pick=j;}
      }
    owner[idx]=pick;
  }
  const mask=cells=>({path:smoothMask(cells,edgeCols,1,.38).path,sx:w/edgeCols,sy:h/edgeRows});
  const accents=[];
  for(const line of lines){
    if(!line.fine)continue;
    let supported=0;const path=[];
    for(let j=0;j<line.points.length;j++){
      const [x,y]=line.points[j],a=line.points[Math.max(0,j-1)],b=line.points[Math.min(j+1,line.points.length-1)];
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
      let darkest=255,pt=[x,y];
      for(let d=-2;d<=2;d++){
        const px=x-d*unit*dy/len,py=y+d*unit*dx/len,t=tone(photo,pixel(px,py));
        if(t<darkest){darkest=t;pt=[px,py];}
      }
      const cross=4*unit;
      const relief=Math.max(tone(photo,pixel(x-cross*dy/len,y+cross*dx/len)),tone(photo,pixel(x+cross*dy/len,y-cross*dx/len)))-darkest;
      if(relief>30&&darkest<100)supported++;
      path.push(pt);
    }
    if(supported>path.length*.70 && path.length>=3)accents.push({...line,points:path});
  }
  let attention=anchor;
  if(photographic){
    // Seek enclosed, compact dark shapes. Preserve the actual edge of each
    // feature instead of substituting a stock arc for shine or texture.
    const scaleX=w/fineCols,scaleY=h/fineRows,visited=new Uint8Array(fineCols*fineRows);
    const dark=32,blobs=[];
    for(let start=0;start<visited.length;start++){
      if(visited[start]||tone(finePixels,start)>dark)continue;
      const cells=[start];visited[start]=1;
      let sumX=0,sumY=0,sumTone=0;
      let left=fineCols,right=0,top=fineRows,bottom=0;
      for(let j=0;j<cells.length;j++){
        const i=cells[j],x=i%fineCols,y=Math.floor(i/fineCols);
        sumX+=x;sumY+=y;sumTone+=tone(finePixels,i);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        for(const k of [i-fineCols,i+fineCols,x?i-1:-1,x+1<fineCols?i+1:-1]){
          if(k<0||k>=visited.length||visited[k]||tone(finePixels,k)>dark)continue;
          cells.push(k);visited[k]=1;
        }
      }
      const n=cells.length,x=(sumX/n+.5)*scaleX,y=(sumY/n+.5)*scaleY;
      const a=(right-left+1)*scaleX,b=(bottom-top+1)*scaleY;
      const area=n*scaleX*scaleY/(unit*unit);
      if(x<w*.10||x>w*.90||y<h*.12||y>h*.71||area<35||area>720)continue;
      const shape=Math.min(a,b)/Math.max(a,b);
      if(shape<.46||n*scaleX*scaleY/(a*b)<.52)continue;
      const rimRadius=.67*Math.max(a,b);let rim=0;
      for(let j=0;j<12;j++){
        const t=j*Math.PI/6;rim+=tone(photo,pixel(x+rimRadius*Math.cos(t),y+rimRadius*Math.sin(t)));
      }
      const contrast=rim/12-sumTone/n;
      if(contrast<31)continue;
      blobs.push({x,y,a,b,area,cells,score:contrast*shape*Math.sqrt(area)});
    }
    for(const blob of blobs){
      const pair=blobs.some(other=>{
        const dx=Math.abs(other.x-blob.x),dy=Math.abs(other.y-blob.y);
        return dx>blob.a*1.4&&dx<w*.23&&dy<dx*.37
          &&other.area/blob.area>.46&&other.area/blob.area<2.18;
      });
      if(pair)blob.score*=1.65;
    }
    const features=blobs.sort((a,b)=>b.score-a.score).slice(0,3);
    if(features.length)attention=[features[0].x,features[0].y];
    for(const blob of features){
      const {x,y,cells}=blob;
      const rim=new Array(14).fill(null),distance=new Float32Array(14);
      for(const i of cells){
        const px=(i%fineCols+.5)*scaleX,py=(Math.floor(i/fineCols)+.5)*scaleY;
        const a=Math.atan2(py-y,px-x),index=Math.min(13,Math.floor((a+Math.PI)/(2*Math.PI)*14));
        const d=Math.hypot(px-x,py-y);
        if(d>distance[index]){rim[index]=[px,py];distance[index]=d;}
      }
      const points=rim.filter(Boolean);
      if(points.length<7)continue;
      points.push(points[0]);
      accents.push({points,priority:120+blob.score,pigment:true,feature:true});
      const glint=points.reduce((best,pt)=>tone(photo,pixel(...pt))>tone(photo,pixel(...best))?pt:best,points[0]);
      const fill=[[x-blob.a*.29,y+blob.b*.12],[x,y-blob.b*.17],[x+blob.a*.28,y+blob.b*.03]];
      if(Math.hypot(glint[0]-x,glint[1]-y)>.4*blob.a){
        accents.push({points:fill,priority:100+blob.score,pigment:true,feature:true,featureWidth:.58*Math.min(blob.a,blob.b)});
      }
    }
  }
  const outlines=[];
  let broadCount=0,fineCount=0;
  const inkSamples=[];
  for(const line of lines.sort((a,b)=>b.priority-a.priority)){
    if(line.priority<=.90 || outlines.length>=(photographic?105:500))break;
    if(photographic){
      if(line.fine){
        if(fineCount>=66 || line.priority<4.8)continue;
        const dark=line.points.filter(p=>tone(photo,pixel(...p))<95).length;
        if(dark<line.points.length*.45)continue;
      }else if(broadCount>=39)continue;
      let length=0;
      for(let i=1;i<line.points.length;i++){
        const [x,y]=line.points[i-1],[u,v]=line.points[i];
        length+=Math.hypot(x-u,y-v);
      }
      if(length<Math.min(w,h)*(line.fine?.019:.065))continue;
    }
    const points=line.points;
    const samples=[];
    for(let i=1;i<points.length;i++){
      const [x,y]=points[i-1],[u,v]=points[i];
      const steps=Math.max(1,Math.ceil(Math.hypot(u-x,v-y)/pitch));
      for(let k=0;k<steps;k++)samples.push([x+(u-x)*k/steps,y+(v-y)*k/steps]);
    }
    if(samples.length<(line.fine?1:2))continue;
    const overlap=samples.filter(([x,y])=>inkSamples.some(([u,v])=>Math.hypot(x-u,y-v)<pitch*(line.fine?.31:1.05))).length;
    if(overlap>samples.length*.38)continue;
    outlines.push(line);inkSamples.push(...samples);
    if(line.fine)fineCount++;else broadCount++;
  }
  const precise=fineInk(photo,w,h,unit,photographic);
  const inkTiles=new Set(),tile=Math.max(3,6.5*unit),inkCols=Math.ceil(w/tile);
  for(const {points} of precise)for(const [x,y] of points){
    inkTiles.add(Math.floor(y/tile)*inkCols+Math.floor(x/tile));
  }
  // Compact detached groups near the sides are drawn after the subject.
  // Use connected ink tiles so a long arm or leg stays with the main shape.
  const annotations=[];
  const unassigned=new Set(inkTiles);
  for(const start of unassigned){
    const cells=[start];unassigned.delete(start);
    let left=inkCols,right=0,top=Infinity,bottom=0;
    for(const i of cells){
      const x=i%inkCols,y=Math.floor(i/inkCols);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(const dy of [-1,0,1])for(const dx of [-1,0,1]){
        if(x+dx<0||x+dx>=inkCols)continue;
        const next=i+dx+dy*inkCols;
        if(unassigned.delete(next))cells.push(next);
      }
    }
    const l=left*tile,r=(right+1)*tile,t=top*tile,b=(bottom+1)*tile;
    const mid=(l+r)/2,midY=(t+b)/2;
    const compactSideGroup=midY<h*.56||r-l>2.1*(b-t)&&b-t<h*.13;
    if(cells.length>=12 && r-l<w*.40 && b-t<h*.39 && compactSideGroup &&
      (mid>w*.75||mid<w*.25) && Math.abs(mid-attention[0])>w*.24){
      const outsideX=mid>w*.5?r+2*tile:l-2*tile;
      const swatches=[.1,.28,.5,.72,.9].map(f=>rgb(photo,pixel(outsideX,t+(b-t)*f)));
      const backdrop=[0,1,2].map(c=>swatches.map(rgb=>rgb[c]).sort((a,b)=>a-b)[2]);
      const backdropTone=backdrop[0]*.299+backdrop[1]*.587+backdrop[2]*.114;
      annotations.push({l:l-tile,t:t-tile,r:r+tile,b:b+tile,backdrop:css(backdrop),backdropTone});
    }
  }
  // Strong graphic borders are part of the finished illustration. In a
  // photograph, construction lines sit beneath the pigment laid over them.
  const underPaint=photographic&&!annotations.some(({backdropTone})=>backdropTone>145);
  const annotationAt=(x,y)=>annotations.find(({l,t,r,b})=>x>=l&&x<=r&&y>=t&&y<=b);
  const delayedInk=[];
  const fallback=[...outlines,...accents.sort((a,b)=>b.priority-a.priority).slice(0,photographic?16:180)];
  // Where thin source ink exists, keep a fallback line only if it has
  // enough local support of its own. This avoids tracing the same edge twice.
  const finalInk=[...fallback.filter(line=>{
    if(line.feature)return true;
    let near=0,supported=0;
    for(const [i,[x,y]] of line.points.entries()){
      const ix=Math.floor(x/tile),iy=Math.floor(y/tile);
      if(![-1,0,1].some(dy=>[-1,0,1].some(dx=>
        ix+dx>=0&&ix+dx<inkCols&&inkTiles.has((iy+dy)*inkCols+ix+dx))))continue;
      near++;
      const a=line.points[Math.max(0,i-1)],b=line.points[Math.min(line.points.length-1,i+1)];
      const dx=b[0]-a[0],dy=b[1]-a[1],scale=unit*2.4/(Math.hypot(dx,dy)||1);
      const centre=tone(photo,pixel(x,y));
      const left=tone(photo,pixel(x-dy*scale,y+dx*scale));
      const right=tone(photo,pixel(x+dy*scale,y-dx*scale));
      if(Math.min(left,right)-centre>21||Math.abs(left-right)>41)supported++;
    }
    return near<line.points.length*.48||supported>=near*.50;
  }),...precise].filter(line=>{
    const [x,y]=line.points[line.points.length>>1];
    const margin=line.preciseInk?0:tile*2.5;
    const region=annotations.find(({l,t,r,b})=>
      x>=l-margin&&x<=r+margin&&y>=t-margin&&y<=b+margin);
    if(!region)return true;
    const {l,t,r,b}=region;
    const matches=([x,y])=>x>=l-margin&&x<=r+margin&&y>=t-margin&&y<=b+margin;
    if(line.points.filter(matches).length<line.points.length*.67)return true;
    delayedInk.push(line);
    return false;
  });
  // Block in a few large relationships before drawing the finished edges.
  const rough=finalInk.filter(line=>!line.fine&&!line.preciseInk&&line.points.length>=4);
  let pencil=attention;
  const construction=[];
  for(let k=0;k<12 && rough.length;k++){
    let pick=0,best=-Infinity;
    for(const [i,line] of rough.entries()){
      const [x,y]=line.points[line.points.length>>1];
      const score=line.priority/(1+Math.hypot(x-pencil[0],y-pencil[1])/(pitch*8));
      if(score>best){best=score;pick=i;}
    }
    const line=rough.splice(pick,1)[0];
    const points=line.points.filter((_,i)=>i%2===0||i===line.points.length-1);
    const draft=points.map(([x,y],i)=>[x+unit*2*Math.sin(i*.7),y+unit*2*Math.sin(i*.55)]);
    construction.push({line,points:draft});
    deposit(0,{points:draft,width:unit*1.8,color:'#858585',opacity:.42,rough:true});
    pencil=points.at(-1);
  }
  let tip=attention;
  while(finalInk.length){
    let choice=0,best=-Infinity,reverse=false;
    for(const [i,line] of finalInk.entries()){
      const distance=p=>Math.hypot(p[0]-tip[0],p[1]-tip[1]);
      const first=distance(line.points[0]),last=distance(line.points.at(-1));
      const score=Math.min(58,line.priority)/(1+Math.min(first,last)/(pitch*3));
      if(score>best){choice=i;best=score;reverse=last<first;}
    }
    const line=finalInk.splice(choice,1)[0];
    let points=reverse?[...line.points].reverse():line.points;
    if(photographic && !line.feature && !line.preciseInk)points=points.map((p,i)=>{
      if(i===0||i===points.length-1)return p;
      return p.map((v,k)=>(points[i-1][k]+v*3+points[i+1][k])/5);
    });
    // Join nearby contour fragments only when the tangents agree.
    for(let pass=0;pass<3&&!line.preciseInk;pass++){
      const tip=points.at(-1),prev=points.at(-2);
      const dx=tip[0]-prev[0],dy=tip[1]-prev[1],length=Math.hypot(dx,dy)||1;
      let pick=-1,backward=false,best=pitch*.9;
      for(const [i,next] of finalInk.entries()){
        if(next.feature||line.feature||next.preciseInk||Boolean(next.pigment)!==Boolean(line.pigment))continue;
        for(const reverse of [false,true]){
          const from=reverse?next.points.at(-1):next.points[0];
          const onward=reverse?next.points.at(-2):next.points[1];
          const x=onward[0]-from[0],y=onward[1]-from[1],norm=Math.hypot(x,y)||1;
          const gap=Math.hypot(tip[0]-from[0],tip[1]-from[1]);
          if(gap<best && (dx*x+dy*y)/(length*norm)>.88
            && (gap<.25 || (dx*(from[0]-tip[0])+dy*(from[1]-tip[1]))/(length*gap)>.78)){
            pick=i;backward=reverse;best=gap;
          }
        }
      }
      if(pick<0)break;
      const next=finalInk.splice(pick,1)[0].points;
      points=[...points,...(backward?[...next].reverse():next)];
    }
    const [mx,my]=points[points.length>>1];
    for(let i=construction.length-1;i>=0;i--){
      if(!construction[i].line.points.some(point=>points.includes(point)))continue;
      const draft=construction.splice(i,1)[0];
      deposit(0,{points:draft.points,width:unit*6,color:'#fff',opacity:1,erase:true});
    }
    if(line.preciseInk){
      const gray=48+.34*tone(photo,pixel(mx,my));
      const {material,...cleanLine}=line;
      deposit(0,{...cleanLine,points,underPaint,width:unit*1.65,color:css([gray,gray,gray]),opacity:.89});
      tip=points.at(-1);
      continue;
    }
    const width=line.featureWidth||(line.feature?unit*2.2:line.width*(1.14+Math.min(.72,line.priority/29)));
    const toneAtStroke=tone(photo,pixel(mx,my));
    const opacity=photographic?(line.pigment?.66:line.fine&&toneAtStroke<116?.43:.23):.88;
    const gray=18+.23*toneAtStroke;
    deposit(0,{...line,points,width,underPaint,pigment:true,ink:true,color:css([gray,gray,gray]),opacity});
    tip=points.at(-1);
  }
  for(const draft of construction){
    deposit(0,{points:draft.points,width:unit*6,color:'#fff',opacity:1,erase:true});
  }
  // Mix one solid colour per connected region. The brush covers local
  // sections of the scene in sequence with a few separate shadow strokes.
  report('Подбираю плоские цвета',48);
  const materialAt=new Array(count),materials=new Map();
  for(let i=0;i<count;i++){
    if(materialAt[i])continue;
    const key=root(i),cells=[i],m={cells,sum:[0,0,0],fine:[]};
    materialAt[i]=m;
    for(let j=0;j<cells.length;j++){
      const k=cells[j],x=k%cols;
      for(let c=0;c<3;c++)m.sum[c]+=small[4*k+c];
      for(const n of [k-cols,k+cols,x?k-1:-1,x+1<cols?k+1:-1]){
        if(n<0||n>=count||materialAt[n]||root(n)!==key)continue;
        cells.push(n);materialAt[n]=m;
      }
    }
    materials.set(i,m);
  }
  for(let i=0;i<owner.length;i++)materialAt[owner[i]].fine.push(i);
  paperSurface(ctx);
  const mixtures=[];
  const deferredPaint=[];
  const sceneSpan=Math.min(w,h);
  const axialStep=Math.max(w/edgeCols,h/edgeRows);
  const ownerAt=(x,y)=>materialAt[owner[
    Math.min(edgeRows-1,Math.max(0,Math.floor(y/h*edgeRows)))*edgeCols+
    Math.min(edgeCols-1,Math.max(0,Math.floor(x/w*edgeCols)))]];
  for(const m of materials.values()){
    if(!m.fine.length)continue;
    const colour=css(m.sum.map(v=>v/m.cells.length)),stencil=mask(m.fine);
    const samples=[];
    let sx=0,sy=0,sxx=0,syy=0,sxy=0;
    for(const i of m.fine){
      const x=(i%edgeCols+.5)*w/edgeCols,y=(Math.floor(i/edgeCols)+.5)*h/edgeRows;
      samples.push([x,y]);
      sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;
    }
    const n=samples.length;
    const angle=.5*Math.atan2(2*(sxy-sx*sy/n),sxx-syy-(sx*sx-sy*sy)/n);
    const cos=Math.cos(angle),sin=Math.sin(angle);
    const spacing=Math.max(3*unit,Math.min(20*unit,4*unit+Math.sqrt(n)*.56));
    const lanes=new Map(),marks=[];
    const offset=(sy*cos-sx*sin)/n;
    const toPoint=(u,v)=>[u*cos-v*sin,u*sin+v*cos];
    for(const [x,y] of samples){
      const u=x*cos+y*sin,v=y*cos-x*sin;
      const key=Math.round((v-offset)/spacing);
      if(!lanes.has(key))lanes.set(key,[]);
      lanes.get(key).push([u,v]);
    }
    for(const [lane,points] of [...lanes].sort(([a],[b])=>a-b)){
      points.sort(([a],[b])=>a-b);
      for(let first=0;first<points.length;){
        let last=first;
        const start=points[first][0],limit=Math.max(sceneSpan*.32,spacing*8);
        while(last+1<points.length && points[last+1][0]-points[last][0]<axialStep*1.65 &&
          points[last+1][0]-start<limit)last++;
        const end=points[last][0],laneCentre=offset+lane*spacing;
        const segments=Math.max(1,Math.ceil((end-start)/(spacing*1.2)));
        const sums=Array.from({length:segments+1},()=>[0,0]);
        const span=end-start || 1;
        for(let i=first;i<=last;i++){
          const [u,v]=points[i],j=Math.round((u-start)/span*segments);
          sums[j][0]+=v-laneCentre;sums[j][1]++;
        }
        const brushWidth=spacing*1.64;
        const path=sums.map(([shift,count],i)=>toPoint(
          start+(end-start)*i/segments,laneCentre+(count?shift/count*.26:0)));
        const lead=brushWidth*.54+axialStep;
        path.unshift(toPoint(start-lead,laneCentre));
        path.push(toPoint(end+lead,laneCentre));
        const [x,y]=toPoint((start+end)/2,laneCentre);
        const decal=annotationAt(x,y);
        const inside=decal&&path.slice(1,-1).every(([u,v])=>annotationAt(u,v)===decal);
        const mark={x,y,points:path,width:brushWidth,pigment:true,baseBrush:true,
          material:stencil,color:colour,opacity:1,span:end-start};
        if(inside && n*axialStep**2<sceneSpan**2*.023){
          deferredPaint.push(mark);
          marks.push({...mark,color:decal.backdrop});
        }else marks.push(mark);
        first=last+1;
      }
    }
    mixtures.push({marks,area:m.fine.length});
  }
  // Work across neighbouring planes in short visits, saving tiny fills
  // until the broad relationships around them have been established.
  let [x,y]=attention;
  let passes=0;
  while(mixtures.length){
    let chosen,entry,best=Infinity;
    const focus=Math.max(0,1-passes/12);
    for(const mixture of mixtures)for(const mark of mixture.marks){
      const distance=Math.hypot(x-mark.x,y-mark.y);
      const fromFocus=Math.hypot(attention[0]-mark.x,attention[1]-mark.y);
      const weight=Math.min(sceneSpan*.20,mark.span*.42+axialStep*Math.sqrt(mixture.area)*.07);
      const cost=distance+fromFocus*focus*.75-weight;
      if(cost<best){best=cost;chosen=mixture;entry=mark;}
    }
    const radius=Math.max(sceneSpan*.12,entry.width*2.5);
    const run=chosen.marks.filter(mark=>Math.hypot(mark.x-entry.x,mark.y-entry.y)<=radius);
    for(let i=0;i<6&&run.length;i++){
      let pick=0,reverse=false,best=Infinity;
      for(const [j,mark] of run.entries()){
        const a=mark.points[0],b=mark.points.at(-1);
        const start=Math.hypot(x-a[0],y-a[1]),finish=Math.hypot(x-b[0],y-b[1]);
        const cost=Math.min(start,finish);
        if(cost<best){best=cost;pick=j;reverse=finish<start;}
      }
      const mark=run.splice(pick,1)[0];
      chosen.marks.splice(chosen.marks.indexOf(mark),1);
      if(reverse)mark.points.reverse();
      if(i===0)mark.startsMixture=true;
      deposit(1,mark);
      [x,y]=mark.points.at(-1);
    }
    passes++;
    if(!chosen.marks.length)mixtures.splice(mixtures.indexOf(chosen),1);
  }
  // On photographs, keep high-frequency contrast near the focal feature.
  // Elsewhere, trace the underlying light and shadow rather than surface grain.
  let detailSource=photo;
  if(photographic){
    const reduced=new OffscreenCanvas(Math.ceil(w/4),Math.ceil(h/4));
    const reduction=reduced.getContext('2d');
    reduction.imageSmoothingQuality='high';
    const original=new OffscreenCanvas(w,h);
    original.getContext('2d').putImageData(new ImageData(photo,w,h),0,0);
    reduction.drawImage(original,0,0,reduced.width,reduced.height);
    const filtered=original.getContext('2d');
    filtered.imageSmoothingQuality='high';
    filtered.drawImage(reduced,0,0,w,h);
    detailSource=filtered.getImageData(0,0,w,h).data;
    const focalRadius=Math.min(w,h)*.12;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const distance=Math.hypot(x-attention[0],y-attention[1]);
      const fidelity=.18+.82*Math.max(0,1-distance/focalRadius);
      const i=4*(y*w+x);
      for(let c=0;c<3;c++)detailSource[i+c]+=(photo[i+c]-detailSource[i+c])*fidelity;
    }
  }
  // A photograph needs modelling inside the broad colour shapes as well
  // as along their edges. A genuinely flat illustration can skip this.
  if(photographic){
    report('Прорисовываю свет и полутени',70);
    const centres=[attention], candidates=[];
    const startPaint=ctx.getImageData(0,0,w,h).data;
    const spacing=Math.max(10,Math.min(w,h)/16);
    for(let y=spacing*.5;y<h;y+=spacing)for(let x=spacing*.5;x<w;x+=spacing){
      let error=0;
      for(const [dx,dy] of [[0,0],[.4,0],[-.4,0],[0,.4],[0,-.4]]){
        const i=4*pixel(x+spacing*dx,y+spacing*dy);
        for(let c=0;c<3;c++)error+=Math.abs(photo[i+c]-startPaint[i+c]);
      }
      candidates.push({x,y,weight:.68+Math.min(180,error/5)/230});
    }
    while(centres.length<9 && centres.length<candidates.length){
      let best=null,score=-1;
      for(const candidate of candidates){
        const distance=Math.min(...centres.map(([x,y])=>Math.hypot(candidate.x-x,candidate.y-y)));
        const priority=distance*candidate.weight;
        if(priority>score){score=priority;best=candidate;}
      }
      if(!best||score<spacing)break;
      centres.push([best.x,best.y]);
    }
    function neighbourhood(x,y){
      let choice=0,best=Infinity;
      for(const [i,[cx,cy]] of centres.entries()){
        const distance=(x-cx)**2+(y-cy)**2;
        if(distance<best){best=distance;choice=i;}
      }
      return choice;
    }
    const order=[0],pending=new Set(centres.map((_,i)=>i).slice(1));
    while(pending.size){
      const [x,y]=centres[order.at(-1)];
      let choice,best=Infinity;
      for(const i of pending){
        const [cx,cy]=centres[i],distance=Math.hypot(cx-x,cy-y);
        if(distance<best){best=distance;choice=i;}
      }
      order.push(choice);pending.delete(choice);
    }
    // Establish medium tones on several forms before revisiting the first
    // one with the smaller brush. Paint is re-read on every return visit.
    const visits=[order,[...order.slice(2),...order.slice(0,2)]];
    for(const [round,zones] of visits.entries())for(const zone of zones){
      const scale=round===0?14:9;
      const old=ctx.getImageData(0,0,w,h).data,step=Math.max(3,scale*unit),work=[];
      for(let y=step*.5;y<h;y+=step)for(let x=step*.5;x<w;x+=step){
        const sx=x+.19*step*Math.sin(y/step*1.8+x/step*.6);
        const sy=y+.17*step*Math.cos(x/step*1.9-y/step*1.1);
        if(neighbourhood(sx,sy)!==zone||annotationAt(sx,sy))continue;
        const centre=rgb(detailSource,pixel(sx,sy)),sum=[0,0,0],paint=[0,0,0];let count=0;
        for(const [dx,dy] of [[0,0],[.45,0],[-.45,0],[0,.45],[0,-.45]]){
          const i=pixel(sx+dx*step,sy+dy*step);
          const c=rgb(detailSource,i);
          if(c.reduce((acc,v,k)=>acc+Math.abs(v-centre[k]),0)>54)continue;
          count++;
          for(let k=0;k<3;k++){sum[k]+=c[k];paint[k]+=old[4*i+k];}
        }
        const error=sum.reduce((n,v,k)=>n+Math.abs(v-paint[k]),0)/count;
        if(error<(round===0?25:32))continue;
        const colour=sum.map(v=>v/count);
        const radius=step*.85;
        const light=(x,y)=>tone(detailSource,pixel(x,y));
        const gradientAt=(x,y)=>[
          light(x+radius,y)-light(x-radius,y),
          light(x,y+radius)-light(x,y-radius)
        ];
        const [gx,gy]=gradientAt(sx,sy);
        if(Math.hypot(gx,gy)<5)continue;
        const angle=Math.atan2(gy,gx)+Math.PI/2;
        const from=[sx,sy],before=[],after=[];
        for(const [direction,side] of [[-1,before],[1,after]]){
          let x=sx,y=sy,tx=direction*Math.cos(angle),ty=direction*Math.sin(angle);
          for(let i=0;i<8;i++){
            const [dx,dy]=gradientAt(x,y),strength=Math.hypot(dx,dy);
            if(strength>7){
              const sign=dx*ty-dy*tx>=0?1:-1;
              tx=tx*.86-dy/strength*sign*.14;
              ty=ty*.86+dx/strength*sign*.14;
            }
            x+=tx*step*.43;
            y+=ty*step*.43;
            if(x<0||x>=w||y<0||y>=h)break;
            const sample=rgb(detailSource,pixel(x,y));
            if(sample.reduce((n,v,k)=>n+Math.abs(v-colour[k]),0)>63)break;
            side.push([x,y]);
          }
        }
        if(before.length+after.length<6)continue;
        const points=[...before.reverse(),from,...after];
        const shade=point=>css(rgb(detailSource,pixel(...point)).map((v,c)=>(v+colour[c])/2));
        const color=css(colour);
        work.push({x:sx,y:sy,points,pigment:true,color,shades:[shade(points[0]),color,shade(points.at(-1))],
          opacity:round===0?.57:.50,width:step*(count<=2?.93:1.42),error});
      }
      work.sort((a,b)=>b.error-a.error);
      // A few adjacent marks establish a connected transition before moving on.
      const size=step*6,blocks=new Map();
      for(const m of work.slice(0,round===0?65:52)){
        const key=Math.floor(m.y/size)*Math.ceil(w/size)+Math.floor(m.x/size);
        if(!blocks.has(key))blocks.set(key,[]);
        blocks.get(key).push(m);
      }
      let [x,y]=centres[zone];
      while(blocks.size){
        let key,best=Infinity;
        for(const [i,marks] of blocks){
          const m=marks[0],d=Math.hypot(x-m.x,y-m.y)/(1+m.error/100);
          if(d<best){best=d;key=i;}
        }
        const block=blocks.get(key);blocks.delete(key);
        for(const m of block){deposit(2,m);[x,y]=m.points.at(-1);}
      }
    }
  }
  // Revisit the planes with missing contrast, larger accents first. The
  // residual is measured against the painted canvas, including its base coat.
  // Reserve the smallest brushes for errors that actually remain. Flat
  // illustration colours already within tolerance receive no extra marks.
  const detailPasses=[
    {scale:6.5,error:54,edge:11,limit:720},
    {scale:4,error:51,edge:12,limit:700},
    {scale:2.5,error:48,edge:17,limit:400}
  ];
  for(const [pass,settings] of detailPasses.entries()){
    report(pass<2?'Уточняю тени и форму':'Уточняю линии и блики',73+pass*7);
    const old=ctx.getImageData(0,0,w,h).data;
    const step=Math.max(1.35,unit*settings.scale),marks=[];
    for(let row=0,y=step*.5;y<h;y+=step,row++)for(let col=0,x=step*.5;x<w;x+=step,col++){
      const px=Math.min(w-.1,x+step*.24*Math.sin(row*2.4+col*1.7));
      const py=Math.min(h-.1,y+step*.24*Math.cos(col*2.1-row*.9));
      if(annotationAt(px,py))continue;
      const i=pixel(px,py),base=rgb(detailSource,i),prev=rgb(old,i);
      const difference=base.map((v,c)=>v-prev[c]);
      const error=difference.reduce((e,v)=>e+Math.abs(v),0);
      const paperGap=prev[0]>226&&prev[1]>218&&prev[2]>204&&error>70;
      const subjectDistance=Math.hypot(px-attention[0],py-attention[1])/sceneSpan;
      if(error<settings.error+(pass===2?Math.min(34,subjectDistance*55):0))continue;
      const material=ownerAt(px,py);
      const radius=step*1.3;
      const pxTone=(dx,dy)=>tone(detailSource,pixel(px+dx,py+dy));
      const gx=pxTone(radius,0)-pxTone(-radius,0),gy=pxTone(0,radius)-pxTone(0,-radius);
      if(!paperGap && Math.hypot(gx,gy)<settings.edge && (pass===2 || error<settings.error+22))continue;
      if(Math.hypot(gx,gy)<7&&!paperGap)continue;
      const angle=Math.atan2(gy,gx)+Math.PI/2;
      const dx=Math.cos(angle),dy=Math.sin(angle);
      const along=sign=>{
        const points=[];
        let x=px,y=py,tx=sign*dx,ty=sign*dy;
        for(let k=0;k<(pass<2?13:10);k++){
          const gx=tone(detailSource,pixel(x+radius,y))-tone(detailSource,pixel(x-radius,y));
          const gy=tone(detailSource,pixel(x,y+radius))-tone(detailSource,pixel(x,y-radius));
          const gradient=Math.hypot(gx,gy);
          if(gradient>settings.edge){
            const direction=(-gy*tx+gx*ty)<0?-1:1;
            tx=tx*.77-direction*gy/gradient*.23;
            ty=ty*.77+direction*gx/gradient*.23;
          }
          x+=tx*step*.66;
          y+=ty*step*.66;
          if(x<0||x>=w||y<0||y>=h)break;
          const j=pixel(x,y),color=rgb(detailSource,j),under=rgb(old,j);
          if(ownerAt(x,y)!==material && color.reduce((e,v,c)=>e+Math.abs(v-base[c]),0)>22)break;
          if(color.reduce((e,v,c)=>e+Math.abs(v-base[c]),0)>(pass<2?50:34))break;
          const support=color.reduce((e,v,c)=>e+(v-under[c])*Math.sign(difference[c]),0);
          if(support<settings.error*.28)break;
          points.push([x,y]);
        }
        return points;
      };
      const before=along(-1),after=along(1);
      // Small isolated residuals read as specks. Keep a detail only when
      // it can travel far enough along the form to produce a visible stroke.
      const length=before.length+after.length;
      if(length<(paperGap?5:pass===2?9:7))continue;
      const points=[...before.reverse(),[px,py],...after];
      const improvement=points.reduce((total,[x,y])=>{
        const j=pixel(x,y),source=rgb(detailSource,j),under=rgb(old,j);
        return total+source.reduce((sum,v,c)=>sum+Math.abs(v-under[c])-Math.abs(v-base[c]),0);
      },0);
      if(improvement<points.length*settings.error*.4)continue;
      marks.push({points,x:px,y:py,pigment:true,
        width:step*(paperGap?2.3:pass<2?1.48:1.15),color:css(base),
        opacity:paperGap?.91:pass===2?.83:photographic?.56:.67,
        priority:improvement*(1-.35*Math.min(1,subjectDistance))+(paperGap?170:0)});
    }
    const covered=new Set(),cellSize=step*1.55,coverCols=Math.ceil(w/cellSize);
    const sectors=new Map(),span=Math.max(12,unit*54);
    let accepted=0;
    for(const mark of marks.sort((a,b)=>b.priority-a.priority)){
      if(accepted>=settings.limit)break;
      const cells=[...new Set(mark.points.map(([x,y])=>Math.floor(y/cellSize)*coverCols+Math.floor(x/cellSize)))];
      if(cells.filter(i=>covered.has(i)).length>=cells.length*.38)continue;
      for(const i of cells)covered.add(i);
      accepted++;
      const key=Math.floor(mark.y/span)*Math.ceil(w/span)+Math.floor(mark.x/span);
      if(!sectors.has(key))sectors.set(key,[]);
      sectors.get(key).push(mark);
    }
    let [x,y]=anchor;
    let previousSector=null;
    while(sectors.size){
      let key,best=Infinity;
      for(const [i,group] of sectors){
        if(i===previousSector&&sectors.size>1)continue;
        const d=Math.hypot(x-group[0].x,y-group[0].y);
        if(d<best){best=d;key=i;}
      }
      const group=sectors.get(key);
      const batch=group.splice(0,pass<2?9:6);
      if(!group.length)sectors.delete(key);
      previousSector=key;
      while(batch.length){
        const mark=batch.shift();
        for(let join=0;join<2;join++){
          const tip=mark.points.at(-1),prev=mark.points.at(-2);
          const dx=tip[0]-prev[0],dy=tip[1]-prev[1],length=Math.hypot(dx,dy)||1;
          let index=-1,reverseNext=false,best=step*2.1;
          const pigment=rgb(detailSource,pixel(mark.x,mark.y));
          for(const [i,next] of batch.entries()){
            for(const reverse of [false,true]){
              const start=reverse?next.points.at(-1):next.points[0];
              const end=reverse?next.points.at(-2):next.points[1];
              const gap=Math.hypot(tip[0]-start[0],tip[1]-start[1]);
              const vx=end[0]-start[0],vy=end[1]-start[1];
              if(gap>=best || (dx*vx+dy*vy)<length*Math.hypot(vx,vy)*.83)continue;
              if(gap>.15 && (dx*(start[0]-tip[0])+dy*(start[1]-tip[1]))<length*gap*.70)continue;
              if([start,[(tip[0]+start[0])/2,(tip[1]+start[1])/2]].some(([x,y])=>
                rgb(detailSource,pixel(x,y)).reduce((sum,v,c)=>sum+Math.abs(v-pigment[c]),0)>26))continue;
              index=i;reverseNext=reverse;best=gap;
            }
          }
          if(index<0)break;
          const next=batch.splice(index,1)[0];
          if(reverseNext)next.points.reverse();
          mark.points.push(...next.points);
        }
        if(pass<2){
          const from=rgb(detailSource,pixel(...mark.points[0]));
          const tip=rgb(detailSource,pixel(...mark.points.at(-1)));
          const mix=rgb(detailSource,pixel(mark.x,mark.y));
          const shade=sample=>css(sample.map((v,c)=>mix[c]+(Math.max(-22,Math.min(22,v-mix[c]))*.65)));
          mark.shades=[shade(from),mark.color,shade(tip)];
        }
        deposit(2,mark);[x,y]=mark.points.at(-1);
      }
    }
  }
  // Restore thin colour accents after broad paint, then sign and decorate.
  const accentsInColour=fineInk(photo,w,h,unit,photographic,true);
  const appendFinish=mark=>{
    prepareHand(mark,serial++);
    stages[2].push(mark);
  };
  for(const line of accentsInColour.filter(line=>!annotationAt(...line.points[line.points.length>>1]))){
    appendFinish({...line,finishInk:true});
  }
  for(const mark of deferredPaint)appendFinish(mark);
  for(const line of [...delayedInk,...accentsInColour.filter(line=>annotationAt(...line.points[line.points.length>>1]))]){
    const color=line.preciseInk?line.color:'#514441';
    appendFinish({...line,color,ink:true,pigment:true,finishInk:true,opacity:line.preciseInk?.96:.43});
  }
  report('Готовлю запись',94);
  return {stages,weights:photographic?[.25,.25,.50]:[.39,.25,.36]};
}
self.onmessage=({data:{bitmap}})=>{
  try{self.postMessage(compose(bitmap,(label,value)=>self.postMessage({label,value})));}
  catch(e){self.postMessage({error:e.message});}
};
