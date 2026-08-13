import olefile, zlib, struct, sys, glob, os
def recs(buf):
    i=0
    while i+4<=len(buf):
        h,=struct.unpack('<I',buf[i:i+4]); i+=4
        tag=h&0x3FF; lvl=(h>>10)&0x3FF; sz=(h>>20)&0xFFF
        if sz==0xFFF: sz,=struct.unpack('<I',buf[i:i+4]); i+=4
        yield tag,lvl,buf[i:i+sz]; i+=sz
for p in sorted(glob.glob('/home/mhchoi/MWreports/*.hwp')):
    o=olefile.OleFileIO(p)
    raw=zlib.decompress(o.openstream('BodyText/Section0').read(),-15)
    print('###', os.path.basename(p))
    tno=0; spans=set()
    for tag,lvl,d in recs(raw):
        if tag==77:
            prop,nr,nc=struct.unpack('<IHH',d[0:8])
            rs=struct.unpack('<%dH'%nr, d[18:18+2*nr])
            tno+=1
            print(f'   table{tno}: rows={nr} cols={nc} cellsPerRow={rs} recLen={len(d)} trailing={len(d)-18-2*nr}B')
        if tag==72 and len(d)>=16:
            col,row,cs,rs_=struct.unpack('<HHHH', d[8:16])
            spans.add((cs,rs_))
    print('   distinct (colSpan,rowSpan) across all cells:', sorted(spans))
