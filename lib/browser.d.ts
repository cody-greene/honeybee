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
		withCredentials?: boolean,
		onProgress?: (pc: number) => void,
	}

	type HoneybeeCallback = (err: RequestError|undefined|null, res: Response<any>) => void

	export function withCallback(opt: Options, cb: HoneybeeCallback): () => void
	export default withCallback
  export function parseJSON(str: string): any
	export function withPromise(opt: Options): Promise<Response<any>>

	export function withBindings(defaults: Options): (opt: Options, cb: HoneybeeCallback) => () => void
	export function withBindings<P extends PromiseLike<Response<any>>>(PromiseLike: new(resolve: any) => P, defaults?: Options): (opt: Options) => P
}
