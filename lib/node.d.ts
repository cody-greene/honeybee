declare module 'honeybee' {
	import type {Duplex} from 'stream'
	import type {Agent as HttpAgent} from 'http'

	export class RequestError extends Error {
		constructor(status?: number, msg?: string)
		statusCode: number
		headers: {[key:string]: string|undefined}
		body: any
	}

	export type Req = {
		url: string
		method: string
		query?: object
		headers: {[key:string]: string|undefined}
		body?: any
	}

	export type Response<T=any> = {
		statusCode: number
		headers: {[key:string]: string|undefined}
		body: T
	}

	export interface AuthorizationAgent {
		toHeader(): string|undefined|null
		refresh:
			& ((req:Req, err:Error) => PromiseLike<void>)
			& ((req:Req, err:Error, done: ((err: Error|undefined|null) => void)) => void)
	}

	// readonly
	export type Options = {
		url?: string,
		method?: string,
		query?: {[key:string]: any},
		headers?: {[key:string]: string|undefined},
		body?: any,
		low?: number,
		high?: number,
		total?: number,
		serialize?: 'json' | 'form' | 'noop' | ((req:Req) => any),
		parseResponse?: 'json' | 'raw' | ((req:Req, res:Response<any>) => any),
		parseError?: 'json' | 'text' | ((req:Req, res:Response<any>) => Error),
		auth?: AuthorizationAgent,
		timeout?: number,
		maxRedirects?: number,
		gzip?: boolean,
		conn?: HttpAgent,
	}

	type HoneybeeCallback = (err: RequestError|undefined|null, res: Response<any>) => void

	export function withCallback(opt: Options, cb: HoneybeeCallback): () => void
	export default withCallback
	export function withStream(opt: Options): Duplex
  export function withStreamBindings(defaults: Options): (opt: Options) => Duplex
  export function parseJSON(str: string): any
	export function withPromise(opt: Options): Promise<Response<any>>

	export function withBindings(defaults: Options): (opt: Options, cb: HoneybeeCallback) => () => void
	export function withBindings<P extends PromiseLike<Response<any>>>(PromiseLike: new(resolve: any) => P, defaults?: Options): (opt: Options) => P
}
