/* eslint no-unused-vars: off */

declare class honeybee$Error extends Error {
  constructor(status?: number, msg?: string): void,
  statusCode: number,
  headers: {[string]: string},
  body: any,
}

type honeybee$Req = {
  url: string,
  method: string,
  query?: ?Object,
  headers: {[string]: string},
  body?: any,
}

type honeybee$Response<T=any> = {
  statusCode: number,
  headers: {[string]: string},
  body: T
}

interface honeybee$AuthorizationAgent {
  refresh:
    & ((honeybee$Req, Error) => mixed)
    & ((honeybee$Req, Error, ((?Error) => void)) => void),
  toHeader(): ?string,
}

type honeybee$Options = $ReadOnly<{
  url: string,
  method?: string,
  query?: Object,
  headers?: {[string]: string},
  body?: any,
  low?: number,
  high?: number,
  total?: number,
  serialize?: 'json' | 'form' | 'noop' | (honeybee$Req) => any,
  parseResponse?: 'json' | 'raw' | (honeybee$Req, honeybee$Response<>) => any,
  parseError?: 'json' | 'text' | (honeybee$Req, honeybee$Response<>) => Error,
  withCredentials?: ?bool,
  onProgress?: number => void,
  auth?: honeybee$AuthorizationAgent,
  timeout?: number,
  maxRedirects?: number,
  gzip?: ?bool,
  conn?: http$Agent<>,
}>

type honeybee$Config = $ReadOnly<$Shape<honeybee$Options>>

// As of 0.86.0 Flow does not explicitly support higher-kinded types
// but we can get around that by using $Call<F, A>
type honeybee$Promise<P, B=any> = $Call<$PropertyType<P, 'then'>, () => honeybee$Response<B>>

type honeybee$Callback = (?honeybee$Error, honeybee$Response<>) => void

declare module 'honeybee' {
  declare type Options = honeybee$Options
  declare type Req = honeybee$Req
  declare type Response<T=any> = honeybee$Response<T>
  declare type AuthorizationAgent = honeybee$AuthorizationAgent
  declare module.exports: {
    (honeybee$Options, honeybee$Callback): () => void,

    withStream: (honeybee$Options) => stream$Duplex,
    withStreamBindings: (defaults: honeybee$Config) => honeybee$Config => stream$Duplex,

    parseJSON: string => any,
    withPromise: <P>(PromiseLike: Class<P>) => honeybee$Options => honeybee$Promise<P>,
    withBindings:
      & (<P>(PromiseLike: Class<P>, defaults: honeybee$Config) => honeybee$Config => honeybee$Promise<P>)
      & (<P>(PromiseLike: Class<P>) => honeybee$Options => honeybee$Promise<P>)
      & ((defaults: honeybee$Config) => (honeybee$Config, honeybee$Callback) => () => void),

    Error: Class<honeybee$Error>,
  }
}
