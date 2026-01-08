import { Logger, LogLevel } from 'crawlee';
import { EventEmitter } from 'events';
import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '../../logs');
const LOG_FILE = join(LOG_DIR, 'debug.log');

export interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
}

class LogStore extends EventEmitter {
    private logs: LogEntry[] = [];
    private maxLogs = 1000;
    
    constructor() {
        super();
        this.initFileLogging();
    }

    private async initFileLogging() {
        try {
            await mkdir(LOG_DIR, { recursive: true });
        } catch (error) {
            console.error('Failed to create log directory:', error);
        }
    }

    add(level: 'info' | 'warn' | 'error', message: string) {
        const timestamp = new Date().toISOString();
        const entry: LogEntry = {
            timestamp: new Date().toLocaleTimeString(),
            level,
            message
        };
        
        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        this.emit('log', entry);

        // Append to file asynchronously (fire and forget)
        const fileLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
        appendFile(LOG_FILE, fileLine).catch(err => {
            // Last resort error handling to avoid crashing
            console.error('Failed to write log:', err);
        });
    }

    getLogs(count = 50): LogEntry[] {
        return this.logs.slice(-count);
    }
}

export const logStore = new LogStore();

// Custom logger to intercept Crawlee logs and send them to our dashboard + file
export class DashboardLogger extends Logger {
    constructor() {
        super({
            // Initialize with default options if needed
            prefix: 'Crawler', 
        });
    }

    _log(level: LogLevel, message: string, data?: any, exception?: unknown, opts?: Record<string, any>): void {
        let storeLevel: 'info' | 'warn' | 'error' = 'info';

        switch (level) {
            case LogLevel.ERROR:
            case LogLevel.SOFT_FAIL:
                storeLevel = 'error';
                break;
            case LogLevel.WARNING:
                storeLevel = 'warn';
                break;
            case LogLevel.INFO:
            case LogLevel.DEBUG:
            case LogLevel.PERF:
            default:
                storeLevel = 'info';
                break;
        }

        // Format message with data/exception if present
        let finalMessage = message;
        if (exception) {
            finalMessage += ` - ${(exception as Error).message || exception}`;
        }
        if (data) {
             // Avoid stringifying large objects if possible, or keep it simple
             // finalMessage += ` ${JSON.stringify(data)}`;
        }

        logStore.add(storeLevel, finalMessage);
    }
}

export function getLogHandler() {
    return new DashboardLogger();
}
