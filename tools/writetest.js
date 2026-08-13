const CFB=require('cfb'), zlib=require('zlib'), fs=require('fs');
const SRC='/home/mhchoi/MWreports/_draft_M월_W주차_업무실적_및_계획_AI홍보전략실.hwp';
const OUT='/tmp/claude-21963/-home-mhchoi/7cf971a9-b656-4eb6-b9fa-bd722918e8ed/scratchpad/out.hwp';

function parse(buf){const r=[];let i=0;while(i+4<=buf.length){const h=buf.readUInt32LE(i);i+=4;
  const tag=h&0x3FF,lvl=(h>>>10)&0x3FF;let sz=(h>>>20)&0xFFF,ext=false;
  if(sz===0xFFF){sz=buf.readUInt32LE(i);i+=4;ext=true;}
  r.push({tag,lvl,data:buf.subarray(i,i+sz),ext});i+=sz;}return r;}
function build(recs){const parts=[];for(const{tag,lvl,data,ext}of recs){const sz=data.length;
  if(sz>=0xFFF||ext){const h=Buffer.alloc(8);h.writeUInt32LE((tag&0x3FF)|((lvl&0x3FF)<<10)|(0xFFF<<20)>>>0,0);h.writeUInt32LE(sz,4);parts.push(h);}
  else{const h=Buffer.alloc(4);h.writeUInt32LE(((tag&0x3FF)|((lvl&0x3FF)<<10)|(sz<<20))>>>0,0);parts.push(h);}
  parts.push(data);}return Buffer.concat(parts);}

const cf=CFB.read(fs.readFileSync(SRC),{type:'buffer'});
const get=n=>Buffer.from(CFB.find(cf,'/'+n).content);
const sec=zlib.inflateRawSync(get('BodyText/Section0'));
const recs=parse(sec);
console.log('parsed', recs.length, 'records; round-trip identical:', build(recs).equals(sec));

// find PARA_TEXT containing the target, replace text, fix PARA_HEADER nChars
const TARGET='제10차 인사위원회', REPL='AI데이터팀 주간회의 및 시스템 점검 (자동병합 테스트)';
let done=false;
for(let i=0;i<recs.length;i++){
  if(recs[i].tag!==67) continue;
  const s=recs[i].data.toString('ucs2');
  if(!s.startsWith(TARGET)) continue;
  const tail=s.slice(TARGET.length);                 // preserve trailing para marker
  const nd=Buffer.from(REPL+tail,'ucs2');
  console.log(`  PARA_TEXT: ${recs[i].data.length}B -> ${nd.length}B  (tail codeunits=${[...tail].map(c=>c.charCodeAt(0))})`);
  recs[i].data=nd;
  const ph=recs[i-1];                                 // preceding PARA_HEADER
  console.log(`  PARA_HEADER tag=${ph.tag} nChars ${ph.data.readUInt32LE(0)} -> ${nd.length/2}`);
  const pd=Buffer.from(ph.data); pd.writeUInt32LE(((ph.data.readUInt32LE(0)&0x80000000)>>>0 | (nd.length/2))>>>0,0); ph.data=pd;
  done=true; break;
}
if(!done) throw new Error('target not found');

const newSec=zlib.deflateRawSync(build(recs),{level:9});
CFB.utils.cfb_add(cf,'/BodyText/Section0',newSec);
fs.writeFileSync(OUT,Buffer.from(CFB.write(cf,{type:'buffer'})));
console.log('wrote', OUT, fs.statSync(OUT).size,'bytes');
