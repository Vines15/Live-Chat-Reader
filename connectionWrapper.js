const { WebcastPushConnection } = require('tiktok-live-connector');
const { EventEmitter } = require('events');

let globalConnectionCount = 0;

/**
 * TikTok LIVE connection wrapper with advanced reconnect functionality and error handling
 */
class TikTokConnectionWrapper extends EventEmitter {
    constructor(uniqueId, options, enableLog) {
        super();

        this.uniqueId = uniqueId;
        this.enableLog = enableLog;

        // Connection State
        this.clientDisconnected = false;
        this.reconnectEnabled = true;
        this.reconnectCount = 0;
        this.reconnectWaitMs = 1000;
        this.maxReconnectAttempts = 5;

        // this.connection = new WebcastPushConnection(uniqueId, options);

        this.connection = new WebcastPushConnection(uniqueId, {
    ...options,
    requestOptions: {
        headers: {
            'Accept-Language': 'vi-VN,vi;q=0.9',
            // Thêm User-Agent để giả lập trình duyệt Chrome thật, tránh lỗi 403
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    },
    clientParams: {
        "app_language": "vi-VN",
        "webcast_language": "vi-VN",
        "region": "VN"
    }
});
        

        this.connection.on('streamEnd', () => {
            this.log(`streamEnd event received, giving up connection`);
            this.reconnectEnabled = false;
        })

        this.connection.on('disconnected', () => {
            globalConnectionCount -= 1;
            this.log(`TikTok connection disconnected`);
            this.scheduleReconnect();
        });

        this.connection.on('error', (err) => {
            this.log(`Error event triggered: ${err.info}, ${err.exception}`);
            console.error(err);
        })
    }

    connect(isReconnect) {
        this.connection.connect().then((state) => {
            this.log(`${isReconnect ? 'Reconnected' : 'Connected'} to roomId ${state.roomId}, websocket: ${state.upgradedToWebsocket}`);

            globalConnectionCount += 1;

            // Reset reconnect vars
            this.reconnectCount = 0;
            this.reconnectWaitMs = 1000;

            // Client disconnected while establishing connection => drop connection
            if (this.clientDisconnected) {
                this.connection.disconnect();
                return;
            }

            // Notify client
            if (!isReconnect) {
                this.emit('connected', state);
            }

        }).catch((err) => {
            this.log(`${isReconnect ? 'Reconnect' : 'Connection'} failed, ${err}`);

            if (isReconnect) {
                // Schedule the next reconnect attempt
                this.scheduleReconnect(err);
            } else {
                // Notify client
                this.emit('disconnected', err.toString());
            }
        })
    }

    scheduleReconnect(reason) {

        if (!this.reconnectEnabled) {
            return;
        }

        if (this.reconnectCount >= this.maxReconnectAttempts) {
            this.log(`Give up connection, max reconnect attempts exceeded`);
            this.emit('disconnected', `Connection lost. ${reason}`);
            return;
        }

        this.log(`Try reconnect in ${this.reconnectWaitMs}ms`);

        setTimeout(() => {
            if (!this.reconnectEnabled || this.reconnectCount >= this.maxReconnectAttempts) {
                return;
            }

            this.reconnectCount += 1;
            this.reconnectWaitMs *= 2;
            this.connect(true);

        }, this.reconnectWaitMs)
    }

    disconnect() {
        this.log(`Client connection disconnected`);

        this.clientDisconnected = true;
        this.reconnectEnabled = false;

        if (this.connection.getState().isConnected) {
            this.connection.disconnect();
        }
    }

    log(logString) {
        if (this.enableLog) {
            console.log(`WRAPPER @${this.uniqueId}: ${logString}`);
        }
    }
}

module.exports = {
    TikTokConnectionWrapper,
    getGlobalConnectionCount: () => {
        return globalConnectionCount;
    }
};
