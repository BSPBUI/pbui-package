import { io } from 'socket.io-client';
import { Response_ResponseTypes } from './Response_ResponseTypes';

const apiUrl = 'https://api.ultraslayyy.xyz/api';
const slugRegex = /^[a-z0-9_-]+$/;

class PBUI {
    constructor() {
        this.socket = null;
        this.authToken = '';
        this.listeners = {};
        this.state = new PBUIState();
        this.tournaments = new Tournaments(this.authToken);
        this.reconnectionAttempts = 0;
        this.heartbeatInterval = null;
        this.connecting = false;
        this.connectionPromise = null;
        this.manualDisconnect = false;
    }

    async connect(url, options = {}) {
        if (url) {
            this.setApiBase(url);
        }
        this.connecting = true;
        try {
            await this._disconnectIfConnected();
            this.connectionPromise = this._establishConnection(options);
            this._startHeartbeat();
        } catch (error) {
            console.error('[PBUI] Connection failed:', error);
            this._reconnect();
            throw error;
        }

        this._cleanupSocket();
        this._setupEventHandlers();
        return this.connectionPromise;
    }

    async _disconnectIfConnected() {
        if (this.socket) {
            console.warn('[PBUI] Already connected to a WebSocket. Disconnecting first...');
            this.manualDisconnect = true;
            await this.disconnect();
        }
    }

    async _establishConnection(options) {
        return new Promise((resolve, reject) => {
            this.socket = io(apiUrl, {
                transports: ['websocket'],
                secure: true,
                rejectUnauthorized: process.env.NODE_ENV === 'development' ? false : true,
                reconnection: false,
                timeout: 5000,
                ...options
            });

            this.socket.once('connect', () => {
                console.log(`[PBUI] Connected to WebSocket: ${apiUrl}`);
                this.connecting = false;
                this.reconnectionAttempts = 0;
                this._startHeartbeat();
                resolve();
            });

            this.socket.once('connect_error', (error) => {
                const errorMsg = error.message || 'Unknown error';
                console.warn(`[PBUI] Connection failed: ${errorMsg}`);
                reject(new Error(`Connection failed: ${errorMsg}`));
            });
        })
    }

    async _ensureConnected() {
        if (this.connecting) await this.connectionPromise;
        if (!this.socket || !this.socket.connected) throw new Error('[PBUI] Websocket not connected.');
    }

    _setupEventHandlers() {
        if (!this.socket) return;

        const socket = this.socket;

        socket.on('disconnect', (reason) => {
            console.warn(`[PBUI] Disconnected: ${reason}`);
            this._cleanupSocket();
            if (!this.manualDisconnect) {
                this._reconnect(apiUrl);
            } else {
                this.manualDisconnect = false;
            }
        });

        socket.on('initial-state', (data) => {
            this._triggerListeners('initial-state', data);
        });

        socket.on('state-updated', (data) => {
            this._triggerListeners('state-updated', data);
        })
    }

