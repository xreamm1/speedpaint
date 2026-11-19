export const typeNames = {
  ink:'Лайн-арт и текст', score:'Ноты', illustration:'Иллюстрация',
  portrait:'Фотопортрет', photo:'Фотография'
};

export function staffGroups(image) {
  const {width,height,data}=image;
  const lines=[];
  for (let y=0;y<height;y++) {
    let start=0, best=0, end=0;
    for (let x=0;x<width;x++) {
      const i=(y*width+x)*4;
      if (data[i]+data[i+1]+data[i+2]>435) start=x+1;
      else if (x-start+1>best) {
        best=x-start+1;
        end=x;
      }
    }
    if (best<width*.31) continue;
    const last=lines.at(-1);
    if (last && y===last.bottom+1) {
      last.bottom=y;
      if (best>last.length) Object.assign(last,{left:end-best+1,right:end,length:best});
    } else lines.push({top:y,bottom:y,left:end-best+1,right:end,length:best});
  }
  const groups=[];
  for (let i=0;i<=lines.length-5;i++) {
    const group=lines.slice(i,i+5);
    const spacing=(group[4].top-group[0].top)/4;
    if (spacing<2 || spacing>height*.09) continue;
    if (Math.min(...group.map(line=>line.right))-Math.max(...group.map(line=>line.left))<width*.25) continue;
    if (group.slice(1).some((line,j)=>Math.abs(line.top-group[j].top-spacing)>Math.max(1,spacing*.25))) continue;
    groups.push(...group);
    i+=4;
  }
  return groups;
}

export async function classify(source, requested, report) {
  const ratio=Math.min(1,192/Math.max(source.width,source.height));
  const width=Math.max(1,Math.round(source.width*ratio));
  const height=Math.max(1,Math.round(source.height*ratio));
  const sample=new OffscreenCanvas(width,height);
  const ctx=sample.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(source,0,0,width,height);
  const image=ctx.getImageData(0,0,width,height);
  const {data}=image;
  let white=0, neutral=0, flat=0, sharp=0, dark=0;
  for (let i=0;i<data.length;i+=4) {
    const [r,g,b]=data.subarray(i,i+3);
    const spread=Math.max(r,g,b)-Math.min(r,g,b);
    if (Math.min(r,g,b)>220) white++;
    if (spread<24) neutral++;
    if (r+g+b<390) dark++;
    if (i && i/4%width) {
      const delta=Math.abs(r-data[i-4])+Math.abs(g-data[i-3])+Math.abs(b-data[i-2]);
      if (delta<13) flat++;
      if (delta>115) sharp++;
    }
  }
  const count=width*height;
  let type=requested;
  if (type==='auto') {
    if (white/count>.56 && neutral/count>.81 && dark/count>.002) {
      type=staffGroups(image).length ? 'score' : 'ink';
    } else if (flat/count>.62 && (sharp/count>.025 || flat/count>.79)) type='illustration';
    else type='photo';
  }
  if (type!=='photo' && type!=='portrait') return {type};
  if (requested==='photo') return {type};
  report('Ищу лицо на фотографии',8);
  try {
    if (typeof FaceDetector==='function') {
      let timer;
      try {
        const faces=await Promise.race([
          new FaceDetector({fastMode:true,maxDetectedFaces:4}).detect(sample),
          new Promise(resolve=>{timer=setTimeout(()=>resolve([]),450);})
        ]);
        const face=faces.map(item=>item.boundingBox).filter(box=>box.width>width*.10 && box.height>height*.10)
          .sort((a,b)=>b.width*b.height-a.width*a.height)[0];
        if (face) return {type:'portrait',focus:[(face.x+face.width*.5)/width,(face.y+face.height*.44)/height],
          radius:face.width/width*.5};
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    // The local detector is optional on browsers without face detection support.
  }
  return {type};
}
