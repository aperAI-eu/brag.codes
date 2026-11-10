#!/usr/bin/env python3
"""Bounded synthetic TEST smoke through public TLS, with provider dispatch paused.

Only the generated users/event/jobs are removed. No secret or proposal is printed.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
import http.client
import io
import json
from pathlib import Path
import socket
import struct
import subprocess
import time
from urllib.parse import quote, urlsplit
import uuid
import wave

ORIGIN = 'https://example.invalid'
WEB = 'UNCONFIGURED_TEST_WEB'
DB = 'UNCONFIGURED_TEST_DATABASE'
AUTH_FILE = Path('/nonexistent/test-session-secret')
COOKIE_PREFIX = '__Secure-brag.session_token='

def query(sql):
    result = subprocess.run(['docker','exec','-i',DB,'psql','-U','postgres','-d','brag','-At','-v','ON_ERROR_STOP=1'],input=sql,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Synthetic smoke database operation failed')
    return result.stdout.strip()

def literal(value):
    return "'" + str(value).replace("'", "''") + "'"

def paused():
    values=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .Config.Env}}',WEB],text=True))
    if 'BRAG_PITCH_WORKER_PAUSED=1' not in values:
        raise RuntimeError('Transport smoke requires provider dispatch paused')

def connect():
    return http.client.HTTPSConnection('example.invalid',timeout=70)

def request(account, method, route, body=None):
    connection=connect()
    try:
        payload=None if body is None else json.dumps(body).encode()
        headers={'Cookie':account['cookie'],'Origin':ORIGIN,'X-Capture-Contract':'share-work-v1','Idempotency-Key':str(uuid.uuid4()),'Content-Type':'application/json'}
        connection.request(method,route,payload,headers)
        response=connection.getresponse()
        return response.status,json.loads(response.read(131072))
    finally:
        connection.close()

def upload(account, body=None, rate=0, started=None, disconnect=None):
    connection=connect()
    begin=time.monotonic()
    try:
        connection.putrequest('POST','/api/v1/drafts/'+account['draft']+'/pitches')
        for key,value in {'Cookie':account['cookie'],'Origin':ORIGIN,'X-Capture-Contract':'share-work-v1','Idempotency-Key':str(uuid.uuid4()),'Content-Type':'audio/wav','Transfer-Encoding':'chunked','X-Draft-Version':'1','X-Processing-Policy':'pitch-30s-pause-auto-distill-claude-v3'}.items():
            connection.putheader(key,value)
        connection.endheaders()
        if started: started.set()
        if disconnect is not None:
            disconnect.wait(10)
            return None
        if body is not None:
            size=rate//80 if rate else len(body)
            for offset in range(0,len(body),size):
                chunk=body[offset:offset+size]
                connection.send(('%x\r\n'%len(chunk)).encode()+chunk+b'\r\n')
                if rate and offset+size<len(body):time.sleep(.1)
            connection.send(b'0\r\n\r\n')
        response=connection.getresponse()
        data=json.loads(response.read(131072))
        return {'status':response.status,'code':data.get('error',{}).get('code'),'elapsedMs':round((time.monotonic()-begin)*1000)}
    finally:
        connection.close()

def require(condition, message):
    if not condition:raise RuntimeError(message)

def cleanup_audio(ids):
    # Only these UUID paths are removed; no volume or unrelated audio is touched.
    cleanup=subprocess.run(['docker','exec','-i',WEB,'node','-e',"const fs=require('fs');for(const id of JSON.parse(fs.readFileSync(0,'utf8'))){if(!/^[a-f0-9-]{36}$/.test(id))process.exit(1);fs.rmSync('/var/lib/brag/pitches/'+id+'.wav',{force:true});}"],input=json.dumps(ids),text=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    require(cleanup.returncode==0,'Synthetic audio cleanup failed')

def http2_probe(accounts):
    script=Path(__file__).with_name('transport-http2.mjs').read_text()
    probe=subprocess.run(['docker','exec','-i',WEB,'node','--input-type=module','-e',script],input=json.dumps({'origin':ORIGIN,'requestOrigin':ORIGIN,'accounts':accounts}),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=80)
    require(probe.returncode==0,'Public HTTP/2 intake qualification failed')
    return json.loads(probe.stdout)

def smoke():
    paused()
    event=str(uuid.uuid4())
    accounts=[]
    secret=AUTH_FILE.read_text().strip().encode()
    fields={'schema_version':1,'language':None,'title':'','problem':'','description':'','project_url':'','repository_url':'','details':{'core_idea':'','capabilities':[],'constraints':[],'limitations':[],'stack':[],'patterns':[],'process':{'tools':[],'workflow':'','hours_bucket':None,'agent_share':None,'gotchas':'','would_build_again':None},'reality_level':None,'looking_for':[],'can_demo':None,'code_license':'','catalogue_text_permission':''}}
    buffer=io.BytesIO()
    with wave.open(buffer,'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(struct.pack('<h',3276)*480000)
    audio=buffer.getvalue()
    results={}
    try:
        query("INSERT INTO brag.event(id,title,timezone,starts_at,submissions_open_at,submissions_close_at,approval,version,generation) VALUES ("+literal(event)+",'Release transport qualification','Europe/Bratislava',now(),now()-interval '1 hour',now()+interval '1 hour','approved',1,1)")
        for _ in range(5):
            owner,session,token,draft=(str(uuid.uuid4()) for _ in range(4))
            signature=base64.b64encode(hmac.new(secret,token.encode(),hashlib.sha256).digest()).decode()
            account={'owner':owner,'draft':draft,'cookie':COOKIE_PREFIX+quote(token+'.'+signature,safe='')}
            query('BEGIN; INSERT INTO brag.auth_user(id,name,email,"updatedAt") VALUES ('+literal(owner)+",'Release fixture',"+literal(owner+'@example.test')+",now()); INSERT INTO brag.auth_session(id,token,\"userId\",\"expiresAt\",\"updatedAt\") VALUES ("+','.join(map(literal,[session,token,owner]))+",now()+interval '10 minutes',now()); INSERT INTO brag.author_event(owner_id,event_id,origin) VALUES ("+','.join(map(literal,[owner,event,'direct_event']))+"); INSERT INTO brag.project_draft(id,owner_id,event_id,fields) VALUES ("+','.join(map(literal,[draft,owner,event,json.dumps(fields)]))+'); COMMIT;')
            accounts.append(account)
        status,context=request(accounts[0],'GET','/api/v1/me/share-context')
        require(status==200,'Synthetic identity/context failed')
        with ThreadPoolExecutor(max_workers=3) as pool:
            rates=[256000,512000,1000000]
            measured=list(pool.map(lambda item:upload(accounts[item[0]],audio,item[1]),enumerate(rates)))
        for rate,result in zip(rates,measured):
            require(result['status']==202 and result['elapsedMs']>=len(audio)*8/rate*1000-1500,'Public shaped upload did not meet admission budget')
        results['shaped']={'bytes':len(audio),'rates':rates,'measurements':measured}
        import threading
        disconnect=threading.Event()
        with ThreadPoolExecutor(max_workers=8) as pool:
            events=[threading.Event() for _ in range(8)]
            futures=[pool.submit(upload,accounts[i//2],None,0,events[i],disconnect) for i in range(8)]
            try:
                for signal in events:require(signal.wait(10),'Stalled intake did not connect')
                time.sleep(1)
                cap=upload(accounts[0]); require(cap['status']==429 and cap['code']=='upload_busy','Per-account upload cap failed')
                cap=upload(accounts[4]); require(cap['status']==503 and cap['code']=='upload_capacity','Process upload cap failed')
            finally:
                disconnect.set()
                for future in futures:future.result()
        time.sleep(.5)
        timeout=upload(accounts[4])
        require(timeout['status']==408 and timeout['code']=='upload_timeout' and 59000<=timeout['elapsedMs']<69000,'Public zero-byte upload did not return application timeout')
        require(upload(accounts[4],audio)['status']==202,'Disconnect/timeout did not release capacity')
        results['zeroByte']=timeout
        results['http2']=http2_probe(accounts)
        # A separate typed project verifies the real author write/history path.
        status,created=request(accounts[0],'POST','/api/v1/drafts',{'event_id':event})
        require(status==201,'Synthetic project creation failed')
        typed=created['draft']; fields['title']='Release qualification';fields['language']='en'
        status,saved=request(accounts[0],'PATCH','/api/v1/drafts/'+typed['id'],{'expected_version':typed['version'],'fields':fields,'review_source':{'method':'typed'}})
        require(status==200 and saved['draft']['review']['state']=='confirmed','Typed project confirmation failed')
        query('UPDATE brag.event SET manually_closed=true WHERE id='+literal(event))
        fields['description']='Saved work remains editable after closure.'; fields['problem']='Synthetic release qualification.'
        status,completed=request(accounts[0],'PATCH','/api/v1/drafts/'+typed['id'],{'expected_version':saved['draft']['version'],'fields':fields,'review_source':{'method':'typed'}})
        require(status==200,'Post-close saved editing failed')
        status,_=request(accounts[0],'POST','/api/v1/drafts',{'event_id':event})
        require(status==409,'Closed event admitted new work')
        results['authorFlow']='context, separate typed save, post-close edit and new-work denial passed'
        status,review=request(accounts[0],'POST','/api/v1/projects/'+typed['id']+'/publication-review',{
            'expected_version':completed['draft']['version'],
            'public_author':{'display_name':'Release qualification','contact':{'kind':'profile','value':'https://example.com'}},
            'include':{'project_link':False,'repository_link':False,'details':False}})
        require(status==201,'Publication review failed')
        status,published=request(accounts[0],'POST','/api/v1/projects/'+typed['id']+'/publish',{'review_id':review['review_id']})
        require(status==201 and published['publication_version']==1,'Post-close publication failed')
        status,public=request({'cookie':''},'GET','/api/v1/projects/'+typed['id'])
        require(status==200 and public['project']['content']==review['public_project'],'Anonymous publication differs from reviewed projection')
        status,listing=request({'cookie':''},'GET','/api/v1/events/'+event+'/projects')
        require(status==200 and any(p['id']==typed['id'] for p in listing['projects']),'Published event listing failed')
        results['publication']='reviewed snapshot, post-close publish, anonymous detail and event listing passed'

        return results
    finally:
        paused()
        if accounts:
            owners=','.join(literal(a['owner']) for a in accounts)
            require(query('SELECT count(*) FROM brag.voice_pitch WHERE owner_id IN ('+owners+") AND (status<>'queued' OR provider_id IS NOT NULL OR attempts<>0)")=='0','Synthetic work advanced unexpectedly; retain it for recovery review')
            ids=json.loads(query('SELECT COALESCE(json_agg(id),\'[]\') FROM brag.voice_pitch WHERE owner_id IN ('+owners+')'))
            query('BEGIN; DELETE FROM brag.auth_throttle WHERE key IN ('+','.join(literal(prefix+a['owner']) for a in accounts for prefix in ['projects:','sharing:','publication:'])+'); DELETE FROM brag.event_appearance WHERE project_id IN (SELECT id FROM brag.project_draft WHERE owner_id IN ('+owners+')); DELETE FROM brag.project_public_state WHERE owner_id IN ('+owners+'); DELETE FROM brag.project_publication WHERE owner_id IN ('+owners+'); DELETE FROM brag.publication_review WHERE owner_id IN ('+owners+'); DELETE FROM brag.publication_mutation WHERE actor_id IN ('+owners+'); DELETE FROM brag.project_admission WHERE owner_id IN ('+owners+'); DELETE FROM brag.voice_pitch WHERE owner_id IN ('+owners+'); DELETE FROM brag.draft_mutation WHERE actor_id IN ('+owners+'); DELETE FROM brag.project_draft WHERE owner_id IN ('+owners+'); DELETE FROM brag.author_event_mutation WHERE actor_id IN ('+owners+'); DELETE FROM brag.author_event WHERE owner_id IN ('+owners+'); DELETE FROM brag.auth_session WHERE "userId" IN ('+owners+'); DELETE FROM brag.auth_user WHERE id IN ('+owners+'); COMMIT;')
            cleanup_audio(ids)
        removed=query('DELETE FROM brag.event WHERE id='+literal(event)+' AND NOT EXISTS (SELECT 1 FROM brag.author_event WHERE event_id='+literal(event)+') AND NOT EXISTS (SELECT 1 FROM brag.project_draft WHERE event_id='+literal(event)+') RETURNING id')
        require(removed.splitlines()[0]==event,'Synthetic event has other references; retained for review')

