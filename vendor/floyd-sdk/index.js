export class FloydApiError extends Error {
  constructor(method,path,status,payload){super(`${method} ${path} -> ${status}: ${typeof payload==='string'?payload:JSON.stringify(payload)}`);this.name='FloydApiError';this.status=status;this.payload=payload;}
}
export class FloydClient {
  constructor({baseUrl='http://127.0.0.1:41414',token,fetch:fetchImpl=globalThis.fetch}){this.baseUrl=baseUrl.replace(/\/+$/,'');this.tokenSource=token;this.fetchImpl=fetchImpl.bind(globalThis);}
  async token(){return typeof this.tokenSource==='function'?this.tokenSource():this.tokenSource;}
  async request(method,path,body,signal){const response=await this.fetchImpl(this.baseUrl+path,{method,headers:{authorization:`Bearer ${await this.token()}`,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal});const text=await response.text();let payload=text;try{payload=JSON.parse(text);}catch{}if(!response.ok)throw new FloydApiError(method,path,response.status,payload);return payload;}
  health(signal){return this.request('GET','/api/health',undefined,signal)}
  state(signal){return this.request('GET','/api/state',undefined,signal)}
  registerProject(input,signal){return this.request('POST','/api/projects',input,signal)}
  submit(projectId,goal,signal){return this.request('POST','/api/runs',{project_id:projectId,goal},signal)}
  run(runId,signal){return this.request('GET',`/api/runs/${encodeURIComponent(runId)}`,undefined,signal)}
  steer(sessionId,text,actor,signal){return this.request('POST',`/api/sessions/${encodeURIComponent(sessionId)}/steer`,{type:'steer',text,actor},signal)}
  async *stream(path,{method='GET',body,signal}={}){const response=await this.fetchImpl(this.baseUrl+path,{method,headers:{authorization:`Bearer ${await this.token()}`,accept:'text/event-stream',...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal});if(!response.ok||!response.body)throw new FloydApiError(method,path,response.status,await response.text());const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';try{for(;;){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replace(/\r\n?/g,'\n');const frames=buffer.split('\n\n');buffer=frames.pop()||'';for(const frame of frames){let id,type='message';const lines=[];for(const line of frame.split('\n')){if(line.startsWith('id:'))id=line.slice(3).trim();else if(line.startsWith('event:'))type=line.slice(6).trim();else if(line.startsWith('data:'))lines.push(line.slice(5).trimStart());}if(!lines.length)continue;const raw=lines.join('\n');let data=raw;try{data=JSON.parse(raw);}catch{}yield {...(id?{id}:{}),type,data};}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
  attachSession(sessionId,actor,options={}){return this.stream(`/api/sessions/${encodeURIComponent(sessionId)}/attach`,{method:'POST',body:{actor},signal:options.signal})}
}
