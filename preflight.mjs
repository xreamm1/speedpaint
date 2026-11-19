import {paper,plan,stroke} from './paint.mjs?v=coverage';
import {finishPlan} from './finish.mjs?v=coverage';

import {correctionPaths} from './restore.mjs?v=continuous';

self.onmessage = ({data:{bitmap,brush,detail,focus,exact}}) => {
  const report = (label,value) => self.postMessage({label,value});
  try {
    const reference = new OffscreenCanvas(bitmap.width,bitmap.height);
    reference.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0);
    bitmap.close();
    const {stages,areas} = plan(reference,brush,detail,focus,report);
    const {regions,labels,cols,step} = areas;
    report('Рендерю пробный рисунок',72);
    const proof = new OffscreenCanvas(reference.width,reference.height);
    const ctx = proof.getContext('2d',{willReadFrequently:true,alpha:false});
    ctx.fillStyle = paper;
    ctx.fillRect(0,0,proof.width,proof.height);
    for (const mark of stages[0]) stroke(ctx,mark);
    const coverage = new OffscreenCanvas(proof.width,proof.height).getContext('2d',{willReadFrequently:true});
    function baseStroke(mark) {
      stroke(ctx,mark);
      stroke(coverage,mark);
    }
    for (const mark of stages[1]) baseStroke(mark);
    report('Проверяю покрытие внутри цветовых форм',73);
    for (let pass=0;pass<2;pass++) {
      const {data}=coverage.getImageData(0,0,proof.width,proof.height);
      for (const area of regions) {
        const gaps = area.region.filter(cell=>{
          const x=Math.min(proof.width-1,Math.floor((cell%cols+.5)*step));
          const y=Math.min(proof.height-1,Math.floor((Math.floor(cell/cols)+.5)*step));
          return data[4*(y*proof.width+x)+3]<110;
        }).sort((a,b)=>a-b);
        for (let i=0;i<gaps.length;) {
          const first=gaps[i++];
          const row=Math.floor(first/cols);
          while (i<gaps.length && gaps[i]===gaps[i-1]+1 && Math.floor(gaps[i]/cols)===row) i++;
          const left=(first%cols)*step, right=(gaps[i-1]%cols+1)*step;
          const y=(row+.5)*step;
          const mark={clip:area.clip,color:area.color,points:[[left-step,y],[right+step,y]],width:step*1.9,opacity:.94,pressure:.16};
          baseStroke(mark);
          stages[1].push(mark);
        }
      }
    }
    coverage.canvas.width=1;
    for (const mark of stages[2]) stroke(ctx,mark);
    const {width,height} = proof;
    const source = reference.getContext('2d').getImageData(0,0,width,height);
    function difference(snapshot) {
      const errors = new Float64Array(regions.length+1);
      for (let y=0;y<height;y++) {
        const row = Math.floor(y/step)*cols;
        for (let x=0;x<width;x++) {
          const i = (y*width+x)*4;
          errors[labels[row+Math.floor(x/step)]] += Math.abs(source.data[i]-snapshot.data[i])
            + Math.abs(source.data[i+1]-snapshot.data[i+1])
            + Math.abs(source.data[i+2]-snapshot.data[i+2]);
        }
      }
      return errors;
    }
    let best = ctx.getImageData(0,0,width,height);
    let errors = difference(best);
    const refinements = [];
    const modes = ['edge','shadow','light','texture'];
    for (const [pass,mode] of modes.entries()) {
      report(`Уточняю детали · ${pass+1}/${modes.length}`,78+pass*5);
      const marks = finishPlan(ctx,reference,detail,mode,areas,Boolean(focus));
      for (const mark of marks) stroke(ctx,mark);
      const candidate = ctx.getImageData(0,0,width,height);
      const nextErrors = difference(candidate);
      const accepted = marks.filter(mark=>nextErrors[mark.area]<errors[mark.area]);
      if (accepted.length!==marks.length) {
        ctx.putImageData(best,0,0);
        for (const mark of accepted) stroke(ctx,mark);
      }
      best = ctx.getImageData(0,0,width,height);
      errors = difference(best);
      refinements.push(...accepted);
    }
    stages.push(refinements);
    if (exact) report('Прокладываю финальные уточнения вдоль контуров',98);
    const tail = (stages[3].at(-1) || stages[2].at(-1))?.points.at(-1);
    const corrections = exact ? correctionPaths(best,source,tail) : null;
    self.postMessage({stages,corrections});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
