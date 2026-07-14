export class FloydApiError extends Error { readonly status:number; readonly payload:unknown }
export class FloydClient {
  constructor(options:{baseUrl?:string;token:string|(()=>string|Promise<string>);fetch?:typeof globalThis.fetch});
  health(signal?:AbortSignal):Promise<Record<string,unknown>>;
  state(signal?:AbortSignal):Promise<{projects:Array<{id:string;name:string;root_path:string}>}>;
  registerProject(input:{name:string;root_path:string;test_command?:string},signal?:AbortSignal):Promise<{id:string}>;
  submit(projectId:string,goal:string,signal?:AbortSignal):Promise<{run_id:string}>;
  run(runId:string,signal?:AbortSignal):Promise<Record<string,unknown>>;
  steer(sessionId:string,text:string,actor:string,signal?:AbortSignal):Promise<unknown>;
  attachSession(sessionId:string,actor:string,options?:{signal?:AbortSignal}):AsyncGenerator<{id?:string;type:string;data:unknown}>;
}
