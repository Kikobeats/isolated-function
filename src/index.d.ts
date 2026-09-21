/**
 * Profiling information about the isolated function execution
 */
export interface Phases {
  /** Time installing npm dependencies in milliseconds (0 when none were needed) */
  install: number
  /** Time bundling in milliseconds. With `slot`, the time to fill a cached shell */
  build: number
  /** Process creation + Node.js boot + template setup in milliseconds */
  spawn: number
  /** User function execution time in milliseconds */
  run: number
  /** End-to-end wall-clock time in milliseconds */
  total: number
}

export interface Memory {
  /** Resident set size of the whole isolate process, in bytes */
  total: number
  /** Resident memory attributable to the function (total minus the pre-execution baseline), in bytes */
  used: number
  /** V8 heap in use, in bytes. This is the only figure bounded by the `memory` limit */
  heap: number
  /** Off-heap memory (Buffer, ArrayBuffer, TypedArray), in bytes. Not bounded by the `memory` limit */
  external: number
}

export interface Profiling {
  /** CPU time (user + system) in milliseconds */
  cpu: number
  /** Memory usage breakdown, in bytes */
  memory: Memory
  /** Bundled code size in bytes */
  size: number
  /** Execution phase durations in milliseconds */
  phases: Phases
}

/**
 * Logging information captured from the isolated function
 */
export interface Logging {
  log?: unknown[][]
  info?: unknown[][]
  debug?: unknown[][]
  warn?: unknown[][]
  error?: unknown[][]
}

/**
 * Successful execution result
 */
export interface SuccessResult<T = unknown> {
  isFulfilled: true
  value: T
  profiling: Profiling
  logging: Logging
}

/**
 * Failed execution result
 */
export interface FailureResult {
  isFulfilled: false
  value: Error
  profiling: Profiling
  logging: Logging
}

export type ExecutionResult<T = unknown> = SuccessResult<T> | FailureResult

export interface AllowOptions {
  /**
   * Permissions to grant to the isolated function.
   * Available: addons, child-process, fs-read, fs-write, inspector, net, wasi, worker
   */
  permissions?: string[]
  /**
   * Whitelist of package names allowed to be installed.
   * Prevents arbitrary package installation from untrusted code.
   */
  dependencies?: string[]
}

/**
 * Options for creating an isolated-function instance
 */
export interface CreateOptions {
  /** Directory for installing code dependencies. Reused across invocations. */
  tmpdir?: string
  /** Additional directories for resolving dependencies. Dependencies found here with a matching version skip package install. */
  nodePaths?: string[]
  /** Byte budget for cached `slot` shells, least recently used evicted first. Defaults to 32 MB. */
  shellCacheBytes?: number
}

/**
 * Options for creating an isolated function
 */
export interface IsolatedFunctionOptions {
  /** Execution timeout in milliseconds. Also enforces a CPU time limit via RLIMIT_CPU. */
  timeout?: number
  /** Memory limit in megabytes */
  memory?: number
  /** When false, returns the error instead of throwing it */
  throwError?: boolean
  /** Configuration for allowed permissions and dependencies */
  allow?: AllowOptions
  /**
   * Code to place where the snippet contains `SLOT`. The snippet is built once
   * and cached, and each call only fills the slot, so calls that differ only in
   * this code skip bundling. Code that requires npm packages falls back to a
   * full build. The snippet must be a string containing `SLOT` exactly once.
   */
  slot?: string
}

/**
 * Isolated function that can be executed with arguments
 */
export type IsolatedFn<T = unknown> = (
  ...args: unknown[]
) => Promise<SuccessResult<T> | FailureResult>

export interface ShellCache {
  /** Number of cached shells, including builds in flight */
  readonly size: number
  /** Bytes held by cached shells */
  readonly bytes: number
  clear(): void
}

export interface IsolatedFunctionInstance {
  <T = unknown>(snippet: Function | string, options?: IsolatedFunctionOptions): IsolatedFn<T>
  /** Removes the shared dependencies directory and clears the shell cache */
  teardown(): Promise<void>
  /** Placeholder identifier for the `slot` option */
  readonly SLOT: string
  /** Cache of built `slot` shells */
  readonly shells: ShellCache
}

/**
 * Creates an isolated-function instance for running untrusted code in separate Node.js processes.
 *
 * @example
 * ```js
 * const isolatedFunction = require('isolated-function')()
 *
 * const sum = isolatedFunction((a, b) => a + b, {
 *   memory: 128,
 *   timeout: 10000
 * })
 *
 * const { value } = await sum(3, 2)
 * await isolatedFunction.teardown()
 * ```
 */
declare function createIsolatedFunction(options?: CreateOptions): IsolatedFunctionInstance

declare namespace createIsolatedFunction {
  /** Placeholder identifier for the `slot` option */
  const SLOT: string
}

export default createIsolatedFunction
