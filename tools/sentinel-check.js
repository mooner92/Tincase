const CFB = require('cfb'), fs = require('fs');
const NM = 'Sh33tJ5';

const cf = CFB.read(fs.readFileSync('out.hwp'), { type: 'buffer' });
const i = cf.FullPaths.findIndex(p => p.endsWith(NM));
console.log('sentinel index in read model:', i);
if (i >= 0) { cf.FullPaths.splice(i, 1); cf.FileIndex.splice(i, 1); }

const buf = CFB.write(cf, { type: 'buffer' });
const back = CFB.read(buf, { type: 'buffer' });
console.log('sentinel present after strip+write:', back.FullPaths.some(p => p.endsWith(NM)));
console.log('streams:', back.FullPaths.filter((p, j) => back.FileIndex[j].type === 2)
  .map(p => p.replace('Root Entry/', '')).join(', '));
fs.writeFileSync('out-clean.hwp', Buffer.from(buf));
