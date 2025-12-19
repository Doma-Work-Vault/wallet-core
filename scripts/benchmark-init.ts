/**
 * Wallet Initialization Benchmarking Script
 * 
 * This script measures and logs wallet initialization times to identify performance bottlenecks.
 * It maintains a running log and compares current results to previous runs.
 * 
 * Usage:
 *   npm run benchmark
 *   or
 *   npx tsx scripts/benchmark-init.ts
 */

import { WalletManager, type WalletManagerConfig } from '../src/core/WalletManager';
import { RSKWallet } from '../src/chains/rsk/RSKWallet';
import { BSCWallet } from '../src/chains/bsc/BSCWallet';
import { BoltzWebSocket } from '../src/swaps/boltz/WebSocketClient';
import { BoltzClient } from '../src/swaps/boltz/BoltzClient';
import { EvmContractService } from '../src/swaps/boltz/EvmContractService';
import { getWebSocketEndpoint } from '../src/utils/networkConfig';
import type { NetworkType } from '../src/core/types';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Test mnemonic (use a test mnemonic, never use a real one)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const BENCHMARK_LOG_FILE = join(process.cwd(), 'benchmark-results.json');
const BENCHMARK_LOG_DIR = join(process.cwd(), 'benchmark-logs');

interface BenchmarkResult {
    name: string;
    duration: number;
    phases: Record<string, number>;
    success: boolean;
    error?: string;
}

interface BenchmarkRun {
    timestamp: string;
    results: BenchmarkResult[];
    summary: {
        averageDuration: number;
        minDuration: number;
        maxDuration: number;
        totalTests: number;
        successfulTests: number;
    };
}

interface BenchmarkLog {
    runs: BenchmarkRun[];
}

interface PhaseTimer {
    start: number;
    end?: number;
    duration?: number;
}

class BenchmarkRunner {
    private results: BenchmarkResult[] = [];
    private currentPhases: Map<string, PhaseTimer> = new Map();

    /**
     * Start timing a phase
     */
    startPhase(name: string): void {
        this.currentPhases.set(name, { start: performance.now() });
    }

    /**
     * End timing a phase
     */
    endPhase(name: string): number {
        const phase = this.currentPhases.get(name);
        if (!phase) {
            console.warn(`Phase ${name} was not started`);
            return 0;
        }
        phase.end = performance.now();
        phase.duration = phase.end - phase.start;
        return phase.duration;
    }

    /**
     * Record a benchmark result
     */
    recordResult(name: string, phases: Record<string, number>, success: boolean, error?: string): void {
        const totalDuration = Object.values(phases).reduce((sum, d) => sum + d, 0);
        this.results.push({
            name,
            duration: totalDuration,
            phases,
            success,
            error
        });
    }

    /**
     * Get current results
     */
    getResults(): BenchmarkResult[] {
        return this.results;
    }

    /**
     * Load previous benchmark log
     */
    async loadPreviousLog(): Promise<BenchmarkLog | null> {
        try {
            if (!existsSync(BENCHMARK_LOG_FILE)) {
                return null;
            }
            const content = await readFile(BENCHMARK_LOG_FILE, 'utf-8');
            if (!content || content.trim() === '') {
                return null;
            }
            const parsed = JSON.parse(content) as BenchmarkLog;
            // Validate structure
            if (!parsed.runs || !Array.isArray(parsed.runs)) {
                return null;
            }
            return parsed;
        } catch (error) {
            // Silently ignore parse errors - file might be corrupted or empty
            return null;
        }
    }

    /**
     * Save benchmark log
     */
    async saveLog(run: BenchmarkRun): Promise<void> {
        const log: BenchmarkLog = await this.loadPreviousLog() || { runs: [] };
        
        // Add new run
        log.runs.push(run);
        
        // Keep only last 50 runs
        if (log.runs.length > 50) {
            log.runs = log.runs.slice(-50);
        }
        
        // Save to main log file
        await writeFile(BENCHMARK_LOG_FILE, JSON.stringify(log, null, 2));
        
        // Also save individual run to timestamped file
        if (!existsSync(BENCHMARK_LOG_DIR)) {
            await mkdir(BENCHMARK_LOG_DIR, { recursive: true });
        }
        const timestampFile = join(BENCHMARK_LOG_DIR, `benchmark-${run.timestamp.replace(/[:.]/g, '-')}.json`);
        await writeFile(timestampFile, JSON.stringify(run, null, 2));
    }

