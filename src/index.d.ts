/**
 * Profiling information about the isolated function execution
 */
export interface Phases {
  /** Time waiting for compilation in milliseconds (0 if cached) */
  compile: number
  /** Process creation + Node.js boot + template setup in milliseconds */
  spawn: number
  /** User function execution time in milliseconds */
  run: number
  /** End-to-end wall-clock time in milliseconds */
  total: number
}

export interface Profiling {
  /** CPU time (user + system) in milliseconds */
  cpu: number
  /** Memory usage in bytes */
  memory: number
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
}

/**
 * Isolated function that can be executed with arguments
 */
export type IsolatedFn<T = unknown> = (
  ...args: unknown[]
) => Promise<SuccessResult<T> | FailureResult>

export interface IsolatedFunctionInstance {
  <T = unknown>(snippet: Function | string, options?: IsolatedFunctionOptions): IsolatedFn<T>
  /** Removes the shared dependencies directory */
  teardown(): Promise<void>
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

export default createIsolatedFunction
