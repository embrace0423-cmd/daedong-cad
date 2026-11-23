"""Inspect only the synthetic DXF created by the real GUI export."""
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1])
raw=p.read_bytes(); text=raw.decode('utf-8'); lines=text.replace('\r\n','\n').split('\n')
if lines[-1]=='': lines.pop()
if len(lines)%2: raise RuntimeError('Incomplete DXF pair')
records=[]; current=None
for i in range(0,len(lines),2):
    code=int(lines[i].strip());value=lines[i+1].strip()
    if code==0: current={'type':value,'fields':[]};records.append(current)
    elif current is not None: current['fields'].append((code,value))
def get(r,n):
    vals=[v for c,v in r['fields'] if c==n]
    if len(vals)!=1: raise RuntimeError(f'Missing or repeated coordinate {n}')
    return float(vals[0])
section=None; entities=[]
for r in records:
    if r['type']=='SECTION': section=next((v for c,v in r['fields'] if c==2),None)
    elif r['type']=='ENDSEC': section=None
    elif section=='ENTITIES': entities.append(r)
types={}
for r in entities: types[r['type']]=types.get(r['type'],0)+1
line_matches=[]
for r in entities:
    if r['type']!='LINE': continue
    a=(get(r,10),get(r,20));b=(get(r,11),get(r,21))
    if (a,b) in (((200,200),(225,200)),((225,200),(200,200))): line_matches.append(r)
if len(line_matches)!=1 or types.get('IMAGE',0) or types.get('DIMENSION',0):
    raise RuntimeError('Unexpected synthetic DXF content')
if types.get('LINE',0)<2: raise RuntimeError('Expected exploded synthetic dimension lines are absent')
print(json.dumps({'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                  'entities':types,'editedLineFound':True,'imageEntities':0,'dimensionEntities':0,
                  'scope':'narrow independent group-code check; not full external CAD interoperability'},ensure_ascii=False))
