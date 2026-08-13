import olefile, zlib, struct, sys, hashlib

def parse(buf):
    recs=[]; i=0
    while i+4 <= len(buf):
        (h,)=struct.unpack('<I', buf[i:i+4]); i+=4
        tag=h&0x3FF; lvl=(h>>10)&0x3FF; sz=(h>>20)&0xFFF; ext=False
        if sz==0xFFF:
            (sz,)=struct.unpack('<I', buf[i:i+4]); i+=4; ext=True
        recs.append([tag,lvl,bytearray(buf[i:i+sz]),ext]); i+=sz
    return recs

def build(recs):
    out=bytearray()
    for tag,lvl,d,ext in recs:
        sz=len(d)
        if sz>=0xFFF or ext:
            out+=struct.pack('<I',(tag&0x3FF)|((lvl&0x3FF)<<10)|(0xFFF<<20))
            out+=struct.pack('<I',sz)
        else:
            out+=struct.pack('<I',(tag&0x3FF)|((lvl&0x3FF)<<10)|(sz<<20))
        out+=d
    return bytes(out)

p=sys.argv[1]
o=olefile.OleFileIO(p)
raw=zlib.decompress(o.openstream('BodyText/Section0').read(), -15)
recs=parse(raw)
rebuilt=build(recs)
print('records parsed :', len(recs))
print('orig  bytes    :', len(raw), hashlib.sha256(raw).hexdigest()[:16])
print('rebuilt bytes  :', len(rebuilt), hashlib.sha256(rebuilt).hexdigest()[:16])
print('BYTE-IDENTICAL :', raw==rebuilt)
# also DocInfo
di=zlib.decompress(o.openstream('DocInfo').read(), -15)
dr=parse(di)
print('DocInfo round-trip:', build(dr)==di, f'({len(dr)} records)')
