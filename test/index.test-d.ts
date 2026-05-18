import { expectType, expectAssignable } from 'tsd'
import createIsolatedFunction, {
  ExecutionResult,
  FailureResult,
  SuccessResult,
  Profiling,
  Logging,
  IsolatedFunctionOptions,
  IsolatedFunctionInstance,
  IsolatedFn
} from '..'

/* instance creation */

const isolatedFunction = createIsolatedFunction()
expectType<IsolatedFunctionInstance>(isolatedFunction)

const customInstance = createIsolatedFunction({ tmpdir: '/tmp/custom' })
expectType<IsolatedFunctionInstance>(customInstance)

/* basic usage */

const fn = isolatedFunction(() => 2 + 2)

expectType<IsolatedFn>(fn)

/* with explicit generic */

const sumFn = isolatedFunction<number>((a: number, b: number) => a + b)

expectType<IsolatedFn<number>>(sumFn)

/* function execution - success case */

const successResult = await sumFn(2, 3)

if (successResult.isFulfilled) {
  expectType<number>(successResult.value)
  expectType<Profiling>(successResult.profiling)
  expectType<Logging>(successResult.logging)
}

/* function execution - with type guard */

const result = await sumFn(2, 3)

if (result.isFulfilled) {
  expectType<number>(result.value)
} else {
  expectType<Error>(result.value)
}

/* with options */

const fnWithOptions = isolatedFunction<string>(
  () => 'hello',
  {
    memory: 128,
    timeout: 5000,
    throwError: false,
    allow: { permissions: ['fs'] }
  }
)

expectType<IsolatedFn<string>>(fnWithOptions)

/* error handling with throwError: false */

const errorFn = isolatedFunction<string>(
  () => {
    throw new Error('test')
  },
  { throwError: false }
)

const errorResult = await errorFn()

if (!errorResult.isFulfilled) {
  expectType<Error>(errorResult.value)
} else {
  expectType<string>(errorResult.value)
}

/* execution result types */

const genericResult: ExecutionResult<number> = await sumFn(1, 2)

if (genericResult.isFulfilled) {
  expectType<SuccessResult<number>>(genericResult)
} else {
  expectType<FailureResult>(genericResult)
}

/* profiling and logging types */

const execResult = await fn()

if (execResult.isFulfilled) {
  const { profiling, logging } = execResult

  expectType<number>(profiling.memory)
  expectType<number>(profiling.duration)

  expectType<Logging>(logging)
  expectAssignable<unknown[][] | undefined>(logging.log)
  expectAssignable<unknown[][] | undefined>(logging.info)
  expectAssignable<unknown[][] | undefined>(logging.debug)
  expectAssignable<unknown[][] | undefined>(logging.warn)
  expectAssignable<unknown[][] | undefined>(logging.error)
}

/* string input */

const stringFn = isolatedFunction('() => 42')

expectType<IsolatedFn>(stringFn)

/* async function */

const asyncFn = isolatedFunction<string>(async () => {
  await new Promise(resolve => setTimeout(resolve, 100))
  return 'done'
})

const asyncResult = await asyncFn()

if (asyncResult.isFulfilled) {
  expectType<string>(asyncResult.value)
}

/* variadic arguments */

const variadicFn = isolatedFunction<number>(
  (...args: number[]) => args.reduce((a, b) => a + b, 0)
)

const variadicResult = await variadicFn(1, 2, 3, 4, 5)

if (variadicResult.isFulfilled) {
  expectType<number>(variadicResult.value)
}

/* teardown */

const teardownResult = await isolatedFunction.teardown()

expectType<void>(teardownResult)
