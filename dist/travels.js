import { __rest } from "tslib";
import { apply, create, rawReturn, } from 'mutative';
import { isObjectLike, isPlainObject } from './utils';
const tryStructuredClone = (value) => {
    if (typeof globalThis.structuredClone !== 'function') {
        return undefined;
    }
    try {
        return globalThis.structuredClone(value);
    }
    catch (_a) {
        return undefined;
    }
};
const deepCloneValue = (value, seen = new WeakMap()) => {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return seen.get(value);
    }
    if (Array.isArray(value)) {
        const cloned = new Array(value.length);
        seen.set(value, cloned);
        for (let i = 0; i < value.length; i += 1) {
            if (Object.prototype.hasOwnProperty.call(value, i)) {
                cloned[i] = deepCloneValue(value[i], seen);
            }
        }
        return cloned;
    }
    if (value instanceof Map) {
        const cloned = new Map();
        seen.set(value, cloned);
        value.forEach((entryValue, entryKey) => {
            cloned.set(deepCloneValue(entryKey, seen), deepCloneValue(entryValue, seen));
        });
        return cloned;
    }
    if (value instanceof Set) {
        const cloned = new Set();
        seen.set(value, cloned);
        value.forEach((entryValue) => {
            cloned.add(deepCloneValue(entryValue, seen));
        });
        return cloned;
    }
    if (value instanceof Date) {
        const cloned = new Date(value.getTime());
        seen.set(value, cloned);
        return cloned;
    }
    const structuredCloneValue = tryStructuredClone(value);
    if (structuredCloneValue !== undefined) {
        seen.set(value, structuredCloneValue);
        return structuredCloneValue;
    }
    if (!isPlainObject(value) && Object.getPrototypeOf(value) !== null) {
        return value;
    }
    const cloned = {};
    seen.set(value, cloned);
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            cloned[key] = deepCloneValue(value[key], seen);
        }
    }
    return cloned;
};
const cloneTravelPatches = (base) => ({
    patches: base
        ? base.patches.map((patch) => patch.map((operation) => deepCloneValue(operation)))
        : [],
    inversePatches: base
        ? base.inversePatches.map((patch) => patch.map((operation) => deepCloneValue(operation)))
        : [],
});
const deepClone = (source, target) => {
    if (target && source && typeof source === 'object') {
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                target[key] = deepCloneValue(source[key]);
            }
        }
        return target;
    }
    return deepCloneValue(source);
};
const cloneInitialSnapshot = (value) => {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    const structuredCloneValue = tryStructuredClone(value);
    if (structuredCloneValue !== undefined) {
        return structuredCloneValue;
    }
    return deepClone(value);
};
const hasOnlyArrayIndices = (value) => {
    if (!Array.isArray(value)) {
        return false;
    }
    const keys = Reflect.ownKeys(value);
    const hasOnlyIndices = keys.every((key) => {
        if (key === 'length') {
            return true;
        }
        if (typeof key === 'symbol') {
            return false;
        }
        const index = Number(key);
        return Number.isInteger(index) && index >= 0 && String(index) === key;
    });
    if (!hasOnlyIndices) {
        return false;
    }
    // Sparse arrays cannot be safely synchronized with in-place patches.
    return Object.keys(value).length === value.length;
};
const isPatchHistoryEntries = (value) => {
    return Array.isArray(value) && value.every((entry) => Array.isArray(entry));
};
const getInitialPatchesValidationError = (initialPatches) => {
    if (!initialPatches) {
        return null;
    }
    if (!isPatchHistoryEntries(initialPatches.patches) ||
        !isPatchHistoryEntries(initialPatches.inversePatches)) {
        return `initialPatches must have 'patches' and 'inversePatches' arrays`;
    }
    if (initialPatches.patches.length !== initialPatches.inversePatches.length) {
        return `initialPatches.patches and initialPatches.inversePatches must have the same length`;
    }
    return null;
};
// Align mutable value updates with immutable replacements by syncing objects
const overwriteDraftWith = (draft, value) => {
    const draftIsArray = Array.isArray(draft);
    const valueIsArray = Array.isArray(value);
    const draftKeys = Reflect.ownKeys(draft);
    for (const key of draftKeys) {
        if (draftIsArray && key === 'length') {
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            delete draft[key];
        }
    }
    if (draftIsArray && valueIsArray) {
        draft.length = value.length;
    }
    Object.assign(draft, value);
};
/**
 * Core Travels class for managing undo/redo history
 */
