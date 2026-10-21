export type Cell = string | number | boolean | null;
export type Sheet = { name: string; columns: string[]; rows: Cell[][] };
export type ArtifactSpec = { name: string } & (
    { kind: 'spreadsheet'; sheets: Sheet[] } |
    { kind: 'document'; content: string } |
    { kind: 'text'; content: string; extension: 'txt'|'md'|'json'|'html'|'css'|'js'|'ts'|'py'|'sql'|'yaml' } |
    { kind: 'chart'; chart: 'bar'|'line'|'pie'; labels: string[]; series: {name:string;values:number[]}[] }
);
export type ArtifactFile = {format:string;name:string;size:number};
export type Artifact = {id:string;created_at:string;expires_at?:string;spec:ArtifactSpec;files:ArtifactFile[]};