    /**
     * Compare current run to previous run
     */
    compareRuns(current: BenchmarkRun, previous: BenchmarkRun | null): void {
        if (!previous) {
            console.log('\n📊 This is the first benchmark run. No comparison available.');
            return;
        }

        console.log('\n' + '='.repeat(80));
        console.log('COMPARISON TO PREVIOUS RUN');
        console.log('='.repeat(80));
        console.log(`Previous Run: ${previous.timestamp}`);
        console.log(`Current Run:  ${current.timestamp}`);
        console.log('');

        // Compare summary
        const avgDiff = current.summary.averageDuration - previous.summary.averageDuration;
        const avgDiffPercent = (avgDiff / previous.summary.averageDuration) * 100;
        const avgIcon = avgDiff < 0 ? '✅' : '⚠️';
        console.log(`Average Duration: ${avgIcon} ${avgDiff > 0 ? '+' : ''}${avgDiff.toFixed(2)}ms (${avgDiffPercent > 0 ? '+' : ''}${avgDiffPercent.toFixed(1)}%)`);

        // Compare individual tests
        console.log('\nIndividual Test Comparisons:');
        console.log('-'.repeat(80));

        const previousResultsMap = new Map(previous.results.map(r => [r.name, r]));
        
        current.results.forEach(result => {
            const prevResult = previousResultsMap.get(result.name);
            if (!prevResult) {
                console.log(`  ${result.name}: NEW TEST`);
                return;
            }

            if (!result.success || !prevResult.success) {
                console.log(`  ${result.name}: ${result.success ? '✅ Fixed' : '❌ Failed'} (was ${prevResult.success ? '✅' : '❌'})`);
                return;
            }

            const diff = result.duration - prevResult.duration;
            const diffPercent = (diff / prevResult.duration) * 100;
            const icon = diff < 0 ? '✅' : diff > 100 ? '⚠️' : '➡️';
            const change = diff < 0 ? 'faster' : 'slower';
            
            console.log(`  ${result.name}:`);
            console.log(`    ${icon} ${Math.abs(diff).toFixed(2)}ms ${change} (${Math.abs(diffPercent).toFixed(1)}%)`);
            console.log(`    Previous: ${prevResult.duration.toFixed(2)}ms → Current: ${result.duration.toFixed(2)}ms`);
        });
    }

    /**
     * Print formatted results
     */
    printResults(previousRun: BenchmarkRun | null = null): void {
        console.log('\n' + '='.repeat(80));
        console.log('WALLET INITIALIZATION BENCHMARK RESULTS');
        console.log('='.repeat(80) + '\n');

        this.results.forEach((result, index) => {
            console.log(`\n${index + 1}. ${result.name}`);
            console.log('-'.repeat(80));
            
            if (!result.success) {
                console.log(`❌ FAILED: ${result.error}`);
                return;
            }

            console.log(`✅ Total Duration: ${result.duration.toFixed(2)}ms (${(result.duration / 1000).toFixed(2)}s)`);
            console.log('\nPhase Breakdown:');
            
            const sortedPhases = Object.entries(result.phases)
                .sort(([, a], [, b]) => b - a);

            sortedPhases.forEach(([phaseName, duration]) => {
                const percentage = (duration / result.duration) * 100;
                const barLength = Math.round(percentage / 2);
                const bar = '█'.repeat(barLength);
                console.log(`  ${phaseName.padEnd(30)} ${duration.toFixed(2).padStart(10)}ms ${percentage.toFixed(1).padStart(6)}% ${bar}`);
            });
        });

        // Summary statistics
        const successfulResults = this.results.filter(r => r.success);
        if (successfulResults.length > 0) {
            const avgDuration = successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length;
            const minDuration = Math.min(...successfulResults.map(r => r.duration));
            const maxDuration = Math.max(...successfulResults.map(r => r.duration));

            console.log('\n' + '='.repeat(80));
            console.log('SUMMARY STATISTICS');
            console.log('='.repeat(80));
            console.log(`Average Duration: ${avgDuration.toFixed(2)}ms (${(avgDuration / 1000).toFixed(2)}s)`);
            console.log(`Min Duration:     ${minDuration.toFixed(2)}ms (${(minDuration / 1000).toFixed(2)}s)`);
            console.log(`Max Duration:     ${maxDuration.toFixed(2)}ms (${(maxDuration / 1000).toFixed(2)}s)`);
            console.log(`Successful Tests: ${successfulResults.length}/${this.results.length}`);
        }
    }

