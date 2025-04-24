import { SongState } from './songState';

declare class PBUIState {
    update(songStates: { [bsr: string]: SongState }, currentFlowStep: number): Promise<void>;
    get<T>(key: string): T | undefined;
    reset(): Promise<void>;
}

declare class Tournaments {
    get(tournamentId?: string | number, param?: string, logging?: boolean): void;
    getPool<T>(poolId: number): T | undefined;
    create<T>(info: { name?: string, slug?: string, tourneyId?: number, poolName?: string, poolId?: number, hash?: string, diff?: 'Easy' | 'Normal' | 'Hard' | 'Expert' | 'ExpertPlus' }, authToken: string, element?: 'tournament' | 'pool' | 'map', ): T | undefined;
}

export declare class PBUI {
    state: PBUIState;
    tournaments: Tournaments;

    connect(url?: string, options?: { transports?: string[]; secure?: boolean; timeout?: number }): Promise<void>;
    subscribe(event: string, listener: (data: any) => void): Promise<void>;
    unsubscribe(event: string, listener: (data: any) => void): Promise<void>;
    disconnect(): Promise<void>;
    on(event: string, callback: (data: any) => void): void;
    send(event: string, data:any): void;
    setApiBase(url: string): void;
    setAuthToken(token: string): void;
    upload(file: File | Blob, filename: string): void;
}

export default PBUI;
export type { SongState } from './songState';