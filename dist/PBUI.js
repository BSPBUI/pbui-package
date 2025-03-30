import { io } from 'socket.io-client';

class PBUI {
    constructor() {
        this.socket = null;
        this.apiBaseURL = 'https://api.pbui.net';
        this.listeners = {};
        this.state = new PBUIState(this.apiBaseURL);
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
            await this._establishConnection(options);
            this._startHeartbeat();
        } catch (error) {
            console.error('[PBUI] Connection failed:', error);
            this._reconnect();
        }

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
            this.socket = io(this.apiBaseURL, {
                transports: ['websocket'],
                secure: true,
                rejectUnauthorized: process.env.NODE_ENV === 'development' ? false : true,
                reconnection: false,
                timeout: 5000,
                ...options
            });

            this.socket.once('connect', () => {
                console.log(`[PBUI] Connected to WebSocket: ${this.apiBaseURL}`);
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
        if (!this.socket.connected) throw new Error('[PBUI] Websocket not connected. Call connect() first.');
    }

    _setupEventHandlers() {
        if (!this.socket) return;

        const socket = this.socket;

        socket.on('disconnect', (reason) => {
            console.warn(`[PBUI] Disconnected: ${reason}`);
            this._cleanupSocket();
            if (!this.manualDisconnect) {
                this._reconnect(this.apiBaseURL);
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
        if (this.reconnectionAttempts >= 10 || this.connecting) {
            console.error('[PBUI] Max reconnection attempts reached or already reconnecting.');
            return;
        }
        this.connecting = true;
        let delay = Math.min(1000 * (2 ** this.reconnectionAttempts), 10000);
        this.reconnectionAttempts++;

        console.log(`[PBUI] Reconnecting in ${delay / 1000} seconds...`);

        setTimeout(() => {
            this.connect(this.apiBaseURL).catch((error) => {
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
            this.listeners[event].forEach(listener => listener(data.json()));
        }
    }

    setApiBase(url) {
        if (!url) {
            console.error('[PBUI] URL not provided to set as ApiBase.');
            return;
        }
        this.apiBaseURL = url;
    }
}

class PBUIState {
    constructor(apiBaseURL) {
        this.data = {};
        this.listeners = {};
        this.apiBaseURL = `${apiBaseURL}/api` || 'https://api.pbui.net/api';
        this.defaultHeaders = { 'Content-Type': 'application/json' };
    }

    _internalUpdate(key, value) {
        if (!this._valueEqual(this.data[key], value)) {
            this.data[key] = value;
            if (this.listeners[key]) {
                this.listeners[key].forEach(callback => callback(value));
            }
        }
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

    async fetchData(endpoint, method = 'GET', body = null) {
        const url = `${this.apiBaseURL}${endpoint}`;
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
            return await response.json();
        } catch (error) {
            console.error(`[PBUI] Failed to fetch ${endpoint}`);
            throw error;
        }
    }

    async get(key = 'state', forceFetch = true) {
        if (key === 'state') {
            if (!this.data[key] || forceFetch) {
                console.log('[PBUI] Fetching state...');
                const data = await this.fetchData('/state');
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
        const data = await this.fetchData('/update', 'POST', body);
        return data.success;
    }

    async reset() {
        console.log('[PBUI] Resetting state...');
        const data = await this.fetchData('/reset', 'POST');
        console.log('[PBUI] State successfully reset!');
        return data.success;
    }
}

export { PBUI };
export default PBUI;