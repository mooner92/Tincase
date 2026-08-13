import olefile, zlib, struct, sys

TAGS = {66:'PARA_HEADER',67:'PARA_TEXT',68:'PARA_CHAR_SHAPE',69:'PARA_LINE_SEG',
        70:'PARA_RANGE_TAG',71:'CTRL_HEADER',72:'LIST_HEADER',73:'PAGE_DEF',
        74:'FOOTNOTE_SHAPE',75:'PAGE_BORDER_FILL',76:'SHAPE_COMPONENT',77:'TABLE',
        78:'SHAPE_COMPONENT_LINE',79:'SHAPE_COMPONENT_RECTANGLE'}

def records(buf):
    i=0
    while i+4 <= len(buf):
        (h,) = struct.unpack('<I', buf[i:i+4]); i+=4
        tag = h & 0x3FF; lvl = (h>>10)&0x3FF; sz = (h>>20)&0xFFF
        if sz == 0xFFF:
            (sz,) = struct.unpack('<I', buf[i:i+4]); i+=4
        yield tag, lvl, buf[i:i+sz]
        i += sz

def para_text(d):
    out=[]; i=0
    while i+1 < len(d):
        (c,) = struct.unpack('<H', d[i:i+2])
        if c in (0,10,13,24,25,26,27,28,29,30,31): i+=2   # 1-char ctrl
        elif c in (1,2,3,11,12,14,15,16,17,18,21,22,23):  # 8-char inline/extended
            out.append('�[ctrl%d]'%c); i+=16
        elif c in (4,5,6,7,8,9,19,20): i+=2
        else:
            out.append(chr(c)); i+=2
    return ''.join(out)

p = sys.argv[1]
o = olefile.OleFileIO(p)
fh = o.openstream('FileHeader').read()
compressed = bool(fh[36] & 1)
print('compressed:', compressed, '| version:', fh[32:36].hex())
raw = o.openstream('BodyText/Section0').read()
if compressed: raw = zlib.decompress(raw, -15)
print('section0 decompressed bytes:', len(raw))
print('-'*70)
for tag,lvl,d in records(raw):
    name = TAGS.get(tag, 'TAG%d'%tag)
    pre = '  '*lvl
    if name=='PARA_TEXT':
        t = para_text(d).replace('\r','')
        print(f'{pre}{name} lvl={lvl} len={len(d)}  TEXT={t!r}')
    elif name=='TABLE':
        flags,nrow,ncol = struct.unpack('<IHH', d[0:8])
        print(f'{pre}*** {name} lvl={lvl} rows={nrow} cols={ncol} flags=0x{flags:x} size={len(d)}')
        off=8
        sizes=struct.unpack('<%dH'%nrow, d[off:off+2*nrow]); off+=2*nrow
        print(f'{pre}    cells-per-row={sizes}')
    elif name=='LIST_HEADER':
        npara, = struct.unpack('<i', d[0:4])
        extra = d[6:]
        if len(extra)>=26:
            col,row,ncol,nrow = struct.unpack('<HHHH', extra[20:28] if len(extra)>=28 else extra[:8])
        print(f'{pre}{name} lvl={lvl} nPara={npara} size={len(d)} hex={d[:32].hex()}')
    elif name=='CTRL_HEADER':
        cid = d[0:4][::-1].decode('ascii','replace')
        print(f'{pre}{name} lvl={lvl} id={cid!r} size={len(d)}')
    else:
        print(f'{pre}{name} lvl={lvl} size={len(d)}')
