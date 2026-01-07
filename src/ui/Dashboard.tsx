import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { CrawlerManager, type CrawlerState } from '../lib/crawler-manager.js';
import { logStore, type LogEntry } from './log-store.js';

interface DashboardProps {
    crawlerManager: CrawlerManager;
}

const StatusTable = ({ states }: { states: CrawlerState[] }) => {
    return (
        <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
            <Box>
                <Box width="20%"><Text bold color="cyan">Category</Text></Box>
                <Box width="15%"><Text bold color="cyan">Region</Text></Box>
                <Box width="15%"><Text bold color="cyan">Status</Text></Box>
                <Box width="15%"><Text bold color="cyan">Records</Text></Box>
                <Box width="35%"><Text bold color="cyan">Last Run</Text></Box>
            </Box>
            <Box flexDirection="column">
                {states.map((state, index) => (
                    <Box key={`${state.category}-${state.region}`}>
                        <Box width="20%"><Text>{state.category}</Text></Box>
                        <Box width="15%"><Text>{state.region}</Text></Box>
                        <Box width="15%">
                            <Text color={
                                state.status === 'scraping' ? 'green' :
                                state.status === 'error' ? 'red' :
                                state.status === 'sleeping' ? 'yellow' : 'white'
                            }>
                                {state.status.toUpperCase()}
                            </Text>
                        </Box>
                        <Box width="15%"><Text>{state.totalRecords}</Text></Box>
                        <Box width="35%"><Text>{state.lastRun ? new Date(state.lastRun).toLocaleTimeString() : '-'}</Text></Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
};

const LogWindow = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);

    useEffect(() => {
        setLogs(logStore.getLogs(10));
        
        const handleLog = () => {
            setLogs(logStore.getLogs(10));
        };
        
        logStore.on('log', handleLog);
        return () => {
            logStore.off('log', handleLog);
        };
    }, []);

    return (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" marginTop={1}>
            <Text bold>Recent Logs</Text>
            {logs.map((log, i) => (
                <Box key={i}>
                    <Text color="gray">[{log.timestamp}] </Text>
                    <Text color={
                        log.level === 'error' ? 'red' :
                        log.level === 'warn' ? 'yellow' : 'white'
                    }>
                        {log.message}
                    </Text>
                </Box>
            ))}
        </Box>
    );
};

export const Dashboard: React.FC<DashboardProps> = ({ crawlerManager }) => {
    const [states, setStates] = useState<CrawlerState[]>([]);

    useEffect(() => {
        setStates(crawlerManager.getAllStates());

        const handleUpdate = (newStates: CrawlerState[]) => {
            setStates(newStates);
        };

        crawlerManager.on('state-update', handleUpdate);
        return () => {
            crawlerManager.off('state-update', handleUpdate);
        };
    }, [crawlerManager]);

    return (
        <Box flexDirection="column" padding={1}>
            <Text bold color="green" underline>Price Crawl</Text>
            <Text color="gray">Press Ctrl+C to exit</Text>
            
            <Box marginY={1}>
                <StatusTable states={states} />
            </Box>

            <LogWindow />
        </Box>
    );
};
