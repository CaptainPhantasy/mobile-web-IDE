export type IdeSurfaceIdentity = {
  surface_id: 'ide';
  source_root: string;
  source_commit: string;
};

/** Runtime provenance only: never infer or hardcode an admitted commit. */
export function ideSurfaceIdentity(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): IdeSurfaceIdentity {
  return {
    surface_id: 'ide',
    source_root: cwd,
    source_commit: env.FLOYD_SURFACE_COMMIT || 'unverified',
  };
}

export function ideHealthPayload(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
) {
  return {
    status: 'ok',
    service: 'mobile-web-ide',
    time: now.toISOString(),
    identity: ideSurfaceIdentity(env, cwd),
  };
}
