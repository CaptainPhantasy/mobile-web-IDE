export type WorkspaceType = 'virtual' | 'local' | 'browser-folder';

export type Workspace = {
  type: WorkspaceType;
  path: string;
  name: string;
  id?: string;
};

export function workspaceKey(ws: Pick<Workspace, 'type' | 'path' | 'id'>): string {
  return `${ws.type}:${ws.id || ws.path}`;
}
