import { writeFileSync } from 'node:fs';
export function writeAuditPdf(parts, file, footer = 'RCAAS | Private audit | 30 October 2026') {
// Searchable A4 PDF using standard fonts, with fixed wrapping and pagination.
const ascii=(s)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/[^\x20-\x7e]/g,' ');
const wrap=(s,max)=>{const out=[];let line='';for(let word of ascii(s).split(/\s+/)){while(word.length>max){if(line){out.push(line);line='';}out.push(word.slice(0,max));word=word.slice(max);}if((line+' '+word).trim().length>max){out.push(line);line=word;}else line=(line+' '+word).trim();}if(line)out.push(line);return out;};
const pages=[];let lines=[];const flush=()=>{if(lines.length){pages.push(lines);lines=[];}};
for(const part of parts){const h=wrap(part.title,76);if(lines.length+h.length+8>64)flush();if(lines.length)lines.push({text:'',size:10});for(const text of h)lines.push({text,size:13,bold:true});lines.push({text:'',size:10});for(const paragraph of part.body){for(const text of wrap(paragraph,97)){if(lines.length>=64)flush();lines.push({text,size:10});}if(lines.length>=64)flush();lines.push({text:'',size:10});}}flush();
const esc=(s)=>s.replace(/([\\()])/g,'\\$1');const objects=[null];const add=(s)=>{objects.push(s);return objects.length-1;};
const catalog=add(''),tree=add(''),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'),kids=[];
for(let i=0;i<pages.length;i++){let stream='0.12 0.18 0.25 rg\n',y=797;for(const line of pages[i]){stream+=`BT /${line.bold?'F2':'F1'} ${line.size} Tf 44 ${y} Td (${esc(line.text)}) Tj ET\n`;y-=11.3;}stream+=`0.45 0.45 0.45 rg BT /F1 8 Tf 44 25 Td (${ascii(footer)}) Tj ET\nBT /F1 8 Tf 485 25 Td (Page ${i+1} / ${pages.length}) Tj ET\n`;const content=add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));}
objects[catalog]=`<< /Type /Catalog /Pages ${tree} 0 R >>`;objects[tree]=`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k)=>k+' 0 R').join(' ')}] >>`;
let pdf='%PDF-1.4\n';const offsets=[0];for(let i=1;i<objects.length;i++){offsets[i]=Buffer.byteLength(pdf);pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map((n)=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(file,pdf);
return { pages: pages.length, bytes: Buffer.byteLength(pdf) };
}
