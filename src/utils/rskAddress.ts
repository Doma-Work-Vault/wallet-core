import { ethers } from 'ethers';

function normalizeHexAddress(address: string): string {
	return `0x${address.slice(2).toLowerCase()}`;
}

function isMixedCase(address: string): boolean {
	const addr = address.slice(2);
	return /[a-f]/.test(addr) && /[A-F]/.test(addr);
}

function isValidHexAddress(address: string): boolean {
	return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function toEip1191ChecksumAddress(address: string, chainId: number): string {
	if (!isValidHexAddress(address)) {
		throw new Error('Invalid address format');
	}

	const addrLower = address.slice(2).toLowerCase();
	const hashInput = `${chainId}0x${addrLower}`;
	const hash = ethers.keccak256(ethers.toUtf8Bytes(hashInput)).slice(2);

	let result = '';
	for (let i = 0; i < addrLower.length; i++) {
		const char = addrLower[i];
		const hashNibble = parseInt(hash[i], 16);
		result += hashNibble >= 8 ? char.toUpperCase() : char;
	}

	return `0x${result}`;
}

export function isValidRskAddress(address: string, chainId: number): boolean {
	// First check if it's a valid hex address format
	if (!isValidHexAddress(address)) {
		return false;
	}

	// Accept lowercase or uppercase (no checksum)
	if (!isMixedCase(address)) {
		return true;
	}

	return toEip1191ChecksumAddress(address, chainId) === address;
}

export function normalizeRskAddress(address: string): string {
	if (!isValidHexAddress(address)) {
		throw new Error('Invalid address format');
	}
	return normalizeHexAddress(address);
}

export function areSameRskAddress(a?: string, b?: string): boolean {
	if (!a || !b) {
		return false;
	}
	if (!ethers.isAddress(a) || !ethers.isAddress(b)) {
		return false;
	}
	return normalizeHexAddress(a) === normalizeHexAddress(b);
}
