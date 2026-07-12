declare module 'bolt11' {
	interface Tag {
		tagName: string;
		data: string | number | unknown;
	}

	interface DecodedInvoice {
		paymentRequest?: string;
		millisatoshis?: string | null;
		satoshis?: number | null;
		timestamp?: number;
		timeExpireDate?: number;
		tags: Tag[];
		[key: string]: unknown;
	}

	function decode(paymentRequest: string): DecodedInvoice;
	function encode(data: Record<string, unknown>): string;

	export { decode, encode, Tag, DecodedInvoice };
	export default { decode, encode };
}
