import {paper,plan,stroke} from './paint.mjs?v=preflight';
import {finishPlan} from './finish.mjs?v=refinement';

import {correctionPaths} from './restore.mjs?v=precision';

self.onmessage = ({data:{bitmap,brush,detail,focus}}) => {
  const report = (label,value) => self.postMessage({label,value});
  try {
    const reference = new OffscreenCanvas(bitmap.width,bitmap.height);
    reference.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0);
    bitmap.close();
    const stages = plan(reference,brush,detail,focus,report);
    report('Рендерю пробный рисунок',72);
    const proof = new OffscreenCanvas(reference.width,reference.height);
    const ctx = proof.getContext('2d',{willReadFrequently:true,alpha:false});
    ctx.fillStyle = paper;
    ctx.fillRect(0,0,proof.width,proof.height);
    for (const marks of stages) for (const mark of marks) stroke(ctx,mark);
    const {width,height} = proof;
    const source = reference.getContext('2d').getImageData(0,0,width,height);
    function difference(snapshot) {
      let error = 0;
      for (let i=0;i<source.data.length;i+=4) {
        error += Math.abs(source.data[i]-snapshot.data[i])
          + Math.abs(source.data[i+1]-snapshot.data[i+1])
          + Math.abs(source.data[i+2]-snapshot.data[i+2]);
      }
      return error;
    }
    let best = ctx.getImageData(0,0,width,height);
    let error = difference(best);
    const refinements = [];
    const passes = width*height < 420000 ? 6 : 10;
    for (let pass=0;pass<passes;pass++) {
      report(`Сверяю цвета, контуры и пропуски · ${pass+1}/${passes}`,74+pass*23/passes);
      const marks = finishPlan(ctx,reference,detail,pass<passes/2);
      if (!marks.length) break;
      for (const mark of marks) stroke(ctx,mark);
      const candidate = ctx.getImageData(0,0,width,height);
      const nextError = difference(candidate);
      if (nextError < error) {
        best = candidate;
        error = nextError;
        refinements.push(...marks);
      } else {
        ctx.putImageData(best,0,0);
      }
    }
    stages.push(refinements);
    report('Прокладываю финальные уточнения вдоль контуров',98);
    const tail = (stages[3].at(-1) || stages[2].at(-1))?.points.at(-1);
    const corrections = correctionPaths(best,source,tail);
    self.postMessage({stages,corrections});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
