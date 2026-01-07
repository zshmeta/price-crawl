declare module 'browserless' {
    export interface BrowserInstance {
        createContext(options?: { retry?: number }): Promise<BrowserContext>;
        close(): Promise<void>;
    }

    export interface BrowserContext {
        withPage<T>(
            fn: (page: any, goto: any) => (opts: any) => Promise<T>,
            options?: { timeout?: number }
        ): (opts: any) => Promise<T>;
        destroyContext(): Promise<void>;
    }

    export default function createBrowser(options?: {
        timeout?: number;
        lossyDeviceName?: boolean;
        ignoreHTTPSErrors?: boolean;
    }): BrowserInstance;
}
