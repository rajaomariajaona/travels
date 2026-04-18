import type { ManualTravelsControls, PatchesOption, TravelPatches, TravelsControls, TravelsOptions, Updater } from './type';
/**
 * Listener callback for state changes
 */
type Listener<S, P extends PatchesOption = {}> = (state: S, patches: TravelPatches<P>, position: number) => void;
/**
 * Core Travels class for managing undo/redo history
 */
export declare class Travels<S, F extends boolean = false, A extends boolean = true, P extends PatchesOption = {}> {
    /**
     * Get the mutable mode
     */
    mutable: boolean;
    private state;
    private position;
    private allPatches;
    private tempPatches;
    private maxHistory;
    private initialState;
    private initialPosition;
    private initialPatches?;
    private autoArchive;
    private options;
    private listeners;
    private pendingState;
    private pendingStateVersion;
    private controlsCache;
    private historyCache;
    private historyVersion;
    private mutableFallbackWarned;
    private mutableRootReplaceWarned;
    constructor(initialState: S, options?: TravelsOptions<F, A>);
    private normalizeInitialHistory;
    private invalidateHistoryCache;
    /**
     * Subscribe to state changes
     * @returns Unsubscribe function
     */
    subscribe: (listener: Listener<S, P>) => () => void;
    /**
     * Notify all listeners of state changes
     */
    private notify;
    /**
     * Check if patches contain root-level replacement operations
     * Root replacement cannot be done mutably as it changes the type/value of the entire state
     */
    private hasRootReplacement;
    /**
     * Get the current state
     */
    getState: () => S;
    /**
     * Update the state
     */
    setState(updater: Updater<S>): void;
    /**
     * Archive the current state (only for manual archive mode)
     */
    archive(): void;
    /**
     * Get all patches including temporary patches
     */
    private getAllPatches;
    /**
     * Get the complete history of states
     *
     * @returns The history array. Reference equality indicates cache hit.
     *
     * @remarks
     * **IMPORTANT**: Do not modify the returned array. It is cached internally.
     * - In development mode, the array is frozen
     * - In production mode, modifications will corrupt the cache
     */
    getHistory(): readonly S[];
    /**
     * Go to a specific position in the history
     */
    go(nextPosition: number): void;
    /**
     * Go back in the history
     */
    back(amount?: number): void;
    /**
     * Go forward in the history
     */
    forward(amount?: number): void;
    /**
     * Reset to the initial state
     */
    reset(): void;
    /**
     * Compress full history and make the current state as initial
     */
    rebase(): void;
    /**
     * Check if it's possible to go back
     */
    canBack(): boolean;
    /**
     * Check if it's possible to go forward
     */
    canForward(): boolean;
    /**
     * Check if it's possible to archive the current state
     */
    canArchive(): boolean;
    /**
     * Get the current position in the history
     */
    getPosition(): number;
    /**
     * Get the patches history
     */
    getPatches(): TravelPatches<P>;
    /**
     * Get the controls object
     */
    getControls(): A extends true ? TravelsControls<S, F, P> : ManualTravelsControls<S, F, P>;
}
export {};
//# sourceMappingURL=travels.d.ts.map