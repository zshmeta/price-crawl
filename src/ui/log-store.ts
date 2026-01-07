import { Logger, LogLevel } from 'crawlee';
import { EventEmitter } from 'events';

export interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
}

class LogStore extends EventEmitter {
    private logs: LogEntry[] = [];
    private maxLogs = 1000;

    add(level: 'info' | 'warn' | 'error', message: string) {
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
    }

    getLogs(count = 50): LogEntry[] {
        return this.logs.slice(-count);
    }
}

export const logStore = new LogStore();



// Custom logger to intercept Crawlee logs and send them to our dashboard
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

        // Format message with data/exception if present, similar to how Crawlee does it
        // simplified for TUI
        let finalMessage = message;
        if (exception) {
            finalMessage += ` - ${(exception as Error).message || exception}`;
        }
        if (data) {
             // Avoid stringifying large objects if possible, or keep it simple
             // finalMessage += ` ${JSON.stringify(data)}`;
        }

        logStore.add(storeLevel, finalMessage);

        // Optionally still output to console if needed, but we are replacing the logger
        // so we probably only want it in the store.
        // this._outputWithConsole(level, message); 
    }
}

export function getLogHandler() {
    return new DashboardLogger();
}
