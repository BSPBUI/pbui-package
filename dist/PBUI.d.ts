import { SongState } from './songState';

export declare class PBUIState {
    update(songStates: { [bsr: string]: SongState }, currentFlowStep: number): Promise<void>;
    get<T>(key: string): T | undefined;
    reset(): Promise<void>;
}

export declare class PBUI {
    state: PBUIState;

    connect(url?: string, options?: { transports?: string[]; secure?: boolean; timeout?: number }): Promise<void>;
    subscribe(event: string, listener: (data: any) => void): Promise<void>;
    unsubscribe(event: string, listener: (data: any) => void): Promise<void>;
    disconnect(): Promise<void>;
    on(event: string, callback: (data: any) => void): void;
    send(event: string, data:any): void;
    setApiBase(url: string): void;
}

export default PBUI;
export type { SongState } from './songState';