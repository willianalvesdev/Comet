interface Window {
 measurements: {creates:number;titleQueries:number;previewQueries:number;currentWrites:number;disabledWrites:number};
 resetMeasurements:()=>void;
 events:{name:string;detail:unknown}[];
 originalSidebar:Element|null;
 originalDocument:Document;
}