    _startHeartbeat() {
        if (this.heartbeatInterval) return;
        this._stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.socket?.connected) {
                this.socket.emit('ping');
            }
        }, 30000);
    }

    _stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    _reconnect() {
        if (this.reconnectionAttempts >= 10) {
            console.error('[PBUI] Max reconnection attempts reached or already reconnecting.');
            return;
        }
        this.connecting = true;
        let delay = Math.min(1000 * (2 ** this.reconnectionAttempts), 10000);
        this.reconnectionAttempts++;

        console.log(`[PBUI] Reconnecting in ${delay / 1000} seconds...`);

        setTimeout(() => {
            this.connect(apiUrl).catch((error) => {
                console.error('[PBUI] Reconnection failed:', error);
                this.connecting = false;
            });
        }, delay);
    }

    async disconnect() {
        if (!this.socket) {
            console.log(`[PBUI] WebSocket is not connected. Please connect before disconnecting.`);
            return;
        }

        this.manualDisconnect = true;
        this._stopHeartbeat();

        return new Promise((resolve) => {
            this.socket.once('disconnect', () => {
                this._cleanupSocket();
                console.log('[PBUI] WebSocket fully disconnected.');
                resolve();
            });
            this.socket.disconnect();
        })
    }

    _cleanupSocket() {
        if (this.socket) {
            this.socket.off();
            this.socket.disconnect();
            this.socket = null;
        }
        this._stopHeartbeat();
    }

    async on(event, callback) {
        await this._ensureConnected();

        if (!this.socket) {
            console.error('[PBUI] Not connected to WebSocket.');
            return;
        }
        this.socket.on(event, callback);
    }

    async send(event, data) {
        await this._ensureConnected();

        if (!this.socket) {
            console.error('[PBUI] Not connected to WebSocket.');
            return;
        }
        this.socket.emit(event, data);
    }

    async subscribe(event, listener) {
        await this._ensureConnected();

        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }

        if (!this.listeners[event].includes(listener)) {
            this.listeners[event].push(listener);
            console.log(`[PBUI] Subscribed to event: ${event}`);
        } else {
            console.log(`[PBUI] Listener already subscribed to event: ${event}`);
        }
    }

    async unsubscribe(event, listener) {
        await this._ensureConnected();

        if (!this.listeners[event]) {
            console.warn(`[PBUI] No listeners to remove for event: ${event}`);
            return;
        }

        const index = this.listeners[event].indexOf(listener);

        if (index === -1) {
            console.warn(`[PBUI] Listener not found for event: ${event}`);
            return;
        }

        this.listeners[event].splice(index, 1);
        console.log(`[PBUI] Unsubscribed from event: ${event}`);
    }

    _triggerListeners(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(listener => listener(data));
        }
    }

    setApiBase(url) {
        if (!url) {
            console.error('[PBUI] URL not provided to set as apiBase.');
            return;
        }
        try {
            new URL(url);
            if (url.endsWith('/')) {
                console.log(`[PBUI] API Url cannot have a trailing /`);
                return;
            }
            apiUrl = url;
        } catch (error) {
            console.log(`[PBUI] Invalid URL:`, url);
        }
    }

    // API outside of state
    setAuthToken(token) {
        this.authToken = token; // If token is invalid, that error will come when a function runs that requires auth
    }

    async upload(file, filename) {
        const formData = new FormData();
        formData.append('file', file, filename);

        const res = await fetch(`${apiUrl}/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await res.json();

        if (!res.ok || data.status !== 'success') {
            throw new Error(data.error || 'Upload failed');
        }

        return { url: data.url };
    }
}

class funcs {
    constructor() {
        this.defaultHeaders = { 'Content-Type': 'application/json' };
    }

    _valueEqual(obj1, obj2) {
        if (obj1 === obj2) return true;
        if (!obj1 || !obj2 || typeof obj1 !== 'object' || typeof obj2 !== 'object') return obj1 === obj2;

        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);

        if (keys1.length !== keys2.length) return false;

        for (let key of keys1) {
            if (!keys2.includes(key)) return false;

            if (!this._valueEqual(obj1[key], obj2[key])) return false;
        }

        return true;
    }

    _parseXML(xmlString) {
        const parser = new DOMParser();
        try {
            const xmlDoc = parser.parseFromString(xmlString, "application/xml");
            // Check for parsing errors
            const parseError = xmlDoc.getElementsByTagName("parsererror");
            if (parseError.length > 0) {
                throw new Error("Error parsing XML: " + parseError[0].textContent);
            }
            return xmlDoc;
        } catch (error) {
            console.error('[PBUI] XML Parsing error:', error);
            throw error;
        }
    }

    async _handleResponses(response) {
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes(Response_ResponseTypes.JSON)) {
            return await response.json();
        } else if (contentType.includes(Response_ResponseTypes.XML)) {
            const text = await response.text();
            return this._parseXML(text);
        } else if (contentType.includes(Response_ResponseTypes.TEXT)) {
            return await response.text();
        } else {
            throw new Error(`[PBUI] Unsupported response type: ${contentType}`);
        }
    }

    async _fetchData(endpoint, method = 'GET', body = null) {
        const url = `${apiUrl}${endpoint}`;
        const options = {
            method,
            headers: this.defaultHeaders,
            ...(body && { body: JSON.stringify(body) })
        };

        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`[PBUI] HTTP error! Status: ${response.status}`);
            }
            
            return this._handleResponses(response);
        } catch (error) {
            console.error(`[PBUI] Failed to fetch ${endpoint}`);
            throw error;
        }
    }
}

class PBUIState {
    constructor() {
        this.data = {};
        this.listeners = {};
        this.defaultHeaders = { 'Content-Type': 'application/json' };
    }

    _internalUpdate(key, value) {
        if (!funcs._valueEqual(this.data[key], value)) {
            this.data[key] = value;
            if (this.listeners[key]) {
                this.listeners[key].forEach(callback => callback(value));
            }
        }
    }

    async get(key = 'state', forceFetch = true) {
        if (key === 'state') {
            if (!this.data[key] || forceFetch) {
                console.log('[PBUI] Fetching state...');
                const data = await funcs._fetchData('/state');
                console.log(`[PBUI] State fetched:`, data)
                this._internalUpdate(key, data);
            }
            return this.data[key];
        }

        return this.data[key];
    }

    async update(songStates, currentFlowStep) {
        if (typeof songStates !== 'object' || songStates === null) {
            throw new Error('[PBUI] Invalid songStates: Must be an object.');
        }
        if (!Object.keys(songStates).length) {
            throw new Error('[PBUI] songStates should not be empty.');
        }
        if (typeof currentFlowStep !== 'number' || isNaN(currentFlowStep)) {
            throw new Error('[PBUI] Invalid flowStep: Must be a number.');
        }

        const body = { song_states: songStates, current_flow_step: currentFlowStep };
        const data = await funcs._fetchData('/update', 'POST', body);
        return Boolean(data.success);
    }

    async reset() {
        console.log('[PBUI] Resetting state...');
        const data = await funcs._fetchData('/reset', 'POST');
        console.log('[PBUI] State successfully reset!');
        return data.success;
    }
}

class Tournaments {
    constructor(authToken) {
        this.authToken = authToken;
    }

    async get(tournamentId = '', params = '', logging = false) {
        const numericRegex = /^[0-9]+$/;
        if (tournamentId === '') {
            if (params === '') {
                const tourneys = await funcs._fetchData('/getTournaments');
                if (logging) console.log(await tourneys.json());
                return await tourneys.json();
            } else {
                return console.error('[PBUI] You cannot specify parameters without specifying tournamentId');
            }
        } else if (!slugRegex.test(tournamentId) && numericRegex.test(tournamentId)) {
            let queryParams = '';
            if (params !== '') queryParams = `?${params}`;
            const tourney = await funcs._fetchData(`/getTournaments/${tournamentId}${queryParams}`);
            if (logging) console.log(await tourney.json());
            return await tourney.json();
        } else if (slugRegex.test(tournamentId)) {
            let queryParams = '';
            if (params !== '') queryParams = `?${params}`;
            const tourney = await funcs._fetchData(`/getTournaments/slug/${tournamentId}${queryParams}`);
            if (logging) console.log(await tourney.json());
            return await tourney.json();
        } else {
            throw new Error('[PBUI] tournamentId provided is not a valid numerical id or slug');
        }
    }

    async getPool(poolId) {
        const numericRegex = /^[0-9]+$/;

        if (!poolId) {
            console.error(`[PBUI] Pool ID not provided`);
            return;
        }

        if (!numericRegex.test(poolId)) {
            console.error(`[PBUI] Pool ID must only contain numbers`);
            return;
        }

        const res = await funcs._fetchData(`/getPool/${poolId}`);
        const data = await res.json();

        return data;
    }

    async create(element = 'tournament', info, authToken = this.authToken) {
        if (!info) {
            console.error(`[PBUI] Info must be provided on the element being created`);
        }

        if (element === 'tournament' || element === 'tourney') {
            if (!info.name || !info.slug) {
                console.error(`[PBUI] Tournament name or slug not provided`);
                return;
            }

            if (!slugRegex.test(info.slug)) {
                console.error(`[PBUI] Slug provided is not a valid slug`);
                return;
            }

            const res = await funcs._fetchData(
                '/createTournament',
                'POST',
                { 
                    name: info.name,
                    slug: info.slug
                }
            );

            const data = await res.json();

            if (data.status === 'success') {
                console.log(`[PBUI] Successfully created tournament:`, data);
            } else {
                console.log(`[PBUI] Failed to created tournament:`, data);
            }
        } else if (element === 'pool') {
            if (!info.tourneyId || !info.poolName) {
                console.error(`[PBUI] Tournament ID or Pool Name not provided`);
                return;
            }

            const res = await funcs._fetchData(
                '/createTournament?pool=true',
                'POST',
                {
                    tourneyId: info.tourneyId,
                    poolName: info.poolName
                }
            );

            const data = await res.json();

            if (data.status === 'success') {
                console.log(`[PBUI] Successfully created tournament pool:`, data);
            } else {
                console.error(`[PBUI] Failed to created tournament pool:`, data);
            }
        } else if (element === 'map') {
            if (!info.poolId || !info.hash || !info.diff) {
                console.error(`[PBUI] Pool ID, map hash, or map difficulty not provided`);
                return;
            }

            const res = await funcs._fetchData(
                '/createTournament?map=true',
                'POST',
                {
                    poolId: info.poolId,
                    hash: info.hash,
                    diff: info.diff
                }
            );

            const data = await res.json();

            if (data.status === 'success') {
                console.log(`[PBUI] Successfully created pool map:`, data);
            } else {
                console.error(`[PBUI] Failed to created pool map:`, data);
            }
        }
    }
}

export { PBUI };
export default PBUI;