export class Travels {
    constructor(initialState, options = {}) {
        this.listeners = new Set();
        this.pendingState = null;
        this.pendingStateVersion = 0;
        this.controlsCache = null;
        this.historyCache = null;
        this.historyVersion = 0;
        this.mutableFallbackWarned = false;
        this.mutableRootReplaceWarned = false;
        /**
         * Subscribe to state changes
         * @returns Unsubscribe function
         */
        this.subscribe = (listener) => {
            this.listeners.add(listener);
            return () => {
                this.listeners.delete(listener);
            };
        };
        /**
         * Get the current state
         */
        this.getState = () => this.state;
        const { maxHistory = 10, initialPatches: inputInitialPatches, initialPosition: inputInitialPosition = 0, strictInitialPatches = false, autoArchive = true, mutable = false, patchesOptions } = options, mutativeOptions = __rest(options, ["maxHistory", "initialPatches", "initialPosition", "strictInitialPatches", "autoArchive", "mutable", "patchesOptions"]);
        let initialPatches = inputInitialPatches;
        let initialPosition = inputInitialPosition;
        // Validate and enforce maxHistory constraints
        if (typeof maxHistory !== 'number' ||
            !Number.isFinite(maxHistory) ||
            !Number.isInteger(maxHistory)) {
            throw new Error(`Travels: maxHistory must be a non-negative integer, but got ${maxHistory}`);
        }
        if (maxHistory < 0) {
            throw new Error(`Travels: maxHistory must be non-negative, but got ${maxHistory}`);
        }
        if (maxHistory === 0 && process.env.NODE_ENV !== 'production') {
            console.warn('Travels: maxHistory is 0, which disables undo/redo history. This is rarely intended.');
        }
        const initialPatchesValidationError = getInitialPatchesValidationError(initialPatches);
        if (initialPatchesValidationError) {
            if (strictInitialPatches) {
                throw new Error(`Travels: ${initialPatchesValidationError}`);
            }
            if (process.env.NODE_ENV !== 'production') {
                console.warn(`Travels: ${initialPatchesValidationError}. Falling back to empty history. ` +
                    `Set strictInitialPatches: true to throw instead.`);
            }
            initialPatches = undefined;
            initialPosition = 0;
        }
        this.state = initialState;
        // For mutable mode, deep clone initialState to prevent mutations
        this.initialState = cloneInitialSnapshot(initialState);
        this.maxHistory = maxHistory;
        this.autoArchive = autoArchive;
        this.mutable = mutable;
        this.options = Object.assign(Object.assign({}, mutativeOptions), { enablePatches: patchesOptions !== null && patchesOptions !== void 0 ? patchesOptions : true });
        const { patches: normalizedPatches, position: normalizedPosition } = this.normalizeInitialHistory(initialPatches, initialPosition);
        this.allPatches = normalizedPatches;
        this.initialPatches = initialPatches
            ? cloneTravelPatches(normalizedPatches)
            : undefined;
        this.position = normalizedPosition;
        this.initialPosition = normalizedPosition;
        this.tempPatches = cloneTravelPatches();
    }
    normalizeInitialHistory(initialPatches, initialPosition) {
        const cloned = cloneTravelPatches(initialPatches);
        const total = cloned.patches.length;
        const historyLimit = this.maxHistory > 0 ? this.maxHistory : 0;
        const invalidInitialPosition = typeof initialPosition !== 'number' ||
            !Number.isFinite(initialPosition) ||
            !Number.isInteger(initialPosition);
        let position = invalidInitialPosition ? 0 : initialPosition;
        const clampedPosition = Math.max(0, Math.min(position, total));
        if (process.env.NODE_ENV !== 'production' &&
            (invalidInitialPosition || clampedPosition !== position)) {
            console.warn(`Travels: initialPosition (${initialPosition}) is invalid for available patches (${total}). ` +
                `Using ${clampedPosition} instead.`);
        }
        position = clampedPosition;
        if (total === 0) {
            return { patches: cloned, position: 0 };
        }
        if (historyLimit === 0) {
            if (process.env.NODE_ENV !== 'production') {
                console.warn(`Travels: maxHistory (${this.maxHistory}) discards persisted history.`);
            }
            return { patches: cloneTravelPatches(), position: 0 };
        }
        if (historyLimit >= total) {
            return { patches: cloned, position };
        }
        const trim = total - historyLimit;
        const trimmedBase = {
            patches: cloned.patches.slice(-historyLimit),
            inversePatches: cloned.inversePatches.slice(-historyLimit),
        };
        const trimmed = cloneTravelPatches(trimmedBase);
        const adjustedPosition = Math.max(0, Math.min(historyLimit, position - trim));
        if (process.env.NODE_ENV !== 'production') {
            console.warn(`Travels: initialPatches length (${total}) exceeds maxHistory (${historyLimit}). ` +
                `Trimmed to last ${historyLimit} steps. Position adjusted to ${adjustedPosition}.`);
        }
        return {
            patches: trimmed,
            position: adjustedPosition,
        };
    }
    invalidateHistoryCache() {
        this.historyVersion += 1;
        this.historyCache = null;
    }
    /**
     * Notify all listeners of state changes
     */
    notify() {
        this.listeners.forEach((listener) => listener(this.state, this.getPatches(), this.position));
    }
    /**
     * Check if patches contain root-level replacement operations
     * Root replacement cannot be done mutably as it changes the type/value of the entire state
     */
    hasRootReplacement(patches) {
        return patches.some((patch) => ((Array.isArray(patch.path) && patch.path.length === 0) ||
            patch.path === '') &&
            patch.op === 'replace');
    }
    /**
     * Update the state
     */
    setState(updater) {
        let patches;
        let inversePatches;
        const canUseMutableRoot = this.mutable && isObjectLike(this.state);
        const isFunctionUpdater = typeof updater === 'function';
        const stateIsArray = Array.isArray(this.state);
        const updaterIsArray = Array.isArray(updater);
        const canMutatePlainObjects = !stateIsArray &&
            !updaterIsArray &&
            isPlainObject(this.state) &&
            isPlainObject(updater);
        const canMutateArrays = stateIsArray &&
            updaterIsArray &&
            hasOnlyArrayIndices(this.state) &&
            hasOnlyArrayIndices(updater);
        const canMutateWithValue = canUseMutableRoot &&
            !isFunctionUpdater &&
            (canMutateArrays || canMutatePlainObjects);
        const useMutable = (isFunctionUpdater && canUseMutableRoot) || canMutateWithValue;
        if (this.mutable && !canUseMutableRoot && !this.mutableFallbackWarned) {
            this.mutableFallbackWarned = true;
            if (process.env.NODE_ENV !== 'production') {
                console.warn('Travels: mutable mode requires the state root to be an object. Falling back to immutable updates.');
            }
        }
        if (useMutable) {
            // For observable state: generate patches then apply mutably
            const [nextState, p, ip] = create(this.state, isFunctionUpdater
                ? updater
                : (draft) => {
                    overwriteDraftWith(draft, updater);
                }, this.options);
            patches = p;
            inversePatches = ip;
            if (this.hasRootReplacement(patches)) {
                if (process.env.NODE_ENV !== 'production' &&
                    !this.mutableRootReplaceWarned) {
                    this.mutableRootReplaceWarned = true;
                    console.warn('Travels: mutable mode cannot apply root replacements in place. Falling back to immutable update for this change.');
                }
                // Root replacement cannot be applied mutably; fall back to immutable assignment.
                this.state = nextState;
                this.pendingState = nextState;
            }
            else {
                // Apply patches to mutate the existing state object
                apply(this.state, patches, { mutable: true });
                // Keep the same reference
                this.pendingState = this.state;
            }
        }
        else {
            // For immutable state: create new object
            const [nextState, p, ip] = (typeof updater === 'function'
                ? create(this.state, updater, this.options)
                : create(this.state, () => isObjectLike(updater)
                    ? rawReturn(updater)
                    : updater, this.options));
            patches = p;
            inversePatches = ip;
            this.state = nextState;
            this.pendingState = nextState;
        }
        const pendingStateVersion = ++this.pendingStateVersion;
        // Reset pendingState asynchronously, but only if no newer update landed.
        Promise.resolve().then(() => {
            if (this.pendingStateVersion === pendingStateVersion) {
                this.pendingState = null;
            }
        });
        const hasNoChanges = patches.length === 0 && inversePatches.length === 0;
        if (hasNoChanges) {
            return;
        }
        if (this.autoArchive) {
            const notLast = this.position < this.allPatches.patches.length;
            // Remove all patches after the current position
            if (notLast) {
                this.allPatches.patches.splice(this.position, this.allPatches.patches.length - this.position);
                this.allPatches.inversePatches.splice(this.position, this.allPatches.inversePatches.length - this.position);
            }
            this.allPatches.patches.push(patches);
            this.allPatches.inversePatches.push(inversePatches);
            this.position =
                this.maxHistory < this.allPatches.patches.length
                    ? this.maxHistory
                    : this.position + 1;
            if (this.maxHistory < this.allPatches.patches.length) {
                // Handle maxHistory = 0 case: clear all patches
                if (this.maxHistory === 0) {
                    this.allPatches.patches = [];
                    this.allPatches.inversePatches = [];
                }
                else {
                    this.allPatches.patches = this.allPatches.patches.slice(-this.maxHistory);
                    this.allPatches.inversePatches = this.allPatches.inversePatches.slice(-this.maxHistory);
                }
            }
        }
        else {
            const notLast = this.position <
                this.allPatches.patches.length +
                    Number(!!this.tempPatches.patches.length);
            // Remove all patches after the current position
            if (notLast) {
                this.allPatches.patches.splice(this.position, this.allPatches.patches.length - this.position);
                this.allPatches.inversePatches.splice(this.position, this.allPatches.inversePatches.length - this.position);
            }
            if (!this.tempPatches.patches.length || notLast) {
                this.position =
                    this.maxHistory < this.allPatches.patches.length + 1
                        ? this.maxHistory
                        : this.position + 1;
            }
            if (notLast) {
                this.tempPatches.patches.length = 0;
                this.tempPatches.inversePatches.length = 0;
            }
            this.tempPatches.patches.push(patches);
            this.tempPatches.inversePatches.push(inversePatches);
        }
        this.invalidateHistoryCache();
        this.notify();
    }
    /**
     * Archive the current state (only for manual archive mode)
     */
    archive() {
        var _a;
        if (this.autoArchive) {
            console.warn('Auto archive is enabled, no need to archive manually');
            return;
        }
        if (!this.tempPatches.patches.length)
            return;
        // Use pendingState if available, otherwise use current state
        const stateToUse = ((_a = this.pendingState) !== null && _a !== void 0 ? _a : this.state);
        // Merge temp patches
        const [, patches, inversePatches] = create(stateToUse, (draft) => apply(draft, this.tempPatches.inversePatches.flat().reverse()), this.options);
        this.allPatches.patches.push(inversePatches);
        this.allPatches.inversePatches.push(patches);
        // Respect maxHistory limit
        if (this.maxHistory < this.allPatches.patches.length) {
            // Handle maxHistory = 0 case: clear all patches
            if (this.maxHistory === 0) {
                this.allPatches.patches = [];
                this.allPatches.inversePatches = [];
            }
            else {
                this.allPatches.patches = this.allPatches.patches.slice(-this.maxHistory);
                this.allPatches.inversePatches = this.allPatches.inversePatches.slice(-this.maxHistory);
            }
        }
        // Clear temporary patches after archiving
        this.tempPatches.patches.length = 0;
        this.tempPatches.inversePatches.length = 0;
        this.invalidateHistoryCache();
        this.notify();
    }
    /**
     * Get all patches including temporary patches
     */
    getAllPatches() {
        const shouldArchive = !this.autoArchive && !!this.tempPatches.patches.length;
        if (shouldArchive) {
            return {
                patches: this.allPatches.patches.concat([
                    this.tempPatches.patches.flat(),
                ]),
                inversePatches: this.allPatches.inversePatches.concat([
                    this.tempPatches.inversePatches.flat().reverse(),
                ]),
            };
        }
        return this.allPatches;
    }
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
    getHistory() {
        if (this.historyCache &&
            this.historyCache.version === this.historyVersion) {
            return this.historyCache.history;
        }
        let currentState = this.state;
        const _allPatches = this.getAllPatches();
        const patches = !this.autoArchive && _allPatches.patches.length > this.maxHistory
            ? _allPatches.patches.slice(_allPatches.patches.length - this.maxHistory)
            : _allPatches.patches;
        const inversePatches = !this.autoArchive && _allPatches.inversePatches.length > this.maxHistory
            ? _allPatches.inversePatches.slice(_allPatches.inversePatches.length - this.maxHistory)
            : _allPatches.inversePatches;
        // Build future history
        const futureHistory = [];
        for (let i = this.position; i < patches.length; i++) {
            currentState = apply(currentState, patches[i]);
            futureHistory.push(currentState);
        }
        // Build past history
        currentState = this.state;
        const pastHistory = [];
        for (let i = this.position - 1; i > -1; i--) {
            currentState = apply(currentState, inversePatches[i]);
            pastHistory.push(currentState);
        }
        pastHistory.reverse();
        const history = [...pastHistory, this.state, ...futureHistory];
        this.historyCache = {
            version: this.historyVersion,
            history,
        };
        // In development mode, freeze the history array to prevent accidental mutations
        if (process.env.NODE_ENV !== 'production') {
            Object.freeze(history);
        }
        return history;
    }
    /**
     * Go to a specific position in the history
     */
    go(nextPosition) {
        if (typeof nextPosition !== 'number' || !Number.isFinite(nextPosition)) {
            console.warn(`Can't go to invalid position ${nextPosition}`);
            return;
        }
        if (!Number.isInteger(nextPosition)) {
            const normalizedPosition = Math.trunc(nextPosition);
            console.warn(`Can't go to non-integer position ${nextPosition}. Using ${normalizedPosition} instead.`);
            nextPosition = normalizedPosition;
        }
        const shouldArchive = !this.autoArchive && !!this.tempPatches.patches.length;
        if (shouldArchive) {
            this.archive();
        }
        const _allPatches = this.getAllPatches();
        const back = nextPosition < this.position;
        if (nextPosition > _allPatches.patches.length) {
            console.warn(`Can't go forward to position ${nextPosition}`);
            nextPosition = _allPatches.patches.length;
        }
        if (nextPosition < 0) {
            console.warn(`Can't go back to position ${nextPosition}`);
            nextPosition = 0;
        }
        if (nextPosition === this.position)
            return;
        const inversePatchesForNavigation = shouldArchive && _allPatches.inversePatches.length > 0
            ? _allPatches.inversePatches.map((patch, index, allPatches) => index === allPatches.length - 1 ? [...patch].reverse() : patch)
            : _allPatches.inversePatches;
        const patchesToApply = back
            ? inversePatchesForNavigation
                .slice(-this.maxHistory)
                .slice(nextPosition, this.position)
                .flat()
                .reverse()
            : _allPatches.patches
                .slice(-this.maxHistory)
                .slice(this.position, nextPosition)
                .flat();
        // Can only use mutable mode if:
        // 1. mutable mode is enabled
        // 2. current state is an object
        // 3. patches don't contain root-level replacements (which change the entire state)
        const canGoMutably = this.mutable &&
            isObjectLike(this.state) &&
            !this.hasRootReplacement(patchesToApply);
        if (canGoMutably) {
            // For observable state: mutate in place
            apply(this.state, patchesToApply, { mutable: true });
        }
        else {
            // For immutable state or primitive types: create new state
            this.state = apply(this.state, patchesToApply);
        }
        this.position = nextPosition;
        this.invalidateHistoryCache();
        this.notify();
    }
    /**
     * Go back in the history
     */
    back(amount = 1) {
        this.go(this.position - amount);
    }
    /**
     * Go forward in the history
     */
    forward(amount = 1) {
        this.go(this.position + amount);
    }
    /**
     * Reset to the initial state
     */
    reset() {
        const canResetMutably = this.mutable &&
            isObjectLike(this.state) &&
            isObjectLike(this.initialState);
        if (canResetMutably) {
            // For observable state: use patch system to reset to initial state
            // Generate patches from current state to initial state
            const [, patches] = create(this.state, (draft) => {
                // Clear all properties
                for (const key of Object.keys(draft)) {
                    delete draft[key];
                }
                // Deep copy all properties from initialState
                deepClone(this.initialState, draft);
                if (Array.isArray(draft) && Array.isArray(this.initialState)) {
                    draft.length = this.initialState.length;
                }
            }, this.options);
            apply(this.state, patches, { mutable: true });
        }
        else {
            // For immutable state: restore from a snapshot clone.
            this.state = cloneInitialSnapshot(this.initialState);
        }
        this.position = this.initialPosition;
        this.allPatches = cloneTravelPatches(this.initialPatches);
        this.tempPatches = cloneTravelPatches();
        this.invalidateHistoryCache();
        this.notify();
    }
    /**
     * Compress full history and make the current state as initial
     */
    rebase() {
        this.initialState = cloneInitialSnapshot(this.state);
        this.initialPosition = 0;
        this.initialPatches = undefined;
        this.position = 0;
        this.allPatches = cloneTravelPatches();
        this.tempPatches = cloneTravelPatches();
        this.invalidateHistoryCache();
        this.notify();
    }
    /**
     * Check if it's possible to go back
     */
    canBack() {
        return this.position > 0;
    }
    /**
     * Check if it's possible to go forward
     */
    canForward() {
        const shouldArchive = !this.autoArchive && !!this.tempPatches.patches.length;
        const _allPatches = this.getAllPatches();
        // Temporary patches represent the current state, not a future state
        return shouldArchive
            ? this.position < _allPatches.patches.length - 1
            : this.position < _allPatches.patches.length;
    }
    /**
     * Check if it's possible to archive the current state
     */
    canArchive() {
        return !this.autoArchive && !!this.tempPatches.patches.length;
    }
    /**
     * Get the current position in the history
     */
    getPosition() {
        return this.position;
    }
    /**
     * Get the patches history
     */
    getPatches() {
        const shouldArchive = !this.autoArchive && !!this.tempPatches.patches.length;
        const patchSource = shouldArchive ? this.getAllPatches() : this.allPatches;
        return cloneTravelPatches(patchSource);
    }
    /**
     * Get the controls object
     */
    getControls() {
        if (this.controlsCache) {
            return this.controlsCache;
        }
        const self = this;
        const controls = {
            get position() {
                return self.getPosition();
            },
            getHistory: () => self.getHistory(),
            get patches() {
                return self.getPatches();
            },
            back: (amount) => self.back(amount),
            forward: (amount) => self.forward(amount),
            reset: () => self.reset(),
            go: (position) => self.go(position),
            canBack: () => self.canBack(),
            canForward: () => self.canForward(),
            rebase: () => self.rebase(),
        };
        if (!this.autoArchive) {
            controls.archive = () => self.archive();
            controls.canArchive = () => self.canArchive();
        }
        if (process.env.NODE_ENV !== 'production') {
            Object.freeze(controls);
        }
        this.controlsCache = controls;
        return controls;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhdmVscy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy90cmF2ZWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSxPQUFPLEVBSUwsS0FBSyxFQUNMLE1BQU0sRUFDTixTQUFTLEdBQ1YsTUFBTSxVQUFVLENBQUM7QUFVbEIsT0FBTyxFQUFFLFlBQVksRUFBRSxhQUFhLEVBQUUsTUFBTSxTQUFTLENBQUM7QUFXdEQsTUFBTSxrQkFBa0IsR0FBRyxDQUFJLEtBQVEsRUFBaUIsRUFBRTtJQUN4RCxJQUFJLE9BQVEsVUFBa0IsQ0FBQyxlQUFlLEtBQUssVUFBVSxFQUFFLENBQUM7UUFDOUQsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILE9BQVEsVUFBa0IsQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFNLENBQUM7SUFDekQsQ0FBQztJQUFDLFdBQU0sQ0FBQztRQUNQLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7QUFDSCxDQUFDLENBQUM7QUFFRixNQUFNLGNBQWMsR0FBRyxDQUFDLEtBQVUsRUFBRSxPQUFPLElBQUksT0FBTyxFQUFlLEVBQU8sRUFBRTtJQUM1RSxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDaEQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRUQsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDcEIsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN6QixNQUFNLE1BQU0sR0FBVSxJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDOUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLENB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QixDQUFDO1FBRUQsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsS0FBSyxZQUFZLEVBQUUsQ0FBQztZQUMxQyxNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzFCLENBQUM7UUFFRCxJQUFJLENBQUMsYUFBYSxHQUFHLFFBQVEsQ0FBQztRQUU5QixPQUFPLFFBRTJCLENBQUM7SUFDckMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgdHlwZSBPcHRpb25zIGFzIE11dGF0aXZlT3B0aW9ucyxcbiAgdHlwZSBQYXRjaGVzLFxuICB0eXBlIERyYWZ0LFxuICBhcHBseSxcbiAgY3JlYXRlLFxuICByYXdSZXR1cm4sXG59IGZyb20gJ211dGF0aXZlJztcbmltcG9ydCB0eXBlIHtcbiAgTWFudWFsVHJhdmVsc0NvbnRyb2xzLFxuICBQYXRjaGVzT3B0aW9uLFxuICBUcmF2ZWxQYXRjaGVzLFxuICBUcmF2ZWxzQ29udHJvbHMsXG4gIFRyYXZlbHNPcHRpb25zLFxuICBVcGRhdGVyLFxuICBWYWx1ZSxcbn0gZnJvbSAnLi90eXBlJztcbmltcG9ydCB7IGlzT2JqZWN0TGlrZSwgaXNQbGFpbk9iamVjdCB9IGZyb20gJy4vdXRpbHMnO1xuXG4vKipcbiAqIExpc3RlbmVyIGNhbGxiYWNrIGZvciBzdGF0ZSBjaGFuZ2VzXG4gKi9cbnR5cGUgTGlzdGVuZXI8UywgUCBleHRlbmRzIFBhdGNoZXNPcHRpb24gPSB7fT4gPSAoXG4gIHN0YXRlOiBTLFxuICBwYXRjaGVzOiBUcmF2ZWxQYXRjaGVzPFA+LFxuICBwb3NpdGlvbjogbnVtYmVyXG4pID0+IHZvaWQ7XG5cbmNvbnN0IHRyeVN0cnVjdHVyZWRDbG9uZSA9IDxUPih2YWx1ZTogVCk6IFQgfCB1bmRlZmluZWQgPT4ge1xuICBpZiAodHlwZW9mIChnbG9iYWxUaGlzIGFzIGFueSkuc3RydWN0dXJlZENsb25lICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHRyeSB7XG4gICAgcmV0dXJuIChnbG9iYWxUaGlzIGFzIGFueSkuc3RydWN0dXJlZENsb25lKHZhbHVlKSBhcyBUO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59O1xuXG5jb25zdCBkZWVwQ2xvbmVWYWx1ZSA9ICh2YWx1ZTogYW55LCBzZWVuID0gbmV3IFdlYWtNYXA8b2JqZWN0LCBhbnk+KCkpOiBhbnkgPT4ge1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIGlmIChzZWVuLmhhcyh2YWx1ZSkpIHtcbiAgICByZXR1cm4gc2Vlbi5nZXQodmFsdWUpO1xuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgY29uc3QgY2xvbmVkOiBhbnlbXSA9IG5ldyBBcnJheSh2YWx1ZS5sZW5ndGgpO1xuICAgIHNlZW4uc2V0KHZhbHVlLCBjbG9uZWQpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB2YWx1ZS5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwgaSkpIHtcbiAgICAgICAgY2xvbmVkW2ldID0gZGVlcENsb25lVmFsdWUodmFsdWVbaV0sIHNlZW4pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjbG9uZWQ7XG4gIH1cblxuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBNYXApIHtcbiAgICBjb25zdCBjbG9uZWQgPSBuZXcgTWFwKCk7XG4gICAgc2Vlbi5zZXQodmFsdWUsIGNsb25lZCk7XG4gICAgdmFsdWUuZm9yRWFjaCgoZW50cnlWYWx1ZSwgZW50cnlLZXkpID0+IHtcbiAgICAgIGNsb25lZC5zZXQoZGVlcENsb25lVmFsdWUoZW50cnlLZXksIHNlZW4pLCBkZWVwQ2xvbmVWYWx1ZShlbnRyeVZhbHVlLCBzZWVuKSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGNsb25lZDtcbiAgfVxuXG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFNldCkge1xuICAgIGNvbnN0IGNsb25lZCA9IG5ldyBTZXQoKTtcbiAgICBzZWVuLnNldCh2YWx1ZSwgY2xvbmVkKTtcbiAgICB2YWx1ZS5mb3JFYWNoKChlbnRyeVZhbHVlKSA9PiB7XG4gICAgICBjbG9uZWQuYWRkKGRlZXBDbG9uZVZhbHVlKGVudHJ5VmFsdWUsIHNlZW4pKTtcbiAgICB9KTtcbiAgICByZXR1cm4gY2xvbmVkO1xuICB9XG5cbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIGNvbnN0IGNsb25lZCA9IG5ldyBEYXRlKHZhbHVlLmdldFRpbWUoKSk7XG4gICAgc2Vlbi5zZXQodmFsdWUsIGNsb25lZCk7XG4gICAgcmV0dXJuIGNsb25lZDtcbiAgfVxuXG4gIGNvbnN0IHN0cnVjdHVyZWRDbG9uZVZhbHVlID0gdHJ5U3RydWN0dXJlZENsb25lKHZhbHVlKTtcbiAgaWYgKHN0cnVjdHVyZWRDbG9uZVZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICBzZWVuLnNldCh2YWx1ZSwgc3RydWN0dXJlZENsb25lVmFsdWUpO1xuICAgIHJldHVybiBzdHJ1Y3R1cmVkQ2xvbmVWYWx1ZTtcbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSAhPT0gbnVsbCkge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIGNvbnN0IGNsb25lZDogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICBzZWVuLnNldCh2YWx1ZSwgY2xvbmVkKTtcbiAgZm9yIChjb25zdCBrZXkgaW4gdmFsdWUpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHZhbHVlLCBrZXkpKSB7XG4gICAgICBjbG9uZWRba2V5XSA9IGRlZXBDbG9uZVZhbHVlKHZhbHVlW2tleV0sIHNlZW4pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjbG9uZWQ7XG59O1xuXG5jb25zdCBjbG9uZVRyYXZlbFBhdGNoZXMgPSA8UCBleHRlbmRzIFBhdGNoZXNPcHRpb24gPSB7fT4oXG4gIGJhc2U/OiBUcmF2ZWxQYXRjaGVzPFA+XG4pOiBUcmF2ZWxQYXRjaGVzPFA+ID0+ICh7XG4gIHBhdGNoZXM6IGJhc2VcbiAgICA/IGJhc2UucGF0Y2hlcy5tYXAoKHBhdGNoKSA9PlxuICAgICAgICBwYXRjaC5tYXAoKG9wZXJhdGlvbikgPT4gZGVlcENsb25lVmFsdWUob3BlcmF0aW9uKSlcbiAgICAgIClcbiAgICA6IFtdLFxuICBpbnZlcnNlUGF0Y2hlczogYmFzZVxuICAgID8gYmFzZS5pbnZlcnNlUGF0Y2hlcy5tYXAoKHBhdGNoKSA9PlxuICAgICAgICBwYXRjaC5tYXAoKG9wZXJhdGlvbikgPT4gZGVlcENsb25lVmFsdWUob3BlcmF0aW9uKSlcbiAgICAgIClcbiAgICA6IFtdLFxufSk7XG5cbmNvbnN0IGRlZXBDbG9uZSA9IDxUPihzb3VyY2U6IFQsIHRhcmdldD86IGFueSk6IFQgPT4ge1xuICBpZiAodGFyZ2V0ICYmIHNvdXJjZSAmJiB0eXBlb2Ygc291cmNlID09PSAnb2JqZWN0Jykge1xuICAgIGZvciAoY29uc3Qga2V5IGluIHNvdXJjZSBhcyBhbnkpIHtcbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoc291cmNlLCBrZXkpKSB7XG4gICAgICAgIHRhcmdldFtrZXldID0gZGVlcENsb25lVmFsdWUoKHNvdXJjZSBhcyBhbnkpW2tleV0pO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGFyZ2V0O1xuICB9XG5cbiAgcmV0dXJuIGRlZXBDbG9uZVZhbHVlKHNvdXJjZSk7XG59O1xuXG5jb25zdCBjbG9uZUluaXRpYWxTbmFwc2hvdCA9IDxUPih2YWx1ZTogVCk6IFQgPT4ge1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIGNvbnN0IHN0cnVjdHVyZWRDbG9uZVZhbHVlID0gdHJ5U3RydWN0dXJlZENsb25lKHZhbHVlKTtcbiAgaWYgKHN0cnVjdHVyZWRDbG9uZVZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gc3RydWN0dXJlZENsb25lVmFsdWU7XG4gIH1cblxuICByZXR1cm4gZGVlcENsb25lKHZhbHVlKTtcbn07XG5cbmNvbnN0IGhhc09ubHlBcnJheUluZGljZXMgPSAodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBhbnlbXSA9PiB7XG4gIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBrZXlzID0gUmVmbGVjdC5vd25LZXlzKHZhbHVlKTtcbiAgY29uc3QgaGFzT25seUluZGljZXMgPSBrZXlzLmV2ZXJ5KChrZXkpID0+IHtcbiAgICBpZiAoa2V5ID09PSAnbGVuZ3RoJykge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBrZXkgPT09ICdzeW1ib2wnKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgY29uc3QgaW5kZXggPSBOdW1iZXIoa2V5KTtcbiAgICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihpbmRleCkgJiYgaW5kZXggPj0gMCAmJiBTdHJpbmcoaW5kZXgpID09PSBrZXk7XG4gIH0pO1xuXG4gIGlmICghaGFzT25seUluZGljZXMpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBTcGFyc2UgYXJyYXlzIGNhbm5vdCBiZSBzYWZlbHkgc3luY2hyb25pemVkIHdpdGggaW4tcGxhY2UgcGF0Y2hlcy5cbiAgcmV0dXJuIE9iamVjdC5rZXlzKHZhbHVlKS5sZW5ndGggPT09IHZhbHVlLmxlbmd0aDtcbn07XG5cbmNvbnN0IGlzUGF0Y2hIaXN0b3J5RW50cmllcyA9ICh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIHVua25vd25bXVtdID0+IHtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkodmFsdWUpICYmIHZhbHVlLmV2ZXJ5KChlbnRyeSkgPT4gQXJyYXkuaXNBcnJheShlbnRyeSkpO1xufTtcblxuY29uc3QgZ2V0SW5pdGlhbFBhdGNoZXNWYWxpZGF0aW9uRXJyb3IgPSA8UCBleHRlbmRzIFBhdGNoZXNPcHRpb24gPSB7fT4oXG4gIGluaXRpYWxQYXRjaGVzOiBUcmF2ZWxQYXRjaGVzPFA+IHwgdW5kZWZpbmVkXG4pOiBzdHJpbmcgfCBudWxsID0+IHtcbiAgaWYgKCFpbml0aWFsUGF0Y2hlcykge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgaWYgKFxuICAgICFpc1BhdGNoSGlzdG9yeUVudHJpZXMoaW5pdGlhbFBhdGNoZXMucGF0Y2hlcykgfHxcbiAgICAhaXNQYXRjaEhpc3RvcnlFbnRyaWVzKGluaXRpYWxQYXRjaGVzLmludmVyc2VQYXRjaGVzKVxuICApIHtcbiAgICByZXR1cm4gYGluaXRpYWxQYXRjaGVzIG11c3QgaGF2ZSAncGF0Y2hlcycgYW5kICdpbnZlcnNlUGF0Y2hlcycgYXJyYXlzYDtcbiAgfVxuXG4gIGlmIChpbml0aWFsUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aCAhPT0gaW5pdGlhbFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGBpbml0aWFsUGF0Y2hlcy5wYXRjaGVzIGFuZCBpbml0aWFsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcyBtdXN0IGhhdmUgdGhlIHNhbWUgbGVuZ3RoYDtcbiAgfVxuXG4gIHJldHVybiBudWxsO1xufTtcblxuLy8gQWxpZ24gbXV0YWJsZSB2YWx1ZSB1cGRhdGVzIHdpdGggaW1tdXRhYmxlIHJlcGxhY2VtZW50cyBieSBzeW5jaW5nIG9iamVjdHNcbmNvbnN0IG92ZXJ3cml0ZURyYWZ0V2l0aCA9IChkcmFmdDogRHJhZnQ8YW55PiwgdmFsdWU6IGFueSk6IHZvaWQgPT4ge1xuICBjb25zdCBkcmFmdElzQXJyYXkgPSBBcnJheS5pc0FycmF5KGRyYWZ0KTtcbiAgY29uc3QgdmFsdWVJc0FycmF5ID0gQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG5cbiAgY29uc3QgZHJhZnRLZXlzID0gUmVmbGVjdC5vd25LZXlzKGRyYWZ0IGFzIG9iamVjdCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIGRyYWZ0S2V5cykge1xuICAgIGlmIChkcmFmdElzQXJyYXkgJiYga2V5ID09PSAnbGVuZ3RoJykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodmFsdWUsIGtleSkpIHtcbiAgICAgIGRlbGV0ZSAoZHJhZnQgYXMgYW55KVtrZXkgYXMgYW55XTtcbiAgICB9XG4gIH1cblxuICBpZiAoZHJhZnRJc0FycmF5ICYmIHZhbHVlSXNBcnJheSkge1xuICAgIChkcmFmdCBhcyBhbnlbXSkubGVuZ3RoID0gKHZhbHVlIGFzIGFueVtdKS5sZW5ndGg7XG4gIH1cblxuICBPYmplY3QuYXNzaWduKGRyYWZ0IGFzIG9iamVjdCwgdmFsdWUpO1xufTtcblxuLyoqXG4gKiBDb3JlIFRyYXZlbHMgY2xhc3MgZm9yIG1hbmFnaW5nIHVuZG8vcmVkbyBoaXN0b3J5XG4gKi9cbmV4cG9ydCBjbGFzcyBUcmF2ZWxzPFxuICBTLFxuICBGIGV4dGVuZHMgYm9vbGVhbiA9IGZhbHNlLFxuICBBIGV4dGVuZHMgYm9vbGVhbiA9IHRydWUsXG4gIFAgZXh0ZW5kcyBQYXRjaGVzT3B0aW9uID0ge30sXG4+IHtcbiAgLyoqXG4gICAqIEdldCB0aGUgbXV0YWJsZSBtb2RlXG4gICAqL1xuICBwdWJsaWMgbXV0YWJsZTogYm9vbGVhbjtcbiAgcHJpdmF0ZSBzdGF0ZTogUztcbiAgcHJpdmF0ZSBwb3NpdGlvbjogbnVtYmVyO1xuICBwcml2YXRlIGFsbFBhdGNoZXM6IFRyYXZlbFBhdGNoZXM8UD47XG4gIHByaXZhdGUgdGVtcFBhdGNoZXM6IFRyYXZlbFBhdGNoZXM8UD47XG4gIHByaXZhdGUgbWF4SGlzdG9yeTogbnVtYmVyO1xuICBwcml2YXRlIGluaXRpYWxTdGF0ZTogUztcbiAgcHJpdmF0ZSBpbml0aWFsUG9zaXRpb246IG51bWJlcjtcbiAgcHJpdmF0ZSBpbml0aWFsUGF0Y2hlcz86IFRyYXZlbFBhdGNoZXM8UD47XG4gIHByaXZhdGUgYXV0b0FyY2hpdmU6IEE7XG4gIHByaXZhdGUgb3B0aW9uczogTXV0YXRpdmVPcHRpb25zPFBhdGNoZXNPcHRpb24gfCB0cnVlLCBGPjtcbiAgcHJpdmF0ZSBsaXN0ZW5lcnM6IFNldDxMaXN0ZW5lcjxTLCBQPj4gPSBuZXcgU2V0KCk7XG4gIHByaXZhdGUgcGVuZGluZ1N0YXRlOiBTIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcGVuZGluZ1N0YXRlVmVyc2lvbiA9IDA7XG4gIHByaXZhdGUgY29udHJvbHNDYWNoZTpcbiAgICB8IFRyYXZlbHNDb250cm9sczxTLCBGLCBQPlxuICAgIHwgTWFudWFsVHJhdmVsc0NvbnRyb2xzPFMsIEYsIFA+XG4gICAgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBoaXN0b3J5Q2FjaGU6IHsgdmVyc2lvbjogbnVtYmVyOyBoaXN0b3J5OiBTW10gfSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGhpc3RvcnlWZXJzaW9uID0gMDtcbiAgcHJpdmF0ZSBtdXRhYmxlRmFsbGJhY2tXYXJuZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBtdXRhYmxlUm9vdFJlcGxhY2VXYXJuZWQgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3Rvcihpbml0aWFsU3RhdGU6IFMsIG9wdGlvbnM6IFRyYXZlbHNPcHRpb25zPEYsIEE+ID0ge30pIHtcbiAgICBjb25zdCB7XG4gICAgICBtYXhIaXN0b3J5ID0gMTAsXG4gICAgICBpbml0aWFsUGF0Y2hlczogaW5wdXRJbml0aWFsUGF0Y2hlcyxcbiAgICAgIGluaXRpYWxQb3NpdGlvbjogaW5wdXRJbml0aWFsUG9zaXRpb24gPSAwLFxuICAgICAgc3RyaWN0SW5pdGlhbFBhdGNoZXMgPSBmYWxzZSxcbiAgICAgIGF1dG9BcmNoaXZlID0gdHJ1ZSBhcyBBLFxuICAgICAgbXV0YWJsZSA9IGZhbHNlLFxuICAgICAgcGF0Y2hlc09wdGlvbnMsXG4gICAgICAuLi5tdXRhdGl2ZU9wdGlvbnNcbiAgICB9ID0gb3B0aW9ucztcbiAgICBsZXQgaW5pdGlhbFBhdGNoZXMgPSBpbnB1dEluaXRpYWxQYXRjaGVzO1xuICAgIGxldCBpbml0aWFsUG9zaXRpb24gPSBpbnB1dEluaXRpYWxQb3NpdGlvbjtcblxuICAgIC8vIFZhbGlkYXRlIGFuZCBlbmZvcmNlIG1heEhpc3RvcnkgY29uc3RyYWludHNcbiAgICBpZiAoXG4gICAgICB0eXBlb2YgbWF4SGlzdG9yeSAhPT0gJ251bWJlcicgfHxcbiAgICAgICFOdW1iZXIuaXNGaW5pdGUobWF4SGlzdG9yeSkgfHxcbiAgICAgICFOdW1iZXIuaXNJbnRlZ2VyKG1heEhpc3RvcnkpXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBUcmF2ZWxzOiBtYXhIaXN0b3J5IG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlciwgYnV0IGdvdCAke21heEhpc3Rvcnl9YFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAobWF4SGlzdG9yeSA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYFRyYXZlbHM6IG1heEhpc3RvcnkgbXVzdCBiZSBub24tbmVnYXRpdmUsIGJ1dCBnb3QgJHttYXhIaXN0b3J5fWBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKG1heEhpc3RvcnkgPT09IDAgJiYgcHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykge1xuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAnVHJhdmVsczogbWF4SGlzdG9yeSBpcyAwLCB3aGljaCBkaXNhYmxlcyB1bmRvL3JlZG8gaGlzdG9yeS4gVGhpcyBpcyByYXJlbHkgaW50ZW5kZWQuJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBpbml0aWFsUGF0Y2hlc1ZhbGlkYXRpb25FcnJvciA9XG4gICAgICBnZXRJbml0aWFsUGF0Y2hlc1ZhbGlkYXRpb25FcnJvcihpbml0aWFsUGF0Y2hlcyk7XG5cbiAgICBpZiAoaW5pdGlhbFBhdGNoZXNWYWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgIGlmIChzdHJpY3RJbml0aWFsUGF0Y2hlcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRyYXZlbHM6ICR7aW5pdGlhbFBhdGNoZXNWYWxpZGF0aW9uRXJyb3J9YCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICBgVHJhdmVsczogJHtpbml0aWFsUGF0Y2hlc1ZhbGlkYXRpb25FcnJvcn0uIEZhbGxpbmcgYmFjayB0byBlbXB0eSBoaXN0b3J5LiBgICtcbiAgICAgICAgICAgIGBTZXQgc3RyaWN0SW5pdGlhbFBhdGNoZXM6IHRydWUgdG8gdGhyb3cgaW5zdGVhZC5gXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGluaXRpYWxQYXRjaGVzID0gdW5kZWZpbmVkO1xuICAgICAgaW5pdGlhbFBvc2l0aW9uID0gMDtcbiAgICB9XG5cbiAgICB0aGlzLnN0YXRlID0gaW5pdGlhbFN0YXRlO1xuICAgIC8vIEZvciBtdXRhYmxlIG1vZGUsIGRlZXAgY2xvbmUgaW5pdGlhbFN0YXRlIHRvIHByZXZlbnQgbXV0YXRpb25zXG4gICAgdGhpcy5pbml0aWFsU3RhdGUgPSBjbG9uZUluaXRpYWxTbmFwc2hvdChpbml0aWFsU3RhdGUpO1xuICAgIHRoaXMubWF4SGlzdG9yeSA9IG1heEhpc3Rvcnk7XG4gICAgdGhpcy5hdXRvQXJjaGl2ZSA9IGF1dG9BcmNoaXZlO1xuICAgIHRoaXMubXV0YWJsZSA9IG11dGFibGU7XG4gICAgdGhpcy5vcHRpb25zID0ge1xuICAgICAgLi4ubXV0YXRpdmVPcHRpb25zLFxuICAgICAgZW5hYmxlUGF0Y2hlczogcGF0Y2hlc09wdGlvbnMgPz8gdHJ1ZSxcbiAgICB9O1xuXG4gICAgY29uc3QgeyBwYXRjaGVzOiBub3JtYWxpemVkUGF0Y2hlcywgcG9zaXRpb246IG5vcm1hbGl6ZWRQb3NpdGlvbiB9ID1cbiAgICAgIHRoaXMubm9ybWFsaXplSW5pdGlhbEhpc3RvcnkoaW5pdGlhbFBhdGNoZXMsIGluaXRpYWxQb3NpdGlvbik7XG5cbiAgICB0aGlzLmFsbFBhdGNoZXMgPSBub3JtYWxpemVkUGF0Y2hlcztcbiAgICB0aGlzLmluaXRpYWxQYXRjaGVzID0gaW5pdGlhbFBhdGNoZXNcbiAgICAgID8gY2xvbmVUcmF2ZWxQYXRjaGVzKG5vcm1hbGl6ZWRQYXRjaGVzKVxuICAgICAgOiB1bmRlZmluZWQ7XG4gICAgdGhpcy5wb3NpdGlvbiA9IG5vcm1hbGl6ZWRQb3NpdGlvbjtcbiAgICB0aGlzLmluaXRpYWxQb3NpdGlvbiA9IG5vcm1hbGl6ZWRQb3NpdGlvbjtcblxuICAgIHRoaXMudGVtcFBhdGNoZXMgPSBjbG9uZVRyYXZlbFBhdGNoZXMoKTtcbiAgfVxuXG4gIHByaXZhdGUgbm9ybWFsaXplSW5pdGlhbEhpc3RvcnkoXG4gICAgaW5pdGlhbFBhdGNoZXM6IFRyYXZlbFBhdGNoZXM8UD4gfCB1bmRlZmluZWQsXG4gICAgaW5pdGlhbFBvc2l0aW9uOiBudW1iZXJcbiAgKTogeyBwYXRjaGVzOiBUcmF2ZWxQYXRjaGVzPFA+OyBwb3NpdGlvbjogbnVtYmVyIH0ge1xuICAgIGNvbnN0IGNsb25lZCA9IGNsb25lVHJhdmVsUGF0Y2hlcyhpbml0aWFsUGF0Y2hlcyk7XG4gICAgY29uc3QgdG90YWwgPSBjbG9uZWQucGF0Y2hlcy5sZW5ndGg7XG4gICAgY29uc3QgaGlzdG9yeUxpbWl0ID0gdGhpcy5tYXhIaXN0b3J5ID4gMCA/IHRoaXMubWF4SGlzdG9yeSA6IDA7XG4gICAgY29uc3QgaW52YWxpZEluaXRpYWxQb3NpdGlvbiA9XG4gICAgICB0eXBlb2YgaW5pdGlhbFBvc2l0aW9uICE9PSAnbnVtYmVyJyB8fFxuICAgICAgIU51bWJlci5pc0Zpbml0ZShpbml0aWFsUG9zaXRpb24pIHx8XG4gICAgICAhTnVtYmVyLmlzSW50ZWdlcihpbml0aWFsUG9zaXRpb24pO1xuICAgIGxldCBwb3NpdGlvbiA9IGludmFsaWRJbml0aWFsUG9zaXRpb24gPyAwIDogKGluaXRpYWxQb3NpdGlvbiBhcyBudW1iZXIpO1xuICAgIGNvbnN0IGNsYW1wZWRQb3NpdGlvbiA9IE1hdGgubWF4KDAsIE1hdGgubWluKHBvc2l0aW9uLCB0b3RhbCkpO1xuXG4gICAgaWYgKFxuICAgICAgcHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJyAmJlxuICAgICAgKGludmFsaWRJbml0aWFsUG9zaXRpb24gfHwgY2xhbXBlZFBvc2l0aW9uICE9PSBwb3NpdGlvbilcbiAgICApIHtcbiAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgYFRyYXZlbHM6IGluaXRpYWxQb3NpdGlvbiAoJHtpbml0aWFsUG9zaXRpb259KSBpcyBpbnZhbGlkIGZvciBhdmFpbGFibGUgcGF0Y2hlcyAoJHt0b3RhbH0pLiBgICtcbiAgICAgICAgICBgVXNpbmcgJHtjbGFtcGVkUG9zaXRpb259IGluc3RlYWQuYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBwb3NpdGlvbiA9IGNsYW1wZWRQb3NpdGlvbjtcblxuICAgIGlmICh0b3RhbCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHsgcGF0Y2hlczogY2xvbmVkLCBwb3NpdGlvbjogMCB9O1xuICAgIH1cblxuICAgIGlmIChoaXN0b3J5TGltaXQgPT09IDApIHtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICBgVHJhdmVsczogbWF4SGlzdG9yeSAoJHt0aGlzLm1heEhpc3Rvcnl9KSBkaXNjYXJkcyBwZXJzaXN0ZWQgaGlzdG9yeS5gXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IHBhdGNoZXM6IGNsb25lVHJhdmVsUGF0Y2hlcygpLCBwb3NpdGlvbjogMCB9O1xuICAgIH1cblxuICAgIGlmIChoaXN0b3J5TGltaXQgPj0gdG90YWwpIHtcbiAgICAgIHJldHVybiB7IHBhdGNoZXM6IGNsb25lZCwgcG9zaXRpb24gfTtcbiAgICB9XG5cbiAgICBjb25zdCB0cmltID0gdG90YWwgLSBoaXN0b3J5TGltaXQ7XG4gICAgY29uc3QgdHJpbW1lZEJhc2UgPSB7XG4gICAgICBwYXRjaGVzOiBjbG9uZWQucGF0Y2hlcy5zbGljZSgtaGlzdG9yeUxpbWl0KSxcbiAgICAgIGludmVyc2VQYXRjaGVzOiBjbG9uZWQuaW52ZXJzZVBhdGNoZXMuc2xpY2UoLWhpc3RvcnlMaW1pdCksXG4gICAgfSBhcyBUcmF2ZWxQYXRjaGVzPFA+O1xuXG4gICAgY29uc3QgdHJpbW1lZCA9IGNsb25lVHJhdmVsUGF0Y2hlcyh0cmltbWVkQmFzZSk7XG4gICAgY29uc3QgYWRqdXN0ZWRQb3NpdGlvbiA9IE1hdGgubWF4KFxuICAgICAgMCxcbiAgICAgIE1hdGgubWluKGhpc3RvcnlMaW1pdCwgcG9zaXRpb24gLSB0cmltKVxuICAgICk7XG5cbiAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykge1xuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICBgVHJhdmVsczogaW5pdGlhbFBhdGNoZXMgbGVuZ3RoICgke3RvdGFsfSkgZXhjZWVkcyBtYXhIaXN0b3J5ICgke2hpc3RvcnlMaW1pdH0pLiBgICtcbiAgICAgICAgICBgVHJpbW1lZCB0byBsYXN0ICR7aGlzdG9yeUxpbWl0fSBzdGVwcy4gUG9zaXRpb24gYWRqdXN0ZWQgdG8gJHthZGp1c3RlZFBvc2l0aW9ufS5gXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBwYXRjaGVzOiB0cmltbWVkLFxuICAgICAgcG9zaXRpb246IGFkanVzdGVkUG9zaXRpb24sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgaW52YWxpZGF0ZUhpc3RvcnlDYWNoZSgpOiB2b2lkIHtcbiAgICB0aGlzLmhpc3RvcnlWZXJzaW9uICs9IDE7XG4gICAgdGhpcy5oaXN0b3J5Q2FjaGUgPSBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZSB0byBzdGF0ZSBjaGFuZ2VzXG4gICAqIEByZXR1cm5zIFVuc3Vic2NyaWJlIGZ1bmN0aW9uXG4gICAqL1xuICBwdWJsaWMgc3Vic2NyaWJlID0gKGxpc3RlbmVyOiBMaXN0ZW5lcjxTLCBQPikgPT4ge1xuICAgIHRoaXMubGlzdGVuZXJzLmFkZChsaXN0ZW5lcik7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHRoaXMubGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcik7XG4gICAgfTtcbiAgfTtcblxuICAvKipcbiAgICogTm90aWZ5IGFsbCBsaXN0ZW5lcnMgb2Ygc3RhdGUgY2hhbmdlc1xuICAgKi9cbiAgcHJpdmF0ZSBub3RpZnkoKTogdm9pZCB7XG4gICAgdGhpcy5saXN0ZW5lcnMuZm9yRWFjaCgobGlzdGVuZXIpID0+XG4gICAgICBsaXN0ZW5lcih0aGlzLnN0YXRlLCB0aGlzLmdldFBhdGNoZXMoKSwgdGhpcy5wb3NpdGlvbilcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIHBhdGNoZXMgY29udGFpbiByb290LWxldmVsIHJlcGxhY2VtZW50IG9wZXJhdGlvbnNcbiAgICogUm9vdCByZXBsYWNlbWVudCBjYW5ub3QgYmUgZG9uZSBtdXRhYmx5IGFzIGl0IGNoYW5nZXMgdGhlIHR5cGUvdmFsdWUgb2YgdGhlIGVudGlyZSBzdGF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBoYXNSb290UmVwbGFjZW1lbnQocGF0Y2hlczogUGF0Y2hlczxQPik6IGJvb2xlYW4ge1xuICAgIHJldHVybiBwYXRjaGVzLnNvbWUoXG4gICAgICAocGF0Y2gpID0+XG4gICAgICAgICgoQXJyYXkuaXNBcnJheShwYXRjaC5wYXRoKSAmJiBwYXRjaC5wYXRoLmxlbmd0aCA9PT0gMCkgfHxcbiAgICAgICAgICBwYXRjaC5wYXRoID09PSAnJykgJiZcbiAgICAgICAgcGF0Y2gub3AgPT09ICdyZXBsYWNlJ1xuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBjdXJyZW50IHN0YXRlXG4gICAqL1xuICBnZXRTdGF0ZSA9ICgpID0+IHRoaXMuc3RhdGU7XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSB0aGUgc3RhdGVcbiAgICovXG4gIHB1YmxpYyBzZXRTdGF0ZSh1cGRhdGVyOiBVcGRhdGVyPFM+KTogdm9pZCB7XG4gICAgbGV0IHBhdGNoZXM6IFBhdGNoZXM8UD47XG4gICAgbGV0IGludmVyc2VQYXRjaGVzOiBQYXRjaGVzPFA+O1xuXG4gICAgY29uc3QgY2FuVXNlTXV0YWJsZVJvb3QgPSB0aGlzLm11dGFibGUgJiYgaXNPYmplY3RMaWtlKHRoaXMuc3RhdGUpO1xuICAgIGNvbnN0IGlzRnVuY3Rpb25VcGRhdGVyID0gdHlwZW9mIHVwZGF0ZXIgPT09ICdmdW5jdGlvbic7XG4gICAgY29uc3Qgc3RhdGVJc0FycmF5ID0gQXJyYXkuaXNBcnJheSh0aGlzLnN0YXRlKTtcbiAgICBjb25zdCB1cGRhdGVySXNBcnJheSA9IEFycmF5LmlzQXJyYXkodXBkYXRlcik7XG4gICAgY29uc3QgY2FuTXV0YXRlUGxhaW5PYmplY3RzID1cbiAgICAgICFzdGF0ZUlzQXJyYXkgJiZcbiAgICAgICF1cGRhdGVySXNBcnJheSAmJlxuICAgICAgaXNQbGFpbk9iamVjdCh0aGlzLnN0YXRlKSAmJlxuICAgICAgaXNQbGFpbk9iamVjdCh1cGRhdGVyKTtcbiAgICBjb25zdCBjYW5NdXRhdGVBcnJheXMgPVxuICAgICAgc3RhdGVJc0FycmF5ICYmXG4gICAgICB1cGRhdGVySXNBcnJheSAmJlxuICAgICAgaGFzT25seUFycmF5SW5kaWNlcyh0aGlzLnN0YXRlKSAmJlxuICAgICAgaGFzT25seUFycmF5SW5kaWNlcyh1cGRhdGVyKTtcbiAgICBjb25zdCBjYW5NdXRhdGVXaXRoVmFsdWUgPVxuICAgICAgY2FuVXNlTXV0YWJsZVJvb3QgJiZcbiAgICAgICFpc0Z1bmN0aW9uVXBkYXRlciAmJlxuICAgICAgKGNhbk11dGF0ZUFycmF5cyB8fCBjYW5NdXRhdGVQbGFpbk9iamVjdHMpO1xuICAgIGNvbnN0IHVzZU11dGFibGUgPVxuICAgICAgKGlzRnVuY3Rpb25VcGRhdGVyICYmIGNhblVzZU11dGFibGVSb290KSB8fCBjYW5NdXRhdGVXaXRoVmFsdWU7XG5cbiAgICBpZiAodGhpcy5tdXRhYmxlICYmICFjYW5Vc2VNdXRhYmxlUm9vdCAmJiAhdGhpcy5tdXRhYmxlRmFsbGJhY2tXYXJuZWQpIHtcbiAgICAgIHRoaXMubXV0YWJsZUZhbGxiYWNrV2FybmVkID0gdHJ1ZTtcblxuICAgICAgaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicpIHtcbiAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgICdUcmF2ZWxzOiBtdXRhYmxlIG1vZGUgcmVxdWlyZXMgdGhlIHN0YXRlIHJvb3QgdG8gYmUgYW4gb2JqZWN0LiBGYWxsaW5nIGJhY2sgdG8gaW1tdXRhYmxlIHVwZGF0ZXMuJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh1c2VNdXRhYmxlKSB7XG4gICAgICAvLyBGb3Igb2JzZXJ2YWJsZSBzdGF0ZTogZ2VuZXJhdGUgcGF0Y2hlcyB0aGVuIGFwcGx5IG11dGFibHlcbiAgICAgIGNvbnN0IFtuZXh0U3RhdGUsIHAsIGlwXSA9IGNyZWF0ZShcbiAgICAgICAgdGhpcy5zdGF0ZSxcbiAgICAgICAgaXNGdW5jdGlvblVwZGF0ZXJcbiAgICAgICAgICA/ICh1cGRhdGVyIGFzIChkcmFmdDogRHJhZnQ8Uz4pID0+IHZvaWQpXG4gICAgICAgICAgOiAoZHJhZnQ6IERyYWZ0PFM+KSA9PiB7XG4gICAgICAgICAgICAgIG92ZXJ3cml0ZURyYWZ0V2l0aChkcmFmdCEsIHVwZGF0ZXIpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgdGhpcy5vcHRpb25zXG4gICAgICApIGFzIFtTLCBQYXRjaGVzPFA+LCBQYXRjaGVzPFA+XTtcblxuICAgICAgcGF0Y2hlcyA9IHA7XG4gICAgICBpbnZlcnNlUGF0Y2hlcyA9IGlwO1xuXG4gICAgICBpZiAodGhpcy5oYXNSb290UmVwbGFjZW1lbnQocGF0Y2hlcykpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicgJiZcbiAgICAgICAgICAhdGhpcy5tdXRhYmxlUm9vdFJlcGxhY2VXYXJuZWRcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhpcy5tdXRhYmxlUm9vdFJlcGxhY2VXYXJuZWQgPSB0cnVlO1xuICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgICdUcmF2ZWxzOiBtdXRhYmxlIG1vZGUgY2Fubm90IGFwcGx5IHJvb3QgcmVwbGFjZW1lbnRzIGluIHBsYWNlLiBGYWxsaW5nIGJhY2sgdG8gaW1tdXRhYmxlIHVwZGF0ZSBmb3IgdGhpcyBjaGFuZ2UuJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSb290IHJlcGxhY2VtZW50IGNhbm5vdCBiZSBhcHBsaWVkIG11dGFibHk7IGZhbGwgYmFjayB0byBpbW11dGFibGUgYXNzaWdubWVudC5cbiAgICAgICAgdGhpcy5zdGF0ZSA9IG5leHRTdGF0ZTtcbiAgICAgICAgdGhpcy5wZW5kaW5nU3RhdGUgPSBuZXh0U3RhdGU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBcHBseSBwYXRjaGVzIHRvIG11dGF0ZSB0aGUgZXhpc3Rpbmcgc3RhdGUgb2JqZWN0XG4gICAgICAgIGFwcGx5KHRoaXMuc3RhdGUgYXMgb2JqZWN0LCBwYXRjaGVzLCB7IG11dGFibGU6IHRydWUgfSk7XG5cbiAgICAgICAgLy8gS2VlcCB0aGUgc2FtZSByZWZlcmVuY2VcbiAgICAgICAgdGhpcy5wZW5kaW5nU3RhdGUgPSB0aGlzLnN0YXRlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGb3IgaW1tdXRhYmxlIHN0YXRlOiBjcmVhdGUgbmV3IG9iamVjdFxuICAgICAgY29uc3QgW25leHRTdGF0ZSwgcCwgaXBdID0gKFxuICAgICAgICB0eXBlb2YgdXBkYXRlciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgID8gY3JlYXRlKFxuICAgICAgICAgICAgICB0aGlzLnN0YXRlLFxuICAgICAgICAgICAgICB1cGRhdGVyIGFzIChkcmFmdDogRHJhZnQ8Uz4pID0+IHZvaWQsXG4gICAgICAgICAgICAgIHRoaXMub3B0aW9uc1xuICAgICAgICAgICAgKVxuICAgICAgICAgIDogY3JlYXRlKFxuICAgICAgICAgICAgICB0aGlzLnN0YXRlLFxuICAgICAgICAgICAgICAoKSA9PlxuICAgICAgICAgICAgICAgIGlzT2JqZWN0TGlrZSh1cGRhdGVyKVxuICAgICAgICAgICAgICAgICAgPyAocmF3UmV0dXJuKHVwZGF0ZXIgYXMgb2JqZWN0KSBhcyBTKVxuICAgICAgICAgICAgICAgICAgOiAodXBkYXRlciBhcyBTKSxcbiAgICAgICAgICAgICAgdGhpcy5vcHRpb25zXG4gICAgICAgICAgICApXG4gICAgICApIGFzIFtTLCBQYXRjaGVzPFA+LCBQYXRjaGVzPFA+XTtcblxuICAgICAgcGF0Y2hlcyA9IHA7XG4gICAgICBpbnZlcnNlUGF0Y2hlcyA9IGlwO1xuICAgICAgdGhpcy5zdGF0ZSA9IG5leHRTdGF0ZTtcbiAgICAgIHRoaXMucGVuZGluZ1N0YXRlID0gbmV4dFN0YXRlO1xuICAgIH1cblxuICAgIGNvbnN0IHBlbmRpbmdTdGF0ZVZlcnNpb24gPSArK3RoaXMucGVuZGluZ1N0YXRlVmVyc2lvbjtcblxuICAgIC8vIFJlc2V0IHBlbmRpbmdTdGF0ZSBhc3luY2hyb25vdXNseSwgYnV0IG9ubHkgaWYgbm8gbmV3ZXIgdXBkYXRlIGxhbmRlZC5cbiAgICBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICAgIGlmICh0aGlzLnBlbmRpbmdTdGF0ZVZlcnNpb24gPT09IHBlbmRpbmdTdGF0ZVZlcnNpb24pIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nU3RhdGUgPSBudWxsO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgaGFzTm9DaGFuZ2VzID0gcGF0Y2hlcy5sZW5ndGggPT09IDAgJiYgaW52ZXJzZVBhdGNoZXMubGVuZ3RoID09PSAwO1xuXG4gICAgaWYgKGhhc05vQ2hhbmdlcykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmF1dG9BcmNoaXZlKSB7XG4gICAgICBjb25zdCBub3RMYXN0ID0gdGhpcy5wb3NpdGlvbiA8IHRoaXMuYWxsUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aDtcblxuICAgICAgLy8gUmVtb3ZlIGFsbCBwYXRjaGVzIGFmdGVyIHRoZSBjdXJyZW50IHBvc2l0aW9uXG4gICAgICBpZiAobm90TGFzdCkge1xuICAgICAgICB0aGlzLmFsbFBhdGNoZXMucGF0Y2hlcy5zcGxpY2UoXG4gICAgICAgICAgdGhpcy5wb3NpdGlvbixcbiAgICAgICAgICB0aGlzLmFsbFBhdGNoZXMucGF0Y2hlcy5sZW5ndGggLSB0aGlzLnBvc2l0aW9uXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5zcGxpY2UoXG4gICAgICAgICAgdGhpcy5wb3NpdGlvbixcbiAgICAgICAgICB0aGlzLmFsbFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMubGVuZ3RoIC0gdGhpcy5wb3NpdGlvblxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmFsbFBhdGNoZXMucGF0Y2hlcy5wdXNoKHBhdGNoZXMpO1xuICAgICAgdGhpcy5hbGxQYXRjaGVzLmludmVyc2VQYXRjaGVzLnB1c2goaW52ZXJzZVBhdGNoZXMpO1xuXG4gICAgICB0aGlzLnBvc2l0aW9uID1cbiAgICAgICAgdGhpcy5tYXhIaXN0b3J5IDwgdGhpcy5hbGxQYXRjaGVzLnBhdGNoZXMubGVuZ3RoXG4gICAgICAgICAgPyB0aGlzLm1heEhpc3RvcnlcbiAgICAgICAgICA6IHRoaXMucG9zaXRpb24gKyAxO1xuXG4gICAgICBpZiAodGhpcy5tYXhIaXN0b3J5IDwgdGhpcy5hbGxQYXRjaGVzLnBhdGNoZXMubGVuZ3RoKSB7XG4gICAgICAgIC8vIEhhbmRsZSBtYXhIaXN0b3J5ID0gMCBjYXNlOiBjbGVhciBhbGwgcGF0Y2hlc1xuICAgICAgICBpZiAodGhpcy5tYXhIaXN0b3J5ID09PSAwKSB7XG4gICAgICAgICAgdGhpcy5hbGxQYXRjaGVzLnBhdGNoZXMgPSBbXTtcbiAgICAgICAgICB0aGlzLmFsbFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMgPSBbXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmFsbFBhdGNoZXMucGF0Y2hlcyA9IHRoaXMuYWxsUGF0Y2hlcy5wYXRjaGVzLnNsaWNlKFxuICAgICAgICAgICAgLXRoaXMubWF4SGlzdG9yeVxuICAgICAgICAgICk7XG4gICAgICAgICAgdGhpcy5hbGxQYXRjaGVzLmludmVyc2VQYXRjaGVzID0gdGhpcy5hbGxQYXRjaGVzLmludmVyc2VQYXRjaGVzLnNsaWNlKFxuICAgICAgICAgICAgLXRoaXMubWF4SGlzdG9yeVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgbm90TGFzdCA9XG4gICAgICAgIHRoaXMucG9zaXRpb24gPFxuICAgICAgICB0aGlzLmFsbFBhdGNoZXMucGF0Y2hlcy5sZW5ndGggK1xuICAgICAgICAgIE51bWJlcighIXRoaXMudGVtcFBhdGNoZXMucGF0Y2hlcy5sZW5ndGgpO1xuXG4gICAgICAvLyBSZW1vdmUgYWxsIHBhdGNoZXMgYWZ0ZXIgdGhlIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgIGlmIChub3RMYXN0KSB7XG4gICAgICAgIHRoaXMuYWxsUGF0Y2hlcy5wYXRjaGVzLnNwbGljZShcbiAgICAgICAgICB0aGlzLnBvc2l0aW9uLFxuICAgICAgICAgIHRoaXMuYWxsUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aCAtIHRoaXMucG9zaXRpb25cbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5hbGxQYXRjaGVzLmludmVyc2VQYXRjaGVzLnNwbGljZShcbiAgICAgICAgICB0aGlzLnBvc2l0aW9uLFxuICAgICAgICAgIHRoaXMuYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5sZW5ndGggLSB0aGlzLnBvc2l0aW9uXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy50ZW1wUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aCB8fCBub3RMYXN0KSB7XG4gICAgICAgIHRoaXMucG9zaXRpb24gPVxuICAgICAgICAgIHRoaXMubWF4SGlzdG9yeSA8IHRoaXMuYWxsUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aCArIDFcbiAgICAgICAgICAgID8gdGhpcy5tYXhIaXN0b3J5XG4gICAgICAgICAgICA6IHRoaXMucG9zaXRpb24gKyAxO1xuICAgICAgfVxuXG4gICAgICBpZiAobm90TGFzdCkge1xuICAgICAgICB0aGlzLnRlbXBQYXRjaGVzLnBhdGNoZXMubGVuZ3RoID0gMDtcbiAgICAgICAgdGhpcy50ZW1wUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5sZW5ndGggPSAwO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnRlbXBQYXRjaGVzLnBhdGNoZXMucHVzaChwYXRjaGVzKTtcbiAgICAgIHRoaXMudGVtcFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMucHVzaChpbnZlcnNlUGF0Y2hlcyk7XG4gICAgfVxuXG4gICAgdGhpcy5pbnZhbGlkYXRlSGlzdG9yeUNhY2hlKCk7XG4gICAgdGhpcy5ub3RpZnkoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBcmNoaXZlIHRoZSBjdXJyZW50IHN0YXRlIChvbmx5IGZvciBtYW51YWwgYXJjaGl2ZSBtb2RlKVxuICAgKi9cbiAgcHVibGljIGFyY2hpdmUoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuYXV0b0FyY2hpdmUpIHtcbiAgICAgIGNvbnNvbGUud2FybignQXV0byBhcmNoaXZlIGlzIGVuYWJsZWQsIG5vIG5lZWQgdG8gYXJjaGl2ZSBtYW51YWxseScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghdGhpcy50ZW1wUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aCkgcmV0dXJuO1xuXG4gICAgLy8gVXNlIHBlbmRpbmdTdGF0ZSBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSB1c2UgY3VycmVudCBzdGF0ZVxuICAgIGNvbnN0IHN0YXRlVG9Vc2UgPSAodGhpcy5wZW5kaW5nU3RhdGUgPz8gdGhpcy5zdGF0ZSkgYXMgb2JqZWN0O1xuXG4gICAgLy8gTWVyZ2UgdGVtcCBwYXRjaGVzXG4gICAgY29uc3QgWywgcGF0Y2hlcywgaW52ZXJzZVBhdGNoZXNdID0gY3JlYXRlKFxuICAgICAgc3RhdGVUb1VzZSxcbiAgICAgIChkcmFmdCkgPT4gYXBwbHkoZHJhZnQsIHRoaXMudGVtcFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMuZmxhdCgpLnJldmVyc2UoKSksXG4gICAgICB0aGlzLm9wdGlvbnNcbiAgICApIGFzIFtTLCBQYXRjaGVzPFA+LCBQYXRjaGVzPFA+XTtcblxuICAgIHRoaXMuYWxsUGF0Y2hlcy5wYXRjaGVzLnB1c2goaW52ZXJzZVBhdGNoZXMpO1xuICAgIHRoaXMuYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5wdXNoKHBhdGNoZXMpO1xuXG4gICAgLy8gUmVzcGVjdCBtYXhIaXN0b3J5IGxpbWl0XG4gICAgaWYgKHRoaXMubWF4SGlzdG9yeSA8IHRoaXMuYWxsUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aCkge1xuICAgICAgLy8gSGFuZGxlIG1heEhpc3RvcnkgPSAwIGNhc2U6IGNsZWFyIGFsbCBwYXRjaGVzXG4gICAgICBpZiAodGhpcy5tYXhIaXN0b3J5ID09PSAwKSB7XG4gICAgICAgIHRoaXMuYWxsUGF0Y2hlcy5wYXRjaGVzID0gW107XG4gICAgICAgIHRoaXMuYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcyA9IFtdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5hbGxQYXRjaGVzLnBhdGNoZXMgPSB0aGlzLmFsbFBhdGNoZXMucGF0Y2hlcy5zbGljZShcbiAgICAgICAgICAtdGhpcy5tYXhIaXN0b3J5XG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcyA9IHRoaXMuYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5zbGljZShcbiAgICAgICAgICAtdGhpcy5tYXhIaXN0b3J5XG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ2xlYXIgdGVtcG9yYXJ5IHBhdGNoZXMgYWZ0ZXIgYXJjaGl2aW5nXG4gICAgdGhpcy50ZW1wUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aCA9IDA7XG4gICAgdGhpcy50ZW1wUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5sZW5ndGggPSAwO1xuXG4gICAgdGhpcy5pbnZhbGlkYXRlSGlzdG9yeUNhY2hlKCk7XG4gICAgdGhpcy5ub3RpZnkoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYWxsIHBhdGNoZXMgaW5jbHVkaW5nIHRlbXBvcmFyeSBwYXRjaGVzXG4gICAqL1xuICBwcml2YXRlIGdldEFsbFBhdGNoZXMoKTogVHJhdmVsUGF0Y2hlczxQPiB7XG4gICAgY29uc3Qgc2hvdWxkQXJjaGl2ZSA9XG4gICAgICAhdGhpcy5hdXRvQXJjaGl2ZSAmJiAhIXRoaXMudGVtcFBhdGNoZXMucGF0Y2hlcy5sZW5ndGg7XG5cbiAgICBpZiAoc2hvdWxkQXJjaGl2ZSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcGF0Y2hlczogdGhpcy5hbGxQYXRjaGVzLnBhdGNoZXMuY29uY2F0KFtcbiAgICAgICAgICB0aGlzLnRlbXBQYXRjaGVzLnBhdGNoZXMuZmxhdCgpLFxuICAgICAgICBdKSxcbiAgICAgICAgaW52ZXJzZVBhdGNoZXM6IHRoaXMuYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5jb25jYXQoW1xuICAgICAgICAgIHRoaXMudGVtcFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMuZmxhdCgpLnJldmVyc2UoKSxcbiAgICAgICAgXSksXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFsbFBhdGNoZXM7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBjb21wbGV0ZSBoaXN0b3J5IG9mIHN0YXRlc1xuICAgKlxuICAgKiBAcmV0dXJucyBUaGUgaGlzdG9yeSBhcnJheS4gUmVmZXJlbmNlIGVxdWFsaXR5IGluZGljYXRlcyBjYWNoZSBoaXQuXG4gICAqXG4gICAqIEByZW1hcmtzXG4gICAqICoqSU1QT1JUQU5UKio6IERvIG5vdCBtb2RpZnkgdGhlIHJldHVybmVkIGFycmF5LiBJdCBpcyBjYWNoZWQgaW50ZXJuYWxseS5cbiAgICogLSBJbiBkZXZlbG9wbWVudCBtb2RlLCB0aGUgYXJyYXkgaXMgZnJvemVuXG4gICAqIC0gSW4gcHJvZHVjdGlvbiBtb2RlLCBtb2RpZmljYXRpb25zIHdpbGwgY29ycnVwdCB0aGUgY2FjaGVcbiAgICovXG4gIHB1YmxpYyBnZXRIaXN0b3J5KCk6IHJlYWRvbmx5IFNbXSB7XG4gICAgaWYgKFxuICAgICAgdGhpcy5oaXN0b3J5Q2FjaGUgJiZcbiAgICAgIHRoaXMuaGlzdG9yeUNhY2hlLnZlcnNpb24gPT09IHRoaXMuaGlzdG9yeVZlcnNpb25cbiAgICApIHtcbiAgICAgIHJldHVybiB0aGlzLmhpc3RvcnlDYWNoZS5oaXN0b3J5O1xuICAgIH1cblxuICAgIGxldCBjdXJyZW50U3RhdGUgPSB0aGlzLnN0YXRlO1xuICAgIGNvbnN0IF9hbGxQYXRjaGVzID0gdGhpcy5nZXRBbGxQYXRjaGVzKCk7XG5cbiAgICBjb25zdCBwYXRjaGVzID1cbiAgICAgICF0aGlzLmF1dG9BcmNoaXZlICYmIF9hbGxQYXRjaGVzLnBhdGNoZXMubGVuZ3RoID4gdGhpcy5tYXhIaXN0b3J5XG4gICAgICAgID8gX2FsbFBhdGNoZXMucGF0Y2hlcy5zbGljZShcbiAgICAgICAgICAgIF9hbGxQYXRjaGVzLnBhdGNoZXMubGVuZ3RoIC0gdGhpcy5tYXhIaXN0b3J5XG4gICAgICAgICAgKVxuICAgICAgICA6IF9hbGxQYXRjaGVzLnBhdGNoZXM7XG4gICAgY29uc3QgaW52ZXJzZVBhdGNoZXMgPVxuICAgICAgIXRoaXMuYXV0b0FyY2hpdmUgJiYgX2FsbFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMubGVuZ3RoID4gdGhpcy5tYXhIaXN0b3J5XG4gICAgICAgID8gX2FsbFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMuc2xpY2UoXG4gICAgICAgICAgICBfYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5sZW5ndGggLSB0aGlzLm1heEhpc3RvcnlcbiAgICAgICAgICApXG4gICAgICAgIDogX2FsbFBhdGNoZXMuaW52ZXJzZVBhdGNoZXM7XG5cbiAgICAvLyBCdWlsZCBmdXR1cmUgaGlzdG9yeVxuICAgIGNvbnN0IGZ1dHVyZUhpc3Rvcnk6IFNbXSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnBvc2l0aW9uOyBpIDwgcGF0Y2hlcy5sZW5ndGg7IGkrKykge1xuICAgICAgY3VycmVudFN0YXRlID0gYXBwbHkoY3VycmVudFN0YXRlIGFzIG9iamVjdCwgcGF0Y2hlc1tpXSkgYXMgUztcbiAgICAgIGZ1dHVyZUhpc3RvcnkucHVzaChjdXJyZW50U3RhdGUpO1xuICAgIH1cblxuICAgIC8vIEJ1aWxkIHBhc3QgaGlzdG9yeVxuICAgIGN1cnJlbnRTdGF0ZSA9IHRoaXMuc3RhdGU7XG4gICAgY29uc3QgcGFzdEhpc3Rvcnk6IFNbXSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnBvc2l0aW9uIC0gMTsgaSA+IC0xOyBpLS0pIHtcbiAgICAgIGN1cnJlbnRTdGF0ZSA9IGFwcGx5KGN1cnJlbnRTdGF0ZSBhcyBvYmplY3QsIGludmVyc2VQYXRjaGVzW2ldKSBhcyBTO1xuICAgICAgcGFzdEhpc3RvcnkucHVzaChjdXJyZW50U3RhdGUpO1xuICAgIH1cbiAgICBwYXN0SGlzdG9yeS5yZXZlcnNlKCk7XG5cbiAgICBjb25zdCBoaXN0b3J5OiBTW10gPSBbLi4ucGFzdEhpc3RvcnksIHRoaXMuc3RhdGUsIC4uLmZ1dHVyZUhpc3RvcnldO1xuXG4gICAgdGhpcy5oaXN0b3J5Q2FjaGUgPSB7XG4gICAgICB2ZXJzaW9uOiB0aGlzLmhpc3RvcnlWZXJzaW9uLFxuICAgICAgaGlzdG9yeSxcbiAgICB9O1xuXG4gICAgLy8gSW4gZGV2ZWxvcG1lbnQgbW9kZSwgZnJlZXplIHRoZSBoaXN0b3J5IGFycmF5IHRvIHByZXZlbnQgYWNjaWRlbnRhbCBtdXRhdGlvbnNcbiAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykge1xuICAgICAgT2JqZWN0LmZyZWV6ZShoaXN0b3J5KTtcbiAgICB9XG5cbiAgICByZXR1cm4gaGlzdG9yeTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHbyB0byBhIHNwZWNpZmljIHBvc2l0aW9uIGluIHRoZSBoaXN0b3J5XG4gICAqL1xuICBwdWJsaWMgZ28obmV4dFBvc2l0aW9uOiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodHlwZW9mIG5leHRQb3NpdGlvbiAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0Zpbml0ZShuZXh0UG9zaXRpb24pKSB7XG4gICAgICBjb25zb2xlLndhcm4oYENhbid0IGdvIHRvIGludmFsaWQgcG9zaXRpb24gJHtuZXh0UG9zaXRpb259YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKG5leHRQb3NpdGlvbikpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRQb3NpdGlvbiA9IE1hdGgudHJ1bmMobmV4dFBvc2l0aW9uKTtcbiAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgYENhbid0IGdvIHRvIG5vbi1pbnRlZ2VyIHBvc2l0aW9uICR7bmV4dFBvc2l0aW9ufS4gVXNpbmcgJHtub3JtYWxpemVkUG9zaXRpb259IGluc3RlYWQuYFxuICAgICAgKTtcbiAgICAgIG5leHRQb3NpdGlvbiA9IG5vcm1hbGl6ZWRQb3NpdGlvbjtcbiAgICB9XG5cbiAgICBjb25zdCBzaG91bGRBcmNoaXZlID1cbiAgICAgICF0aGlzLmF1dG9BcmNoaXZlICYmICEhdGhpcy50ZW1wUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aDtcblxuICAgIGlmIChzaG91bGRBcmNoaXZlKSB7XG4gICAgICB0aGlzLmFyY2hpdmUoKTtcbiAgICB9XG5cbiAgICBjb25zdCBfYWxsUGF0Y2hlcyA9IHRoaXMuZ2V0QWxsUGF0Y2hlcygpO1xuICAgIGNvbnN0IGJhY2sgPSBuZXh0UG9zaXRpb24gPCB0aGlzLnBvc2l0aW9uO1xuXG4gICAgaWYgKG5leHRQb3NpdGlvbiA+IF9hbGxQYXRjaGVzLnBhdGNoZXMubGVuZ3RoKSB7XG4gICAgICBjb25zb2xlLndhcm4oYENhbid0IGdvIGZvcndhcmQgdG8gcG9zaXRpb24gJHtuZXh0UG9zaXRpb259YCk7XG4gICAgICBuZXh0UG9zaXRpb24gPSBfYWxsUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aDtcbiAgICB9XG5cbiAgICBpZiAobmV4dFBvc2l0aW9uIDwgMCkge1xuICAgICAgY29uc29sZS53YXJuKGBDYW4ndCBnbyBiYWNrIHRvIHBvc2l0aW9uICR7bmV4dFBvc2l0aW9ufWApO1xuICAgICAgbmV4dFBvc2l0aW9uID0gMDtcbiAgICB9XG5cbiAgICBpZiAobmV4dFBvc2l0aW9uID09PSB0aGlzLnBvc2l0aW9uKSByZXR1cm47XG5cbiAgICBjb25zdCBpbnZlcnNlUGF0Y2hlc0Zvck5hdmlnYXRpb24gPVxuICAgICAgc2hvdWxkQXJjaGl2ZSAmJiBfYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcy5sZW5ndGggPiAwXG4gICAgICAgID8gX2FsbFBhdGNoZXMuaW52ZXJzZVBhdGNoZXMubWFwKChwYXRjaCwgaW5kZXgsIGFsbFBhdGNoZXMpID0+XG4gICAgICAgICAgICBpbmRleCA9PT0gYWxsUGF0Y2hlcy5sZW5ndGggLSAxID8gWy4uLnBhdGNoXS5yZXZlcnNlKCkgOiBwYXRjaFxuICAgICAgICAgIClcbiAgICAgICAgOiBfYWxsUGF0Y2hlcy5pbnZlcnNlUGF0Y2hlcztcblxuICAgIGNvbnN0IHBhdGNoZXNUb0FwcGx5ID0gYmFja1xuICAgICAgPyBpbnZlcnNlUGF0Y2hlc0Zvck5hdmlnYXRpb25cbiAgICAgICAgICAuc2xpY2UoLXRoaXMubWF4SGlzdG9yeSlcbiAgICAgICAgICAuc2xpY2UobmV4dFBvc2l0aW9uLCB0aGlzLnBvc2l0aW9uKVxuICAgICAgICAgIC5mbGF0KClcbiAgICAgICAgICAucmV2ZXJzZSgpXG4gICAgICA6IF9hbGxQYXRjaGVzLnBhdGNoZXNcbiAgICAgICAgICAuc2xpY2UoLXRoaXMubWF4SGlzdG9yeSlcbiAgICAgICAgICAuc2xpY2UodGhpcy5wb3NpdGlvbiwgbmV4dFBvc2l0aW9uKVxuICAgICAgICAgIC5mbGF0KCk7XG5cbiAgICAvLyBDYW4gb25seSB1c2UgbXV0YWJsZSBtb2RlIGlmOlxuICAgIC8vIDEuIG11dGFibGUgbW9kZSBpcyBlbmFibGVkXG4gICAgLy8gMi4gY3VycmVudCBzdGF0ZSBpcyBhbiBvYmplY3RcbiAgICAvLyAzLiBwYXRjaGVzIGRvbid0IGNvbnRhaW4gcm9vdC1sZXZlbCByZXBsYWNlbWVudHMgKHdoaWNoIGNoYW5nZSB0aGUgZW50aXJlIHN0YXRlKVxuICAgIGNvbnN0IGNhbkdvTXV0YWJseSA9XG4gICAgICB0aGlzLm11dGFibGUgJiZcbiAgICAgIGlzT2JqZWN0TGlrZSh0aGlzLnN0YXRlKSAmJlxuICAgICAgIXRoaXMuaGFzUm9vdFJlcGxhY2VtZW50KHBhdGNoZXNUb0FwcGx5KTtcblxuICAgIGlmIChjYW5Hb011dGFibHkpIHtcbiAgICAgIC8vIEZvciBvYnNlcnZhYmxlIHN0YXRlOiBtdXRhdGUgaW4gcGxhY2VcbiAgICAgIGFwcGx5KHRoaXMuc3RhdGUgYXMgb2JqZWN0LCBwYXRjaGVzVG9BcHBseSwgeyBtdXRhYmxlOiB0cnVlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGb3IgaW1tdXRhYmxlIHN0YXRlIG9yIHByaW1pdGl2ZSB0eXBlczogY3JlYXRlIG5ldyBzdGF0ZVxuICAgICAgdGhpcy5zdGF0ZSA9IGFwcGx5KHRoaXMuc3RhdGUgYXMgb2JqZWN0LCBwYXRjaGVzVG9BcHBseSkgYXMgUztcbiAgICB9XG5cbiAgICB0aGlzLnBvc2l0aW9uID0gbmV4dFBvc2l0aW9uO1xuICAgIHRoaXMuaW52YWxpZGF0ZUhpc3RvcnlDYWNoZSgpO1xuICAgIHRoaXMubm90aWZ5KCk7XG4gIH1cblxuICAvKipcbiAgICogR28gYmFjayBpbiB0aGUgaGlzdG9yeVxuICAgKi9cbiAgcHVibGljIGJhY2soYW1vdW50OiBudW1iZXIgPSAxKTogdm9pZCB7XG4gICAgdGhpcy5nbyh0aGlzLnBvc2l0aW9uIC0gYW1vdW50KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHbyBmb3J3YXJkIGluIHRoZSBoaXN0b3J5XG4gICAqL1xuICBwdWJsaWMgZm9yd2FyZChhbW91bnQ6IG51bWJlciA9IDEpOiB2b2lkIHtcbiAgICB0aGlzLmdvKHRoaXMucG9zaXRpb24gKyBhbW91bnQpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0IHRvIHRoZSBpbml0aWFsIHN0YXRlXG4gICAqL1xuICBwdWJsaWMgcmVzZXQoKTogdm9pZCB7XG4gICAgY29uc3QgY2FuUmVzZXRNdXRhYmx5ID1cbiAgICAgIHRoaXMubXV0YWJsZSAmJlxuICAgICAgaXNPYmplY3RMaWtlKHRoaXMuc3RhdGUpICYmXG4gICAgICBpc09iamVjdExpa2UodGhpcy5pbml0aWFsU3RhdGUpO1xuXG4gICAgaWYgKGNhblJlc2V0TXV0YWJseSkge1xuICAgICAgLy8gRm9yIG9ic2VydmFibGUgc3RhdGU6IHVzZSBwYXRjaCBzeXN0ZW0gdG8gcmVzZXQgdG8gaW5pdGlhbCBzdGF0ZVxuICAgICAgLy8gR2VuZXJhdGUgcGF0Y2hlcyBmcm9tIGN1cnJlbnQgc3RhdGUgdG8gaW5pdGlhbCBzdGF0ZVxuICAgICAgY29uc3QgWywgcGF0Y2hlc10gPSBjcmVhdGUoXG4gICAgICAgIHRoaXMuc3RhdGUsXG4gICAgICAgIChkcmFmdCkgPT4ge1xuICAgICAgICAgIC8vIENsZWFyIGFsbCBwcm9wZXJ0aWVzXG4gICAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZHJhZnQgYXMgb2JqZWN0KSkge1xuICAgICAgICAgICAgZGVsZXRlIChkcmFmdCBhcyBhbnkpW2tleV07XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIERlZXAgY29weSBhbGwgcHJvcGVydGllcyBmcm9tIGluaXRpYWxTdGF0ZVxuICAgICAgICAgIGRlZXBDbG9uZSh0aGlzLmluaXRpYWxTdGF0ZSwgZHJhZnQpO1xuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGRyYWZ0KSAmJiBBcnJheS5pc0FycmF5KHRoaXMuaW5pdGlhbFN0YXRlKSkge1xuICAgICAgICAgICAgKGRyYWZ0IGFzIGFueVtdKS5sZW5ndGggPSAodGhpcy5pbml0aWFsU3RhdGUgYXMgYW55W10pLmxlbmd0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHRoaXMub3B0aW9uc1xuICAgICAgKTtcblxuICAgICAgYXBwbHkodGhpcy5zdGF0ZSBhcyBvYmplY3QsIHBhdGNoZXMsIHsgbXV0YWJsZTogdHJ1ZSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRm9yIGltbXV0YWJsZSBzdGF0ZTogcmVzdG9yZSBmcm9tIGEgc25hcHNob3QgY2xvbmUuXG4gICAgICB0aGlzLnN0YXRlID0gY2xvbmVJbml0aWFsU25hcHNob3QodGhpcy5pbml0aWFsU3RhdGUpO1xuICAgIH1cblxuICAgIHRoaXMucG9zaXRpb24gPSB0aGlzLmluaXRpYWxQb3NpdGlvbjtcbiAgICB0aGlzLmFsbFBhdGNoZXMgPSBjbG9uZVRyYXZlbFBhdGNoZXModGhpcy5pbml0aWFsUGF0Y2hlcyk7XG4gICAgdGhpcy50ZW1wUGF0Y2hlcyA9IGNsb25lVHJhdmVsUGF0Y2hlcygpO1xuXG4gICAgdGhpcy5pbnZhbGlkYXRlSGlzdG9yeUNhY2hlKCk7XG4gICAgdGhpcy5ub3RpZnkoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wcmVzcyBmdWxsIGhpc3RvcnkgYW5kIG1ha2UgdGhlIGN1cnJlbnQgc3RhdGUgYXMgaW5pdGlhbFxuICAgKi9cbiAgcHVibGljIHJlYmFzZSgpOiB2b2lkIHtcbiAgICB0aGlzLmluaXRpYWxTdGF0ZSA9IGNsb25lSW5pdGlhbFNuYXBzaG90KHRoaXMuc3RhdGUpO1xuICAgIHRoaXMuaW5pdGlhbFBvc2l0aW9uID0gMDtcbiAgICB0aGlzLmluaXRpYWxQYXRjaGVzID0gdW5kZWZpbmVkO1xuXG4gICAgdGhpcy5wb3NpdGlvbiA9IDA7XG4gICAgdGhpcy5hbGxQYXRjaGVzID0gY2xvbmVUcmF2ZWxQYXRjaGVzKCk7XG4gICAgdGhpcy50ZW1wUGF0Y2hlcyA9IGNsb25lVHJhdmVsUGF0Y2hlcygpO1xuXG4gICAgdGhpcy5pbnZhbGlkYXRlSGlzdG9yeUNhY2hlKCk7XG4gICAgdGhpcy5ub3RpZnkoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiBpdCdzIHBvc3NpYmxlIHRvIGdvIGJhY2tcbiAgICovXG4gIHB1YmxpYyBjYW5CYWNrKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnBvc2l0aW9uID4gMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiBpdCdzIHBvc3NpYmxlIHRvIGdvIGZvcndhcmRcbiAgICovXG4gIHB1YmxpYyBjYW5Gb3J3YXJkKCk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHNob3VsZEFyY2hpdmUgPVxuICAgICAgIXRoaXMuYXV0b0FyY2hpdmUgJiYgISF0aGlzLnRlbXBQYXRjaGVzLnBhdGNoZXMubGVuZ3RoO1xuICAgIGNvbnN0IF9hbGxQYXRjaGVzID0gdGhpcy5nZXRBbGxQYXRjaGVzKCk7XG5cbiAgICAvLyBUZW1wb3JhcnkgcGF0Y2hlcyByZXByZXNlbnQgdGhlIGN1cnJlbnQgc3RhdGUsIG5vdCBhIGZ1dHVyZSBzdGF0ZVxuICAgIHJldHVybiBzaG91bGRBcmNoaXZlXG4gICAgICA/IHRoaXMucG9zaXRpb24gPCBfYWxsUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aCAtIDFcbiAgICAgIDogdGhpcy5wb3NpdGlvbiA8IF9hbGxQYXRjaGVzLnBhdGNoZXMubGVuZ3RoO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGl0J3MgcG9zc2libGUgdG8gYXJjaGl2ZSB0aGUgY3VycmVudCBzdGF0ZVxuICAgKi9cbiAgcHVibGljIGNhbkFyY2hpdmUoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuICF0aGlzLmF1dG9BcmNoaXZlICYmICEhdGhpcy50ZW1wUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGN1cnJlbnQgcG9zaXRpb24gaW4gdGhlIGhpc3RvcnlcbiAgICovXG4gIHB1YmxpYyBnZXRQb3NpdGlvbigpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnBvc2l0aW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgcGF0Y2hlcyBoaXN0b3J5XG4gICAqL1xuICBwdWJsaWMgZ2V0UGF0Y2hlcygpOiBUcmF2ZWxQYXRjaGVzPFA+IHtcbiAgICBjb25zdCBzaG91bGRBcmNoaXZlID1cbiAgICAgICF0aGlzLmF1dG9BcmNoaXZlICYmICEhdGhpcy50ZW1wUGF0Y2hlcy5wYXRjaGVzLmxlbmd0aDtcbiAgICBjb25zdCBwYXRjaFNvdXJjZSA9IHNob3VsZEFyY2hpdmUgPyB0aGlzLmdldEFsbFBhdGNoZXMoKSA6IHRoaXMuYWxsUGF0Y2hlcztcbiAgICByZXR1cm4gY2xvbmVUcmF2ZWxQYXRjaGVzKHBhdGNoU291cmNlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGNvbnRyb2xzIG9iamVjdFxuICAgKi9cbiAgcHVibGljIGdldENvbnRyb2xzKCkge1xuICAgIGlmICh0aGlzLmNvbnRyb2xzQ2FjaGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmNvbnRyb2xzQ2FjaGUgYXMgQSBleHRlbmRzIHRydWVcbiAgICAgICAgPyBUcmF2ZWxzQ29udHJvbHM8UywgRiwgUD5cbiAgICAgICAgOiBNYW51YWxUcmF2ZWxzQ29udHJvbHM8UywgRiwgUD47XG4gICAgfVxuXG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgY29uc3QgY29udHJvbHM6IFRyYXZlbHNDb250cm9sczxTLCBGLCBQPiB8IE1hbnVhbFRyYXZlbHNDb250cm9sczxTLCBGLCBQPiA9XG4gICAgICB7XG4gICAgICAgIGdldCBwb3NpdGlvbigpOiBudW1iZXIge1xuICAgICAgICAgIHJldHVybiBzZWxmLmdldFBvc2l0aW9uKCk7XG4gICAgICAgIH0sXG4gICAgICAgIGdldEhpc3Rvcnk6ICgpID0+IHNlbGYuZ2V0SGlzdG9yeSgpIGFzIFZhbHVlPFMsIEY+W10sXG4gICAgICAgIGdldCBwYXRjaGVzKCk6IFRyYXZlbFBhdGNoZXM8UD4ge1xuICAgICAgICAgIHJldHVybiBzZWxmLmdldFBhdGNoZXMoKTtcbiAgICAgICAgfSxcbiAgICAgICAgYmFjazogKGFtb3VudD86IG51bWJlcik6IHZvaWQgPT4gc2VsZi5iYWNrKGFtb3VudCksXG4gICAgICAgIGZvcndhcmQ6IChhbW91bnQ/OiBudW1iZXIpOiB2b2lkID0+IHNlbGYuZm9yd2FyZChhbW91bnQpLFxuICAgICAgICByZXNldDogKCk6IHZvaWQgPT4gc2VsZi5yZXNldCgpLFxuICAgICAgICBnbzogKHBvc2l0aW9uOiBudW1iZXIpOiB2b2lkID0+IHNlbGYuZ28ocG9zaXRpb24pLFxuICAgICAgICBjYW5CYWNrOiAoKTogYm9vbGVhbiA9PiBzZWxmLmNhbkJhY2soKSxcbiAgICAgICAgY2FuRm9yd2FyZDogKCk6IGJvb2xlYW4gPT4gc2VsZi5jYW5Gb3J3YXJkKCksXG4gICAgICAgIHJlYmFzZTogKCk6IHZvaWQgPT4gc2VsZi5yZWJhc2UoKSxcbiAgICAgIH07XG5cbiAgICBpZiAoIXRoaXMuYXV0b0FyY2hpdmUpIHtcbiAgICAgIChjb250cm9scyBhcyBNYW51YWxUcmF2ZWxzQ29udHJvbHM8UywgRiwgUD4pLmFyY2hpdmUgPSAoKTogdm9pZCA9PlxuICAgICAgICBzZWxmLmFyY2hpdmUoKTtcbiAgICAgIChjb250cm9scyBhcyBNYW51YWxUcmF2ZWxzQ29udHJvbHM8UywgRiwgUD4pLmNhbkFyY2hpdmUgPSAoKTogYm9vbGVhbiA9PlxuICAgICAgICBzZWxmLmNhbkFyY2hpdmUoKTtcbiAgICB9XG5cbiAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykge1xuICAgICAgT2JqZWN0LmZyZWV6ZShjb250cm9scyk7XG4gICAgfVxuXG4gICAgdGhpcy5jb250cm9sc0NhY2hlID0gY29udHJvbHM7XG5cbiAgICByZXR1cm4gY29udHJvbHMgYXMgQSBleHRlbmRzIHRydWVcbiAgICAgID8gVHJhdmVsc0NvbnRyb2xzPFMsIEYsIFA+XG4gICAgICA6IE1hbnVhbFRyYXZlbHNDb250cm9sczxTLCBGLCBQPjtcbiAgfVxufVxuIl19