'use strict';

class LocalClient {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.baseUrl = '/api/v1/player/user';
        this.isConnected = false;
    }

    async login() {
        try {
            const res = await fetch(`${this.baseUrl}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getUserAuthHeaders() },
                body: JSON.stringify({ username: this.username, password: this.password })
            });
            const data = await res.json();
            this.isConnected = data.success === true;
            return this.isConnected;
        } catch {
            this.isConnected = false;
            return false;
        }
    }

    async getList() {
        const res = await fetch(`${this.baseUrl}/list`, { headers: getUserAuthHeaders() });
        if (!res.ok) throw new Error(`读取同步数据失败 (${res.status})`);
        return await res.json();
    }

    async updateList(data, options = {}) {
        const query = options.refreshedNetworkListId ? '?' + new URLSearchParams({ refreshedNetworkListId: options.refreshedNetworkListId }) : '';
        const res = await fetch(`${this.baseUrl}/list${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getUserAuthHeaders() },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`保存同步数据失败 (${res.status})`);
        return await res.json();
    }

    close() {
        this.isConnected = false;
    }
}

const SyncManager = {
    client: null,
    mode: 'local',

    initLocal(username, password) {
        this.client = new LocalClient(username, password);
        this.mode = 'local';
    },

    async sync() {
        if (!this.client) throw new Error('同步账户尚未初始化');
        return await this.client.getList();
    },

    async push(data, options = {}) {
        if (!this.client) throw new Error('同步账户尚未初始化');
        return await this.client.updateList(data, options);
    }
};

window.SyncManager = SyncManager;
