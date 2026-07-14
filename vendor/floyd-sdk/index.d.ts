export class FloydApiError extends Error {
  readonly status:number; readonly payload:unknown;
  constructor(method:string,path:string,status:number,payload:unknown);
}
export const FLOYD_EXPERIENCE_VERSION:'1.0.0';
export const FLOYD_SDK_PROTOCOL_VERSION:'1.0.0';
export interface ExperienceEnvelope {
  id:string; schema_version:'1.0.0'; revision:number;
  active:{project_id:string|null;session_id:string|null;run_id:string|null};
  model_route:{provider:string|null;model:string|null;base_url:string|null;provider_profile_id:string|null;credential_ref:string|null};
  transcript_cursor:number; transcript_epoch:string|null; last_event_id:string|null;
  pending_questions:unknown[]; pending_permissions:unknown[]; composer_draft:string;
  selected_artifact_id:string|null; selected_view:string;
  surfaces:Record<string,{surface_id:string;sdk_version:string;envelope_version:string;capabilities:string[];transcript_cursor:number;transcript_epoch:string|null;last_event_id:string|null;last_seen_at:string}>;
  updated_at:string; updated_by_device_id:string|null;
}
export interface ExperienceEnvelopePatch {
  expected_revision:number;
  active?:Partial<ExperienceEnvelope['active']>;
  composer_draft?:string; selected_artifact_id?:string|null; selected_view?:string;
  transcript_cursor?:number; transcript_epoch?:string|null; last_event_id?:string|null;
}
export class FloydClient {
  constructor(options:{baseUrl?:string;token:string|(()=>string|Promise<string>);fetch?:typeof globalThis.fetch});
  health(signal?:AbortSignal):Promise<Record<string,unknown>>;
  state(signal?:AbortSignal):Promise<{projects:Array<{id:string;name:string;root_path:string}>}>;
  registerProject(input:{name:string;root_path:string;test_command?:string},signal?:AbortSignal):Promise<{id:string}>;
  submit(projectId:string,goal:string,signal?:AbortSignal):Promise<{run_id:string}>;
  run(runId:string,signal?:AbortSignal):Promise<Record<string,unknown>>;
  artifactById(artifactId:string,signal?:AbortSignal):Promise<unknown>;
  steer(sessionId:string,text:string,actor:string,signal?:AbortSignal,runId?:string):Promise<unknown>;
  negotiateExperience(input:{surface_id:string;capabilities:string[];sdk_version?:string;supported_envelope_versions?:string[]},signal?:AbortSignal):Promise<{accepted:boolean;envelope_version:string|null;core_protocol_version:string;minimum_sdk_version:string;reason?:string}>;
  experience(envelopeId?:string,signal?:AbortSignal):Promise<ExperienceEnvelope>;
  updateExperience(envelopeId:string,patch:ExperienceEnvelopePatch,signal?:AbortSignal):Promise<ExperienceEnvelope>;
  watchExperience(envelopeId?:string,options?:{lastEventId?:string;signal?:AbortSignal}):AsyncGenerator<{id?:string;type:string;data:ExperienceEnvelope}>;
  attachSession(sessionId:string,actor:string,options?:{lastEventId?:string;signal?:AbortSignal;runId?:string}):AsyncGenerator<{id?:string;type:string;data:unknown}>;
}
