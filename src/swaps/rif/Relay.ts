import { getBoltzConfig } from '../../utils/networkConfig';
import type { EnvelopingRequest } from './types/TypedRequestData';

export type Metadata = {
	signature?: string;
	relayMaxNonce: number;
	relayHubAddress: string;
};

type ChainInfo = {
	relayWorkerAddress: string;
	feesReceiver: string;
	relayManagerAddress: string;
	relayHubAddress: string;
	minGasPrice: string;
	chainId: string;
	networkId: string;
	ready: boolean;
	version: string;
};

type EstimationResponse = {
	gasPrice: string;
	estimation: string;
	requiredTokenAmount: string;
	requiredNativeAmount: string;
	exchangeRate: string;
};

type RelayResponse = {
	txHash: string;
	signedTx: string;
};

const sendPostRequest = (url: string, body: unknown) =>
	fetch(url, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});

const handleResponse = async <T>(res: Response): Promise<T> => {
	const json = await res.json();
	if ('error' in json) {
		throw json.error;
	}

	return json as T;
};

export const getChainInfo = (): Promise<ChainInfo> => {
	const config = getBoltzConfig();
	return fetch(`${config.rifRelayServerUrl}/chain-info`).then(handleResponse<ChainInfo>);
};

export const estimate = (
	relay: EnvelopingRequest,
	metadata: Metadata
): Promise<EstimationResponse> => {
	const config = getBoltzConfig();
	return sendPostRequest(`${config.rifRelayServerUrl}/estimate`, {
		metadata,
		relayRequest: relay
	}).then(handleResponse<EstimationResponse>);
};

export const relay = (relay: EnvelopingRequest, metadata: Metadata): Promise<RelayResponse> => {
	const config = getBoltzConfig();
	return sendPostRequest(`${config.rifRelayServerUrl}/relay`, {
		metadata,
		relayRequest: relay
	}).then(handleResponse<RelayResponse>);
};

