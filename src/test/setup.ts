/**
 * Test Setup File
 * 
 * This file runs before all tests and sets up global test configuration,
 * mocks, and utilities.
 */

import { beforeEach, afterEach, vi } from 'vitest';

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Reset modules if needed
beforeEach(() => {
  // Reset any global state here
});

