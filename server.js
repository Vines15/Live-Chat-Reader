require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { TikTokConnectionWrapper, getGlobalConnectionCount } = require('./connectionWrapper');
const { clientBlocked } = require('./limiter');
const { SignConfig } = require('tiktok-live-connector');

if (process.env.API_KEY) {
    SignConfig.apiKey = process.env.API_KEY;
    console.info('Using Euler API key from environment');
}

const app = express();
const httpServer = createServer(app);

// Enable cross-origin resource sharing
const io = new Server(httpServer, {
    cors: {
        origin: '*'
    }
});

io.on('connection', (socket) => {
    let tiktokConnectionWrapper;

    console.info('New connection from origin', socket.handshake.headers['origin'] || socket.handshake.headers['referer']);

    socket.on('setUniqueId', async (uniqueId, options) => {

        // Prohibit the client from specifying these options (for security reasons)
        if (typeof options === 'object' && options) {
            delete options.requestOptions;
            delete options.websocketOptions;
        } else {
            options = {};
        }

        // 2. GÀI CỨNG CẤU HÌNH TIẾNG VIỆT (Server-side)
        const viNConfig = {
            webConfigOverrides: {
                DEFAULT_HTTP_CLIENT_PARAMS: {
                    app_language: 'vi-VN',
                    webcast_language: 'vi-VN',
                    browser_language: 'vi-VN',
                    region: 'VN',
                    device_platform: 'web_pc'
                },
                DEFAULT_HTTP_CLIENT_HEADERS: {
                    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            },
            wsConfigOverrides: {
                DEFAULT_WS_CLIENT_PARAMS: {
                    app_language: 'vi-VN',
                    webcast_language: 'vi-VN',
                    region: 'VN',
                    device_platform: 'web_pc'
                },
                DEFAULT_WS_CLIENT_HEADERS: {
                    'Accept-Language': 'vi-VN,vi;q=0.9'
                }
            }
        };

        // Trộn cấu hình tiếng Việt vào options (Hỗ trợ cả bản cũ lẫn bản mới của thư viện)
        Object.assign(options, viNConfig);
        options.clientOptions = Object.assign({}, options.clientOptions, viNConfig);        

        // Session ID in .env file is optional
        if (process.env.SESSIONID) {
            options.sessionId = process.env.SESSIONID;
            console.info('Using SessionId');
        }

        // CHỐNG SPAM: Bắt buộc kiểm tra rate limit để giữ server ổn định khi không có Captcha
        if (process.env.ENABLE_RATE_LIMIT && clientBlocked(io, socket)) {
            socket.emit('tiktokDisconnected', 'You have opened too many connections or made too many connection requests. Please reduce the number of connections/requests or host your own server instance. The connections are limited to avoid that the server IP gets blocked by TikTok.');
            return;
        }

        // Disconnect previous connection if exists
        if (tiktokConnectionWrapper) {
            tiktokConnectionWrapper.disconnect();
        }

        // Connect to the given username (uniqueId)
        try {
            tiktokConnectionWrapper = new TikTokConnectionWrapper(uniqueId, options, true);
            tiktokConnectionWrapper.connect();
        } catch (err) {
            socket.emit('tiktokDisconnected', err.toString());
            return;
        }

        // Redirect wrapper control events once
        tiktokConnectionWrapper.once('connected', state => socket.emit('tiktokConnected', state));
        tiktokConnectionWrapper.once('disconnected', reason => socket.emit('tiktokDisconnected', reason));

        // Notify client when stream ends
        tiktokConnectionWrapper.connection.on('streamEnd', () => socket.emit('streamEnd'));

        // Redirect message events        
        tiktokConnectionWrapper.connection.on('member', msg => socket.emit('member', msg));
        tiktokConnectionWrapper.connection.on('chat', msg => socket.emit('chat', msg));
        tiktokConnectionWrapper.connection.on('gift', msg => socket.emit('gift', msg));
        tiktokConnectionWrapper.connection.on('roomUser', msg => socket.emit('roomUser', msg));
        tiktokConnectionWrapper.connection.on('like', msg => socket.emit('like', msg));      
        tiktokConnectionWrapper.connection.on('social', msg => socket.emit('social', msg));
        tiktokConnectionWrapper.connection.on('questionNew', msg => socket.emit('questionNew', msg));
        tiktokConnectionWrapper.connection.on('linkMicBattle', msg => socket.emit('linkMicBattle', msg));
        tiktokConnectionWrapper.connection.on('linkMicArmies', msg => socket.emit('linkMicArmies', msg));
        tiktokConnectionWrapper.connection.on('liveIntro', msg => socket.emit('liveIntro', msg));
        tiktokConnectionWrapper.connection.on('emote', msg => socket.emit('emote', msg));
        tiktokConnectionWrapper.connection.on('envelope', msg => socket.emit('envelope', msg));                   
        tiktokConnectionWrapper.connection.on('superFan', msg => socket.emit('superFan', msg));
        tiktokConnectionWrapper.connection.on('superFanJoin', msg => socket.emit('superFanJoin', msg));
        tiktokConnectionWrapper.connection.on('superFanBox', msg => socket.emit('superFanBox', msg));           
        
        // Redirect custom events
        tiktokConnectionWrapper.connection.on('follow', msg => socket.emit('follow', msg));
        tiktokConnectionWrapper.connection.on('share', msg => socket.emit('share', msg));  
        tiktokConnectionWrapper.connection.on('goalUpdate', msg => socket.emit('goalUpdate', msg));               
    });

    socket.on('disconnect_tiktok', () => {
        if (tiktokConnectionWrapper) {
            tiktokConnectionWrapper.disconnect();
            tiktokConnectionWrapper = null;
        }
    });

    socket.on('disconnect', () => {
        if (tiktokConnectionWrapper) {
            tiktokConnectionWrapper.disconnect();
        }
    });
});

// Emit global connection statistics
setInterval(() => {
    io.emit('statistic', { globalConnectionCount: getGlobalConnectionCount() });
}, 5000);

// Giao diện tĩnh (Frontend) vẫn hoạt động bình thường
app.use(express.static('public'));

// Start http listener
const port = process.env.PORT || 8081;
httpServer.listen(port);
console.info(`Server running! At port:${port}`);
