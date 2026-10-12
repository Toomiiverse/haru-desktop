import type { WorldState } from './world';
// Native JS already validates its complete version-1 save at this boundary.
export type Neighborhood = { version:1; game:Record<string, any>; lastHour:number; walkers:[string, any][]; relationships:Record<string, number> };
export function createNeighborhood(s:WorldState):Neighborhood;
export function validNeighborhood(value:unknown):boolean;
export function neighborhoodTravel(s:WorldState,target:string):number;
export function tickNeighborhood(s:WorldState,minutes:number):void;
export function neighborhoodView(s:WorldState):Neighborhood;
export function placeName(id:string):string;
export function recordNeighborhoodVisit(s:WorldState):string[];
export function neighborhoodMoment(s:WorldState):{location:string;inside:boolean;moving:boolean;destination:string;nearby:{id:string;name:string}[]};
