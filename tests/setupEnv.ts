/**
 * Runs before any test file. No Telegram, MongoDB, or Redis required.
 * Ensures `src/config` validates when modules under test import it.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.TG_API_ID = '123456';
process.env.TG_API_HASH = 'deadbeefdeadbeefdeadbeefdeadbeef';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/tg_send_mult_test';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.SESSION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.API_BASIC_USER = 'test';
process.env.API_BASIC_PASSWORD = 'test';
