import {paper,plan,stroke} from './paint.mjs?v=preflight';
import {finishPlan} from './finish.mjs?v=preflight';

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
    report('Уточняю края, тени и блики',92);
    const accents = finishPlan(ctx,reference,detail);
    for (const mark of accents) stroke(ctx,mark);
    report('Проверяю пропуски после пробного прохода',95);
    const repairs = finishPlan(ctx,reference,detail);
    for (const mark of repairs) stroke(ctx,mark);
    stages.push([...accents,...repairs]);
    report('Прокладываю уточнения вдоль контуров',98);
    const corrections = correctionPaths(ctx.getImageData(0,0,proof.width,proof.height),
      reference.getContext('2d').getImageData(0,0,reference.width,reference.height),stages[3].at(-1)?.points.at(-1));
    self.postMessage({stages,corrections});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