    /**
     * Create benchmark run summary
     */
    createRunSummary(): BenchmarkRun {
        const successfulResults = this.results.filter(r => r.success);
        const avgDuration = successfulResults.length > 0
            ? successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length
            : 0;
        const minDuration = successfulResults.length > 0
            ? Math.min(...successfulResults.map(r => r.duration))
            : 0;
        const maxDuration = successfulResults.length > 0
            ? Math.max(...successfulResults.map(r => r.duration))
            : 0;

        return {
            timestamp: new Date().toISOString(),
            results: this.results,
            summary: {
                averageDuration: avgDuration,
                minDuration,
                maxDuration,
                totalTests: this.results.length,
                successfulTests: successfulResults.length
            }
        };
    }
}

/**
 * Benchmark: Full WalletManager initialization
 */
async function benchmarkFullInitialization(runner: BenchmarkRunner, network: NetworkType): Promise<void> {
    const testName = `Full WalletManager Initialization (${network})`;
    console.log(`\n🔄 Running: ${testName}...`);

    runner.startPhase('constructor');
    let manager: WalletManager;
    try {
        manager = new WalletManager({
            network,
            mnemonic: TEST_MNEMONIC
        });
        const constructorTime = runner.endPhase('constructor');

        runner.startPhase('initialize');
        await manager.initialize();
        const initializeTime = runner.endPhase('initialize');

        runner.recordResult(testName, {
            'Constructor': constructorTime,
            'Initialize': initializeTime
        }, true);

        // Cleanup
        await manager.dispose();
    } catch (error) {
        runner.recordResult(testName, {}, false, error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Benchmark: RSK Wallet initialization only
 */
async function benchmarkRSKWallet(runner: BenchmarkRunner, network: NetworkType): Promise<void> {
    const testName = `RSK Wallet Initialization (${network})`;
    console.log(`\n🔄 Running: ${testName}...`);

    try {
        runner.startPhase('create_wallet');
        const wallet = new RSKWallet({ network });
        const createTime = runner.endPhase('create_wallet');

        runner.startPhase('initialize');
        await wallet.initialize(TEST_MNEMONIC);
        const initTime = runner.endPhase('initialize');

        runner.startPhase('get_block_number');
        await wallet.getBlockNumber();
        const blockTime = runner.endPhase('get_block_number');

        runner.recordResult(testName, {
            'Create Wallet': createTime,
            'Initialize': initTime,
            'Get Block Number': blockTime
        }, true);

        wallet.disconnect();
    } catch (error) {
        runner.recordResult(testName, {}, false, error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Benchmark: BSC Wallet initialization only
 */
async function benchmarkBSCWallet(runner: BenchmarkRunner, network: 'mainnet' | 'testnet'): Promise<void> {
    const testName = `BSC Wallet Initialization (${network})`;
    console.log(`\n🔄 Running: ${testName}...`);

    try {
        runner.startPhase('create_wallet');
        const wallet = new BSCWallet({ network });
        const createTime = runner.endPhase('create_wallet');

        runner.startPhase('initialize');
        await wallet.initialize(TEST_MNEMONIC);
        const initTime = runner.endPhase('initialize');

        runner.startPhase('get_block_number');
        await wallet.getBlockNumber();
        const blockTime = runner.endPhase('get_block_number');

        runner.recordResult(testName, {
            'Create Wallet': createTime,
            'Initialize': initTime,
            'Get Block Number': blockTime
        }, true);

        wallet.disconnect();
    } catch (error) {
        runner.recordResult(testName, {}, false, error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Benchmark: WebSocket connection
 */
async function benchmarkWebSocket(runner: BenchmarkRunner, network: NetworkType): Promise<void> {
    const testName = `WebSocket Connection (${network})`;
    console.log(`\n🔄 Running: ${testName}...`);

    try {
        runner.startPhase('create_websocket');
        const ws = new BoltzWebSocket(getWebSocketEndpoint());
        const createTime = runner.endPhase('create_websocket');

        runner.startPhase('connect');
        await ws.connect();
        const connectTime = runner.endPhase('connect');

        runner.recordResult(testName, {
            'Create WebSocket': createTime,
            'Connect': connectTime
        }, true);

        ws.disconnect();
    } catch (error) {
        runner.recordResult(testName, {}, false, error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Benchmark: Boltz Client initialization
 */
async function benchmarkBoltzClient(runner: BenchmarkRunner): Promise<void> {
    const testName = 'Boltz Client Initialization';
    console.log(`\n🔄 Running: ${testName}...`);

    try {
        runner.startPhase('create_client');
        const client = new BoltzClient();
        const createTime = runner.endPhase('create_client');

        runner.startPhase('get_swap_pairs');
        await client.getSubmarineSwapPairs();
        const pairsTime = runner.endPhase('get_swap_pairs');

        runner.recordResult(testName, {
            'Create Client': createTime,
            'Get Swap Pairs': pairsTime
        }, true);
    } catch (error) {
        runner.recordResult(testName, {}, false, error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Benchmark: EVM Contract Service initialization
 */
async function benchmarkEvmContractService(runner: BenchmarkRunner): Promise<void> {
    const testName = 'EVM Contract Service Initialization';
    console.log(`\n🔄 Running: ${testName}...`);

    try {
        runner.startPhase('create_boltz_client');
        const boltzClient = new BoltzClient();
        const boltzTime = runner.endPhase('create_boltz_client');

        runner.startPhase('create_evm_service');
        const evmService = new EvmContractService(boltzClient);
        const evmTime = runner.endPhase('create_evm_service');

        runner.startPhase('get_contract_address');
        await evmService.getEtherSwapAddress();
        const addressTime = runner.endPhase('get_contract_address');

        runner.recordResult(testName, {
            'Create Boltz Client': boltzTime,
            'Create EVM Service': evmTime,
            'Get Contract Address': addressTime
        }, true);
    } catch (error) {
        runner.recordResult(testName, {}, false, error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Main benchmark runner
 */
async function runBenchmarks(): Promise<void> {
    const runner = new BenchmarkRunner();
    
    console.log('🚀 Starting Wallet Initialization Benchmarks...\n');

    // Load previous run for comparison
    const previousLog = await runner.loadPreviousLog();
    const previousRun = previousLog && previousLog.runs.length > 0
        ? previousLog.runs[previousLog.runs.length - 1]
        : null;

    if (previousRun) {
        console.log(`📊 Previous benchmark run found: ${previousRun.timestamp}`);
        console.log(`   Average duration: ${previousRun.summary.averageDuration.toFixed(2)}ms\n`);
    }

    // Test on testnet (safer and faster)
    const network: NetworkType = 'testnet';

    // Run individual component benchmarks
    await benchmarkRSKWallet(runner, network);
    await benchmarkBSCWallet(runner, network);
    await benchmarkWebSocket(runner, network);
    await benchmarkBoltzClient(runner);
    await benchmarkEvmContractService(runner);

    // Run full initialization benchmark
    await benchmarkFullInitialization(runner, network);

    // Create current run summary
    const currentRun = runner.createRunSummary();

    // Print results
    runner.printResults(previousRun);

    // Compare to previous run
    runner.compareRuns(currentRun, previousRun);

    // Save log
    await runner.saveLog(currentRun);
    console.log(`\n📊 Results saved to ${BENCHMARK_LOG_FILE}`);
}

// Run benchmarks
runBenchmarks().catch(error => {
    console.error('❌ Benchmark failed:', error);
    // Exit with code 0 even on error - some tests may fail due to missing services
    process.exit(0);
});

