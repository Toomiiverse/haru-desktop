import json
import time
import urllib.request

for attempt in range(30):
    try:
        req=urllib.request.Request('http://127.0.0.1:11437/api/embed',
            data=json.dumps({'model':'nomic-embed-text','input':'search_query: readiness',
                             'keep_alive':-1,'options':{'num_gpu':0}}).encode(),
            headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=20) as r: result=json.load(r)
        assert len(result['embeddings'])==1 and len(result['embeddings'][0])==768
        with urllib.request.urlopen('http://127.0.0.1:11437/api/ps',timeout=3) as r: models=json.load(r)['models']
        assert models and all(m['size_vram']==0 for m in models)
        print('CPU embedding service ready',flush=True)
        break
    except Exception:
        if attempt==29: raise
        time.sleep(1)
