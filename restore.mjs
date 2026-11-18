// Paint native-resolution corrections in small footprints along local flows.
export function restorePlan(ctx, original, previous) {
  const {width,height} = ctx.canvas;
  const target = ctx.getImageData(0,0,width,height);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d');
  sourceContext.drawImage(original,0,0);
  const source = sourceContext.getImageData(0,0,width,height);
  sourceCanvas.width = sourceCanvas.height = 1;
  const before = new Uint32Array(target.data.buffer);
  const after = new Uint32Array(source.data.buffer);
  const scale = Math.max(1,Math.max(width,height)/390);
  const cols = Math.ceil(width/scale), rows = Math.ceil(height/scale);
  const xs = Array.from({length:cols+1},(_,x)=>Math.floor(x*width/cols));
  const ys = Array.from({length:rows+1},(_,y)=>Math.floor(y*height/rows));
  const pending = new Uint8Array(cols*rows);
  const brightness = new Float32Array(pending.length);
  for (let y=0;y<rows;y++) {
    for (let x=0;x<cols;x++) {
      const cell = y*cols+x;
      const i = ys[y]*width+xs[x];
      const color = i*4;
      brightness[cell] = .30*source.data[color]+.59*source.data[color+1]+.11*source.data[color+2];
      for (let py=ys[y];py<ys[y+1] && !pending[cell];py++) {
        for (let px=xs[x];px<xs[x+1];px++) {
          const position = py*width+px;
          if (before[position]!==after[position]) {pending[cell]=1;break;}
        }
      }
    }
  }

  const at = (x,y)=>Math.max(0,Math.min(rows-1,Math.round(y)))*cols+
    Math.max(0,Math.min(cols-1,Math.round(x)));
  function tangent(x,y) {
    const gx = brightness[at(x+2,y)]-brightness[at(x-2,y)];
    const gy = brightness[at(x,y+2)]-brightness[at(x,y-2)];
    return Math.hypot(gx,gy)>9 ? Math.atan2(gy,gx)+Math.PI/2 : -.58;
  }
  const tiles = [];
  const tile = 28;
  for (let y=0;y<rows;y+=tile) {
    for (let x=0;x<cols;x+=tile) {
      tiles.push({x,y,salt:Math.sin(x*7.19+y*3.73)*8});
    }
  }
  let hand = previous ? [previous[0]*cols/width,previous[1]*rows/height] : [cols*.42,rows*.35];
  const operations = [];
  function collect(x,y,cells,radius) {
    const cx = Math.round(x), cy = Math.round(y);
    for (let dy=-radius;dy<=radius;dy++) {
      for (let dx=-radius;dx<=radius;dx++) {
        const px=cx+dx, py=cy+dy, i=py*cols+px;
        if (px<0 || py<0 || px>=cols || py>=rows || dx*dx+dy*dy>radius*radius || !pending[i]) continue;
        pending[i]=0;
        cells.push(i);
      }
    }
  }
  while (tiles.length) {
    const distance = ({x,y,salt})=>Math.hypot(x+tile/2-hand[0],y+tile/2-hand[1])+salt;
    let closest = 0;
    for (let i=1;i<tiles.length;i++) if (distance(tiles[i])<distance(tiles[closest])) closest=i;
    const [{x,y}] = tiles.splice(closest,1);
    while (true) {
      let seed, best = Infinity;
      for (let py=y;py<Math.min(y+tile,rows);py++) {
        for (let px=x;px<Math.min(x+tile,cols);px++) {
          if (!pending[py*cols+px]) continue;
          const d = (px-hand[0])**2+(py-hand[1])**2;
          if (d<best) {best=d;seed=[px,py];}
        }
      }
      if (!seed) break;
      const trail = [];
      let [px,py] = seed;
      const edge = Math.hypot(brightness[at(px+2,py)]-brightness[at(px-2,py)],
        brightness[at(px,py+2)]-brightness[at(px,py-2)]);
      const radius = edge>31 ? 3 : 5;
      let heading=tangent(px,py);
      if (Math.cos(heading)*(px-hand[0])+Math.sin(heading)*(py-hand[1])<0) heading+=Math.PI;
      const bend = Math.sin(px*13.17+py*7.31)*.23;
      const steps = (edge>31?10:16)+Math.round(Math.abs(bend)*39);
      for (let j=0;j<steps;j++) {
        const cells=[];
        collect(px,py,cells,radius);
        trail.push({cells,point:[(px+.5)*width/cols,(py+.5)*height/rows]});
        const turn=tangent(px,py)-heading;
        heading+=.19*Math.atan2(Math.sin(2*turn),Math.cos(2*turn))+bend*.18;
        const nx=px+Math.cos(heading)*1.65, ny=py+Math.sin(heading)*1.65;
        if (nx<0 || ny<0 || nx>=cols || ny>=rows) break;
        px=nx;py=ny;
      }
      operations.push(trail);
      hand=[px,py];
    }
  }

  let operation=0, substep=0, previousTip;
  const initial=target.data.slice();
  const fading=[];
  const settle=Math.max(1,operations.length*.038);
  return function render(progress) {
    const value=progress*(operations.length+settle);
    const end=Math.min(operations.length,Math.floor(value));
    let left=width,top=height,right=0,bottom=0;
    function dirty(x0,y0,x1,y1) {
      left=Math.min(left,x0);top=Math.min(top,y0);
      right=Math.max(right,x1);bottom=Math.max(bottom,y1);
    }
    function queue(trail,index) {
      const hit=operation+index/trail.length;
      for (const cell of trail[index].cells) fading.push({cell,hit});
    }
    if (previousTip) {
      const [x,y]=previousTip;
      dirty(Math.max(0,Math.floor(x-13)),Math.max(0,Math.floor(y-13)),
        Math.min(width,Math.ceil(x+13)),Math.min(height,Math.ceil(y+13)));
    }
    for (;operation<end;operation++,substep=0) {
      const trail=operations[operation];
      for (;substep<trail.length;substep++) queue(trail,substep);
    }
    const trail=operations[operation];
    if (trail) {
      const t=value-end;
      const count=Math.min(trail.length,Math.floor(t*trail.length)+1);
      for (;substep<count;substep++) queue(trail,substep);
    }
    let active=0;
    for (const item of fading) {
      const {cell,hit}=item;
      const t=Math.max(0,Math.min(1,(value-hit)/settle));
      const strength=t*t*(3-2*t);
      const x=cell%cols,y=Math.floor(cell/cols);
      for (let py=ys[y];py<ys[y+1];py++) {
        const start=py*width+xs[x], stop=py*width+xs[x+1];
        if (t===1) before.set(after.subarray(start,stop),start);
        else for (let p=start*4;p<stop*4;p++) target.data[p]=initial[p]+(source.data[p]-initial[p])*strength;
      }
      dirty(xs[x],ys[y],xs[x+1],ys[y+1]);
      if (t<1) fading[active++]=item;
    }
    fading.length=active;
    if (right>left && bottom>top) ctx.putImageData(target,0,0,left,top,right-left,bottom-top);
    previousTip=trail?.[Math.max(0,substep-1)].point ?? null;
    return previousTip;
  };
}
